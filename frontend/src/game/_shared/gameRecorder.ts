/**
 * GameRecorder — the one gameplay recorder every game uses (#3274, epic #3273).
 *
 * A game records its play as units (a round, a hand, a trick, a chunk of a
 * real-time run): `beginUnit()`, then `record(type, data, actor?)` for each
 * thing that happens, then `closeUnit()`. The recorder keeps the unit in
 * memory and saves it through `gameEventClient.enqueueEvents` (via
 * `useGameSync.enqueueMany`), so no game builds its own batching, caps or size
 * handling. `useGameRecorder` (useGameRecorder.ts) wires it to a screen.
 *
 * Cost → performance → data (CLAUDE.md):
 *  - `record()` only pushes to an in-memory array: no serialisation, no
 *    storage, no Sentry, no logging per event. `data` is taken by ownership
 *    (see `record`). Memory is bounded: once the session cap is certain to be
 *    reached, `record()` stops keeping events (`memoryEventCeiling`).
 *  - A save is one `enqueueEvents` call — one eventStore write per tier the
 *    events touch, so a unit costs one AsyncStorage write, not one per event.
 *  - Saves run off the interaction path: `on_unit_close` hands the save to
 *    `schedule` (`scheduleIdle` by default), never inside the gesture or
 *    animation callback that closed the unit. The recorder owns no timers or
 *    intervals.
 *  - Every event is sized once, at save, against its type's cap
 *    (`recordingEventCap`, eventQueueConfig.ts), and the session against its
 *    cap. Sizes are JSON lengths (UTF-16 code units). An oversized event is
 *    split into parts when its type is chunkable, else dropped; once the
 *    session cap is reached the rest of the session is dropped (a clean
 *    prefix, never a replay with holes). An event that cannot be serialised
 *    at all (a BigInt, a cycle) is dropped as invalid. Drops are reported to
 *    Sentry once per session, by counts and sizes only — so a recorded event
 *    never reaches eventStore's silent `{_truncated: true}` stub.
 *
 * Send policies:
 *  - `on_unit_close` (turn-based games): each closed unit is saved at the
 *    next idle moment; units closed before it runs are saved together.
 *  - `on_session_end` (Star Swarm): closed units wait in memory and the whole
 *    session is saved in one call at `endSession()`.
 * Either way `endSession()` saves synchronously whatever is still waiting
 * (the open unit too), so a session's events always precede its
 * `game_ended`: call it before completing or closing the session —
 * `useGameRecorder` does. A save the sink refuses (no game session open yet)
 * leaves the units waiting, counted as nothing, for the next save.
 *
 * Every recorded event carries the envelope (written over any `data` field of
 * the same name): `v` (the type's schema version), `unit`, `t_ms` (ms since
 * the session started) and, where it applies, `actor`; a chunked event's
 * parts add `part` (0-based) and `parts`.
 *
 * Out of scope here: holding uploads while a game is played (#3275), priority
 * from the event registry (#3276, #3278) and the server dial (#3279 — it plugs
 * into `isRecordingEnabled`, read once per session).
 */

import * as Sentry from "@sentry/react-native";

import type { EnqueueEventInput } from "./gameEventClient";
import {
  RECORDER_IDLE_TIMEOUT_MS,
  isRecordingEnabled,
  recordingConfigFor,
  recordingEventCap,
  type GameRecordingConfig,
} from "./eventQueueConfig";
import type { GameType } from "./types";

export type SendPolicy = "on_unit_close" | "on_session_end";

/** Who did a recorded thing, for a game with seats. */
export interface RecordActor {
  readonly seat: number;
  readonly kind: "human" | "cpu";
  readonly cpu_type?: string;
  readonly difficulty?: string;
}

/** Envelope fields the recorder writes on every event; a `data` field of the same name is overwritten. */
export const ENVELOPE_KEYS = ["v", "unit", "t_ms", "actor", "part", "parts"] as const;

/**
 * Where saved events go: `useGameSync.enqueueMany`. Returns whether the
 * events were taken — false when no game session is open to take them, and
 * the recorder then keeps them waiting.
 */
export type RecorderSink = (events: readonly EnqueueEventInput[]) => boolean;

/** What a session's drop report carries: counts and sizes, nothing that identifies the session. */
export interface RecordingDropReport {
  readonly game_type: GameType;
  /** `record()` calls this session (while recording was enabled). */
  readonly recorded: number;
  /** Events saved, whole or in parts. */
  readonly saved: number;
  /** Saved events that were split, and the parts they made. */
  readonly chunked: number;
  readonly parts: number;
  /** Events over their type's cap that could not be split. */
  readonly dropped_oversize: number;
  /** Events left out once the session cap was reached (or certain to be). */
  readonly dropped_session_cap: number;
  /** Events that could not be serialised (a BigInt, a cycle). */
  readonly dropped_invalid: number;
  /** JSON lengths (UTF-16 code units). */
  readonly saved_bytes: number;
  readonly largest_bytes: number;
}

