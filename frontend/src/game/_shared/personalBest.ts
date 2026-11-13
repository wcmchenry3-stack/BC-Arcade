/**
 * The player's personal best per game, on this device (#3757; owner decision #3798).
 *
 * One storage format and one API for every game that keeps a best: the result card's "Best" and
 * "New best", and end beats such as Yacht's solo win. The device is the source of truth: nothing
 * here writes the server, and the only read is the one-off seed from `/stats/me`
 * (`personalBestSeed.ts`, #3802).
 *
 * - **Format.** One AsyncStorage key per game, `personal_best_v1:<game>`, holding
 *   `{"v":1,"b":{"<variant>":<best>}}`. A game without variants uses the variant `"_"`; a game
 *   whose best is per difficulty, mode or layout keys it by that (`"classic.easy"`, `"turtle"`).
 *   A payload is a few dozen bytes per variant.
 * - **What "best" means** is the game's own metric as before #3757 (higher or lower is better, and
 *   which values can be a best at all): `PERSONAL_BEST_GAMES` in `personalBestGames.ts`. The
 *   "new best" rule stays `bestOf`: the first result sets the best but is never a new best.
 * - **Writes** happen only when a best improves (and once to move an older save in, below). Every
 *   read and write for a game runs in order, so two results finishing together can't lower a best.
 *   None of this is on the frame or gesture path: screens read the best when a game starts and
 *   record once when it ends.
 * - **Older saves** (each game's key before #3757) are moved in on the first read: the older
 *   value is merged in (the better one wins, so a best is never lowered or lost), written in the
 *   new format, and only once that write has landed is the old key removed. A failed write leaves
 *   the old key for the next read to try again, so the move is idempotent.
 * - **Fail-safe.** Nothing here throws. A payload that can't be parsed reads as no best (reported
 *   as a warning and removed); a stored value that can't be a best for its game is dropped. A
 *   record in a format version this build doesn't know (a newer build's, kept across a rollback)
 *   reads as no best and is left exactly as stored: nothing is written over it. When storage
 *   can't be read at all, nothing is written either, so a best it couldn't see is never
 *   overwritten.
 *
 * Every failure is reported to Sentry at most once per app session per game and kind (`report`).
 *
 * Cost: no server I/O of its own. Storage: one small key per game played; a write only when a best
 * improves.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Sentry from "@sentry/react-native";

import { bestOf, type BestResult } from "./bestOf";
import { captureThrottledMessage, sentryThrottle } from "./sentryThrottle";
import {
  PERSONAL_BEST_GAMES,
  type PersonalBestGame,
  type PersonalBestSpec,
} from "./personalBestGames";

export type { PersonalBestGame } from "./personalBestGames";
export type { BestResult } from "./bestOf";

/** The variant of a game whose best is not split by difficulty, mode, layout or level. */
export const DEFAULT_VARIANT = "_";

const SUBSYSTEM = "personalBest";
const FORMAT_VERSION = 1;

/** Best per variant. */
export type Bests = Readonly<Record<string, number>>;

export function storageKey(game: PersonalBestGame): string {
  return `personal_best_v1:${game}`;
}

/**
 * A failed storage call, reported at most once per app session per game and kind of failure
 * (`sentryThrottle`, #3293): 2048 records on every move that raises its best, so broken storage
 * must not send an event per move.
 */
function report(e: unknown, game: PersonalBestGame, op: string): void {
  if (!sentryThrottle.allow(`${SUBSYSTEM}:${op}:${game}`, "error")) return;
  Sentry.captureException(e, { tags: { subsystem: SUBSYSTEM, op, game } });
}

/** `value` can be a best for `spec`'s game (a real number, and plausible for that game). */
function plausible(spec: PersonalBestSpec, value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && spec.isPlausible(value);
}

