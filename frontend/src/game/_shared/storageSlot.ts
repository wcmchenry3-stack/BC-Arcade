/**
 * One AsyncStorage slot per saved thing, with its Sentry reporting (#2987).
 *
 * Every game's `storage.ts` used to repeat the same skeleton; it lives here
 * once. A game module keeps only what is its own: the key, the check of a
 * stored payload, and any migration or normalising around it. The keys and
 * the bytes written are the game's, unchanged: nothing here adds to or
 * reshapes a payload.
 *
 * - `createJsonSlot` — an in-progress game (or any nullable JSON value).
 *   `load` resolves null when nothing usable is stored. A payload that can't
 *   be read or parsed, or whose loading throws, is corrupt: it is removed and
 *   reported as a warning (`captureMessage`, not an exception: the caller
 *   recovers by starting fresh, #501/#510). A payload that parses but fails
 *   `isValid` is removed (or kept, `keepInvalid`) without a report unless
 *   `invalidWarning` asks for one. Save and clear failures are reported with
 *   `captureException`. Nothing rejects.
 * - `createRecord` — a value that always loads (stats, a best score,
 *   progress): `fallback()` when nothing is stored, and on any failure, which
 *   is reported with `captureException` and leaves the stored value alone.
 *
 * Every report is tagged `{ subsystem, op }` (`subsystem` is the game's
 * `"<game>.storage"`).
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Sentry from "@sentry/react-native";

type Awaitable<T> = T | Promise<T>;

/** A warning to report for a payload that failed `isValid`. */
export interface InvalidWarning {
  message: string;
  extra?: Record<string, unknown>;
}

export interface JsonSlotOptions<T, S = T> {
  key: string;
  /** Sentry `subsystem` tag, `"<game>.storage"`. */
  subsystem: string;
  /**
   * The stored payload's check, after `migrate`. It may read the payload as
   * the shape it expects: a property read that throws (a stored `null`)
   * counts as corrupt, like a parse failure.
   */
  isValid(parsed: unknown): parsed is S;
  /** Upgrade an older payload in place, before `isValid`. */
  migrate?(parsed: unknown): unknown;
  /** The loaded value from the checked payload (backfills, clock restart). */
  onLoad?(stored: S): Awaitable<T>;
  /** The payload to write for `value` (e.g. stripping nested undo history). */
  beforeSave?(value: T): S;
  /** Leave a payload that fails `isValid` in storage (default: remove it). */
  keepInvalid?: boolean;
  /** Report a payload that fails `isValid`; return null for no report. */
  invalidWarning?(parsed: unknown): InvalidWarning | null;
  /** Default `"<subsystem>: corrupt game payload, discarding"`. */
  corruptMessage?: string;
  /**
   * What the corrupt-payload warning carries: the error and key (default),
   * those and the first 500 characters of the payload, or nothing.
   */
  corruptExtra?: "key" | "keyAndRaw" | "none";
  /**
   * A failed read is reported with `captureException` and leaves the payload
   * stored, instead of counting as corrupt (Sudoku).
   */
  readFailureIsError?: boolean;
  /** Other keys `clear` removes with this one. */
  clearAlso?: readonly string[];
}

export interface JsonSlot<T> {
  save(value: T): Promise<void>;
  load(): Promise<T | null>;
  clear(): Promise<void>;
}

function reportError(e: unknown, subsystem: string, op: string): void {
  Sentry.captureException(e, { tags: { subsystem, op } });
}

function warn(message: string, subsystem: string, extra?: Record<string, unknown>): void {
  Sentry.captureMessage(message, {
    level: "warning",
    tags: { subsystem, op: "load" },
    ...(extra ? { extra } : {}),
  });
}

export function createJsonSlot<T, S = T>(options: JsonSlotOptions<T, S>): JsonSlot<T> {
  const { key, subsystem } = options;
  const corruptMessage = options.corruptMessage ?? `${subsystem}: corrupt game payload, discarding`;

  async function discard(): Promise<void> {
    await AsyncStorage.removeItem(key).catch(() => {});
  }

  async function discardCorrupt(e: unknown, raw: string | null): Promise<null> {
    const extra = options.corruptExtra ?? "key";
    warn(
      corruptMessage,
      subsystem,
      extra === "none"
        ? undefined
        : extra === "keyAndRaw"
          ? { error: String(e), key, rawPayload: raw?.slice(0, 500) }
          : { error: String(e), key }
    );
    await discard();
    return null;
  }

  async function load(): Promise<T | null> {
    let raw: string | null = null;
    try {
      raw = await AsyncStorage.getItem(key);
    } catch (e) {
      if (!options.readFailureIsError) return discardCorrupt(e, null);
      reportError(e, subsystem, "load");
      return null;
    }
    if (!raw) return null;
    try {
      const parsed: unknown = JSON.parse(raw);
      const payload = options.migrate ? options.migrate(parsed) : parsed;
      if (!options.isValid(payload)) {
        const warning = options.invalidWarning?.(payload);
        if (warning) warn(warning.message, subsystem, warning.extra);
        if (!options.keepInvalid) await discard();
        return null;
      }
      return options.onLoad ? await options.onLoad(payload) : (payload as unknown as T);
    } catch (e) {
      return discardCorrupt(e, raw);
    }
  }

  async function save(value: T): Promise<void> {
    try {
      const payload = options.beforeSave ? options.beforeSave(value) : value;
      await AsyncStorage.setItem(key, JSON.stringify(payload));
    } catch (e) {
      reportError(e, subsystem, "save");
    }
  }

  async function clear(): Promise<void> {
    try {
      if (options.clearAlso?.length) {
        await Promise.all([key, ...options.clearAlso].map((k) => AsyncStorage.removeItem(k)));
      } else {
        await AsyncStorage.removeItem(key);
      }
    } catch (e) {
      reportError(e, subsystem, "clear");
    }
  }

  return { save, load, clear };
}

export interface RecordOptions<T> {
  key: string;
  subsystem: string;
  /** Sentry `op` tags for a failed load and save, e.g. `loadStats` / `saveStats`. */
  ops: { load: string; save: string };
  /** The value when nothing is stored, or it can't be read. A fresh copy each call. */
  fallback(): T;
  /** The value from what is stored (non-empty). May throw: that reads as `fallback()`. */
  read(raw: string): T;
  /** What to store for `value`. */
  write(value: T): string;
}

export interface StoredRecord<T> {
  load(): Promise<T>;
  save(value: T): Promise<void>;
}

export function createRecord<T>(options: RecordOptions<T>): StoredRecord<T> {
  const { key, subsystem, ops } = options;
  return {
    async load() {
      try {
        const raw = await AsyncStorage.getItem(key);
        if (!raw) return options.fallback();
        return options.read(raw);
      } catch (e) {
        reportError(e, subsystem, ops.load);
        return options.fallback();
      }
    },
    async save(value) {
      try {
        await AsyncStorage.setItem(key, options.write(value));
      } catch (e) {
        reportError(e, subsystem, ops.save);
      }
    },
  };
}