export interface GameRecorderOptions {
  readonly gameType: GameType;
  readonly policy?: SendPolicy;
  readonly sink?: RecorderSink;
  /** Defaults to the game's entry in eventQueueConfig. */
  readonly config?: GameRecordingConfig;
  /** Clock for `t_ms`. Defaults to `Date.now`. */
  readonly now?: () => number;
  /** Runs an `on_unit_close` save off the interaction path. Defaults to `scheduleIdle`. */
  readonly schedule?: (task: () => void) => void;
  /** Defaults to one Sentry warning. */
  readonly report?: (report: RecordingDropReport) => void;
  /** Defaults to `isRecordingEnabled` (the #3279 hook point). */
  readonly enabled?: (gameType: GameType) => boolean;
}

interface RecordedEvent {
  readonly type: string;
  readonly data: Record<string, unknown> | undefined;
  readonly actor: RecordActor | undefined;
  readonly t_ms: number;
}

interface Unit {
  readonly n: number;
  events: RecordedEvent[];
}

/**
 * The most events one session keeps in memory: an event's envelope alone
 * (`{"v":1,"unit":1,"t_ms":0}`) is over 16 JSON units, so past this many the
 * session cap is certain to be reached and `record()` stops keeping events.
 */
export function memoryEventCeiling(config: GameRecordingConfig): number {
  return Math.floor(config.sessionMaxBytes / 16);
}

/**
 * Run `task` when the JS thread is idle: `requestIdleCallback` (React Native
 * provides it) with RN's own `timeout` deadline (`RECORDER_IDLE_TIMEOUT_MS`),
 * so a busy thread still saves within that time. A runtime without it gets a
 * `setTimeout(task, 0)`, after the current task. The recorder itself keeps no
 * timer.
 */
export function scheduleIdle(task: () => void): void {
  const ric = (
    globalThis as {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => unknown;
    }
  ).requestIdleCallback;
  if (typeof ric === "function") ric(task, { timeout: RECORDER_IDLE_TIMEOUT_MS });
  else setTimeout(task, 0);
}

function reportToSentry(report: RecordingDropReport): void {
  Sentry.captureMessage("gameRecorder: recorded events over the size caps not saved", {
    level: "warning",
    tags: { subsystem: "gameRecorder", game_type: report.game_type },
    extra: { ...report },
  });
}

/** JSON length (UTF-16 code units). Throws for what JSON cannot hold (a BigInt, a cycle). */
function jsonLength(value: unknown): number {
  // `undefined` inside an array serialises as `null`
  return JSON.stringify(value)?.length ?? 4;
}

function isDev(): boolean {
  return typeof __DEV__ !== "undefined" && __DEV__;
}

/** A sized event ready to save. */
interface Sized {
  readonly events: EnqueueEventInput[];
  readonly bytes: number;
}

/**
 * Split `data[field]` across parts that each fit `cap`, greedily and in
 * order. Null when the array is missing or one item cannot fit on its own.
 */
function splitEvent(
  type: string,
  data: Record<string, unknown>,
  field: string,
  cap: number
): Sized | null {
  const items = data[field];
  if (!Array.isArray(items) || items.length < 2) return null;
  // `part` / `parts` never exceed the item count: size them at that width.
  const base = jsonLength({ ...data, [field]: [], part: items.length, parts: items.length });
  const groups: unknown[][] = [];
  let group: unknown[] = [];
  let size = base;
  for (const item of items) {
    const n = jsonLength(item);
    if (base + n > cap) return null;
    const add = group.length === 0 ? n : n + 1;
    if (size + add > cap) {
      groups.push(group);
      group = [];
      size = base + n;
    } else {
      size += add;
    }
    group.push(item);
  }
  groups.push(group);
  const events: EnqueueEventInput[] = [];
  let bytes = 0;
  for (let i = 0; i < groups.length; i += 1) {
    const part = { ...data, [field]: groups[i], part: i, parts: groups.length };
    const n = jsonLength(part);
    if (n > cap) return null; // the estimate is exact for JSON; this is the backstop
    bytes += n;
    events.push({ type, data: part });
  }
  return { events, bytes };
}