/** The plausible entries of `raw` (an object of variant → best), or none. */
function keepPlausible(spec: PersonalBestSpec, raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [variant, value] of Object.entries(raw as Record<string, unknown>)) {
    if (variant.length > 0 && plausible(spec, value)) out[variant] = value;
  }
  return out;
}

/** Both sets of bests in one: per variant, the better value wins. Pure. */
export function mergeBests(game: PersonalBestGame, a: Bests, b: Bests): Bests {
  const { lowerIsBetter } = PERSONAL_BEST_GAMES[game];
  const merged: Record<string, number> = { ...a };
  for (const [variant, value] of Object.entries(b)) {
    const current = merged[variant];
    if (current === undefined || (lowerIsBetter ? value < current : value > current)) {
      merged[variant] = value;
    }
  }
  return merged;
}

function sameBests(a: Bests, b: Bests): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((k) => a[k] === b[k]);
}

/**
 * A result of `value` against the best `prior` for `game` (0: no best on record), without
 * touching storage: for screens that snapshot the best when a game starts and decide the end
 * synchronously. A value that can't be a best for the game (e.g. a 0 score, a Mahjong clear under
 * the floor) changes nothing; a prior that can't be one counts as no best.
 */
export function judgeResult(game: PersonalBestGame, prior: number, value: number): BestResult {
  const spec = PERSONAL_BEST_GAMES[game];
  const priorBest = plausible(spec, prior) ? prior : 0;
  if (!plausible(spec, value)) return { best: priorBest, improved: false, isNewBest: false };
  return bestOf(priorBest, value, spec.lowerIsBetter);
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

/** Each game's reads and writes, in order (see the header). */
const queues = new Map<PersonalBestGame, Promise<unknown>>();

function inOrder<T>(game: PersonalBestGame, op: () => Promise<T>): Promise<T> {
  const previous = queues.get(game) ?? Promise.resolve();
  const next = previous.then(op, op);
  queues.set(
    game,
    next.catch(() => {})
  );
  return next;
}

/**
 * Each game's bests as last read or written, so a game that records often (2048, on every move
 * that raises its best) reads storage once per session rather than on every call. Kept only when
 * the stored record is known: after a successful write, or a read that found a readable record
 * and moved any older save in. A failed write or removal, and a missing, corrupt or unknown
 * record, are not kept, so the next call reads storage again. One entry per game: games never
 * share one. Only this module writes the key, so the cache can't go stale in the app.
 */
const cache = new Map<PersonalBestGame, Bests>();

/**
 * Test hook: forget the cache and the queues between tests (storage is cleared between them).
 * @internal Exported for tests only; no production caller.
 */
export function __resetPersonalBestForTests(): void {
  cache.clear();
  queues.clear();
}

interface Loaded {
  bests: Bests;
  /** Storage was read, so writing `bests` back can't lose a best it didn't see. */
  readable: boolean;
}

type Parsed =
  | { kind: "ok"; bests: Record<string, number> }
  /** Another format version (a newer build's): not ours to read or to overwrite. */
  | { kind: "unknown" }
  | { kind: "corrupt" };

/** Parses the stored record. */
function parseRecord(spec: PersonalBestSpec, raw: string): Parsed {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { kind: "corrupt" };
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { kind: "corrupt" };
  }
  const { v, b } = parsed as { v?: unknown; b?: unknown };
  if (v !== FORMAT_VERSION) return v === undefined ? { kind: "corrupt" } : { kind: "unknown" };
  if (b === null || typeof b !== "object" || Array.isArray(b)) return { kind: "corrupt" };
  return { kind: "ok", bests: keepPlausible(spec, b) };
}

async function write(game: PersonalBestGame, bests: Bests): Promise<boolean> {
  try {
    await AsyncStorage.setItem(storageKey(game), JSON.stringify({ v: FORMAT_VERSION, b: bests }));
    cache.set(game, bests);
    return true;
  } catch (e) {
    cache.delete(game);
    report(e, game, "save");
    return false;
  }
}