/** The per-session counters, as one value so a refused save can put them back. */
interface Counters {
  sessionBytes: number;
  /** The session cap was reached: everything after is dropped. */
  full: boolean;
  recorded: number;
  /** Events kept in memory or saved this session (the memory ceiling counts these). */
  kept: number;
  saved: number;
  chunked: number;
  parts: number;
  droppedOversize: number;
  droppedSessionCap: number;
  droppedInvalid: number;
  largestBytes: number;
}

function freshCounters(): Counters {
  return {
    sessionBytes: 0,
    full: false,
    recorded: 0,
    kept: 0,
    saved: 0,
    chunked: 0,
    parts: 0,
    droppedOversize: 0,
    droppedSessionCap: 0,
    droppedInvalid: 0,
    largestBytes: 0,
  };
}

export class GameRecorder {
  readonly gameType: GameType;
  readonly policy: SendPolicy;
  private sink: RecorderSink | null;
  private readonly config: GameRecordingConfig;
  private readonly ceiling: number;
  private readonly now: () => number;
  private readonly schedule: (task: () => void) => void;
  private readonly report: (report: RecordingDropReport) => void;
  private readonly enabledFor: (gameType: GameType) => boolean;

  // Session state — reset by startSession / endSession.
  /** Bumped by every reset: a scheduled save from an earlier session does nothing. */
  private generation = 0;
  /** `now()` at the session's start; null until the session's first call. */
  private t0: number | null = null;
  private enabled = true;
  private unit: Unit | null = null;
  private lastUnit = 0;
  /** Closed units (or flushed parts of the open one) not saved yet. */
  private closed: Unit[] = [];
  private saveScheduled = false;
  private c: Counters = freshCounters();

  constructor(options: GameRecorderOptions) {
    this.gameType = options.gameType;
    this.policy = options.policy ?? "on_unit_close";
    this.sink = options.sink ?? null;
    this.config = options.config ?? recordingConfigFor(options.gameType);
    this.ceiling = memoryEventCeiling(this.config);
    this.now = options.now ?? Date.now;
    this.schedule = options.schedule ?? scheduleIdle;
    this.report = options.report ?? reportToSentry;
    this.enabledFor = options.enabled ?? isRecordingEnabled;
  }

  /** Where saves go; until one is set, closed units wait. */
  setSink(sink: RecorderSink): void {
    this.sink = sink;
  }

  /** Whether a recorder session is in progress (anything recorded or begun since the last reset). */
  get inSession(): boolean {
    return this.t0 !== null;
  }

  /**
   * Start a session: `t_ms` counts from here and units number from 1. A
   * recorder used without it starts one at its first `beginUnit`/`record`.
   */
  startSession(): void {
    this.resetSession();
    this.ensureSession();
  }

  /**
   * Begin a unit (round / hand / trick / chunk), closing any open one. `n` is
   * the game's own number for it; by default the last unit's plus one, from 1.
   */
  beginUnit(n?: number): number {
    this.ensureSession();
    if (this.unit) this.closeUnit();
    const unit = n ?? this.lastUnit + 1;
    this.lastUnit = unit;
    this.unit = { n: unit, events: [] };
    return unit;
  }

  /**
   * Record one event in the open unit (one is begun if none is). Memory only.
   *
   * `data` is taken by ownership: pass a fresh, compact object (short keys,
   * ASCII codes) and never change it afterwards — the recorder keeps the
   * reference until the save and does not copy it. In development builds it
   * is shallow-frozen, so a later change throws there.
   */
  record(type: string, data?: Record<string, unknown>, actor?: RecordActor): void {
    this.ensureSession();
    if (!this.enabled) return;
    this.c.recorded += 1;
    // The session cap is already reached, or certain to be: keep nothing more.
    if (this.c.full || this.c.kept >= this.ceiling) {
      this.c.droppedSessionCap += 1;
      return;
    }
    if (data && isDev()) Object.freeze(data);
    if (!this.unit) this.beginUnit();
    this.c.kept += 1;
    const t_ms = Math.max(0, Math.round(this.now() - (this.t0 ?? 0)));
    this.unit?.events.push({ type, data, actor, t_ms });
  }

  /** Close the open unit. Under `on_unit_close` its save is scheduled for the next idle moment. */
  closeUnit(): void {
    const unit = this.unit;
    this.unit = null;
    if (!unit || unit.events.length === 0) return;
    this.closed.push(unit);
    if (this.policy === "on_unit_close") this.requestSave();
  }

  /**
   * Schedule a save of the waiting units for the next idle moment
   * (`on_unit_close` only; one at a time). `useGameRecorder` calls it when a
   * session opens, for units recorded before it.
   */
  requestSave(): void {
    if (this.policy !== "on_unit_close" || this.saveScheduled || this.closed.length === 0) return;
    this.saveScheduled = true;
    const generation = this.generation;
    this.schedule(() => {
      // A task left over from an earlier session: that session already saved
      // (or dropped) its units, and this one has its own task.
      if (generation !== this.generation) return;
      this.saveScheduled = false;
      this.save();
    });
  }