/** The stored bests, with any older save moved in (see the header). Never rejects. */
async function load(game: PersonalBestGame): Promise<Loaded> {
  const cached = cache.get(game);
  if (cached) return { bests: cached, readable: true };
  const spec = PERSONAL_BEST_GAMES[game];
  const key = storageKey(game);
  const legacyKeys = spec.legacy?.keys ?? [];
  let stored: Record<string, string | null>;
  try {
    stored = await AsyncStorage.getMany([key, ...legacyKeys]);
  } catch (e) {
    report(e, game, "load");
    return { bests: {}, readable: false };
  }

  let current: Bests = {};
  let readable = true;
  let recordOk = false;
  const raw = stored[key];
  if (raw != null) {
    const parsed = parseRecord(spec, raw);
    if (parsed.kind === "ok") {
      current = parsed.bests;
      recordOk = true;
    } else if (parsed.kind === "unknown") {
      // Left as stored, and nothing may be written over it.
      readable = false;
    } else {
      // Once per session per game, even if removing the record keeps failing.
      captureThrottledMessage(
        `${SUBSYSTEM}:corrupt:${game}`,
        `${SUBSYSTEM}: corrupt record, reading as no best`,
        { level: "warning", tags: { subsystem: SUBSYSTEM, op: "load", game }, extra: { key } }
      );
      await AsyncStorage.removeItem(key).catch(() => {});
    }
  }

  const presentLegacy = legacyKeys.filter((k) => stored[k] != null);
  if (presentLegacy.length === 0 || !spec.legacy) {
    if (recordOk) cache.set(game, current);
    return { bests: current, readable };
  }

  let imported: Bests = {};
  try {
    imported = keepPlausible(spec, spec.legacy.read(stored));
  } catch {
    // An older save that can't be read holds no best to keep.
  }
  const merged = mergeBests(game, current, imported);
  // Over a record this build can't read, the older save counts in memory only, and stays stored.
  if (!readable) return { bests: merged, readable };
  const unchanged = sameBests(merged, current);
  const saved = unchanged ? true : await write(game, merged);
  if (saved) {
    try {
      await AsyncStorage.removeMany(presentLegacy);
      if (unchanged && recordOk) cache.set(game, merged);
    } catch (e) {
      // The new record is written; the old key is merged in again (idempotently) next read.
      cache.delete(game);
      report(e, game, "migrate");
    }
  }
  return { bests: merged, readable: true };
}

/** Every stored best for `game`, by variant. Never rejects: none on failure. */
export function getBests(game: PersonalBestGame): Promise<Bests> {
  return inOrder(game, async () => (await load(game)).bests);
}

/** The best for `game` (and `variant`); 0 when none is on record. Never rejects. */
export async function getBest(
  game: PersonalBestGame,
  variant: string = DEFAULT_VARIANT
): Promise<number> {
  return (await getBests(game))[variant] ?? 0;
}

/**
 * Records a finished game's `value` for `game` (and `variant`) and returns how it compares with
 * the stored best (`judgeResult`). Writes only when the best improves, and never when storage
 * could not be read. Never rejects.
 */
export function recordResult(game: PersonalBestGame, value: number): Promise<BestResult>;
export function recordResult(
  game: PersonalBestGame,
  variant: string | undefined,
  value: number
): Promise<BestResult>;
export function recordResult(
  game: PersonalBestGame,
  variantOrValue: string | number | undefined,
  maybeValue?: number
): Promise<BestResult> {
  const variant =
    typeof variantOrValue === "string" && variantOrValue.length > 0
      ? variantOrValue
      : DEFAULT_VARIANT;
  const value = typeof variantOrValue === "number" ? variantOrValue : (maybeValue ?? 0);
  return inOrder(game, async () => {
    const { bests, readable } = await load(game);
    const result = judgeResult(game, bests[variant] ?? 0, value);
    if (result.improved && readable) await write(game, { ...bests, [variant]: result.best });
    return result;
  });
}