  /**
   * Save what is waiting now, the open unit's events so far included, without
   * ending the session: numbering, `t_ms` and the open unit carry on (the
   * unit's later events save under the same number). For a call that may
   * close the game session (`useGameRecorder.resume`).
   */
  flush(): void {
    if (this.t0 === null) return;
    const open = this.unit;
    if (open && open.events.length > 0) {
      this.closed.push({ n: open.n, events: open.events });
      open.events = [];
    }
    this.save();
  }

  /**
   * End the session: close the open unit, save everything still waiting now,
   * in one call, and report what the caps dropped (once, if anything). Call
   * before the session completes or closes, so its events precede
   * `game_ended`. The next `record` starts a new session.
   */
  endSession(): void {
    if (this.t0 === null) return;
    this.closeUnit();
    this.save();
    this.reportDrops();
    this.resetSession();
  }

  private ensureSession(): void {
    if (this.t0 !== null) return;
    this.t0 = this.now();
    this.enabled = this.enabledFor(this.gameType);
  }

  private resetSession(): void {
    this.generation += 1;
    this.saveScheduled = false;
    this.t0 = null;
    this.enabled = true;
    this.unit = null;
    this.lastUnit = 0;
    this.closed = [];
    this.c = freshCounters();
  }

  /**
   * Size and save every waiting unit in one sink call. A refused call (no
   * game session open) puts the units and the counters back as they were.
   */
  private save(): void {
    if (this.closed.length === 0 || this.sink === null) return;
    const units = this.closed;
    const before = { ...this.c };
    this.closed = [];
    const out: EnqueueEventInput[] = [];
    for (const unit of units) {
      for (const event of unit.events) {
        let sized: Sized | null = null;
        try {
          sized = this.size(unit.n, event);
        } catch {
          // Not serialisable (a BigInt, a cycle): this event only.
          this.c.droppedInvalid += 1;
        }
        if (sized) for (const e of sized.events) out.push(e);
      }
    }
    if (out.length === 0) return;
    let taken = false;
    try {
      taken = this.sink(out);
    } catch (e) {
      Sentry.captureException(e, { tags: { subsystem: "gameRecorder", op: "save" } });
      return; // the sink failed, not the session: the events are gone
    }
    if (!taken) {
      this.c = before;
      this.closed = units.concat(this.closed);
    }
  }

  /** The event with its envelope, within its caps (in parts if need be); null when dropped. */
  private size(unit: number, event: RecordedEvent): Sized | null {
    if (this.c.full) {
      this.c.droppedSessionCap += 1;
      return null;
    }
    const typeConfig = this.config.events[event.type];
    const data: Record<string, unknown> = {
      ...event.data,
      v: typeConfig?.v ?? 1,
      unit,
      t_ms: event.t_ms,
    };
    if (event.actor) data.actor = event.actor;
    else delete data.actor;
    delete data.part;
    delete data.parts;
    const bytes = jsonLength(data);
    this.c.largestBytes = Math.max(this.c.largestBytes, bytes);
    const cap = recordingEventCap(this.config, event.type);
    let sized: Sized | null = null;
    if (bytes <= cap) sized = { events: [{ type: event.type, data }], bytes };
    else if (typeConfig?.chunkField)
      sized = splitEvent(event.type, data, typeConfig.chunkField, cap);
    if (!sized) {
      this.c.droppedOversize += 1;
      return null;
    }
    if (this.c.sessionBytes + sized.bytes > this.config.sessionMaxBytes) {
      this.c.full = true;
      this.c.droppedSessionCap += 1;
      return null;
    }
    if (sized.events.length > 1) {
      this.c.chunked += 1;
      this.c.parts += sized.events.length;
    }
    this.c.sessionBytes += sized.bytes;
    this.c.saved += 1;
    return sized;
  }

  private reportDrops(): void {
    const c = this.c;
    if (c.droppedOversize === 0 && c.droppedSessionCap === 0 && c.droppedInvalid === 0) return;
    try {
      this.report({
        game_type: this.gameType,
        recorded: c.recorded,
        saved: c.saved,
        chunked: c.chunked,
        parts: c.parts,
        dropped_oversize: c.droppedOversize,
        dropped_session_cap: c.droppedSessionCap,
        dropped_invalid: c.droppedInvalid,
        saved_bytes: c.sessionBytes,
        largest_bytes: c.largestBytes,
      });
    } catch {
      // Isolation: a report never blocks the session's end.
    }
  }
}
