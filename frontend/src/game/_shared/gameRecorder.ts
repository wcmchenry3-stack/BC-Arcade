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
 *    (see `record`).
 *  - A closed unit is measured at the next idle moment (`schedule`,
 *    `scheduleIdle` by default) — never inside the gesture or animation
 *    callback that closed it — and only its measured form is kept: an
 *    oversized event's data is released then, and the session cap trips as
 *    early as it can. The recorder owns no timers or intervals.
 *  - Memory is bounded: measured events add up to at most `sessionMaxBytes`
 *    (JSON length), at most `memoryEventCeiling` events are taken per
 *    session, and at most `RECORDER_MAX_RAW_EVENTS` are held unmeasured (a
 *    long open unit is handed to the idle measuring every
 *    `RECORDER_MEASURE_EVERY` events); past any of these, `record()` keeps
 *    nothing more.
 *  - A save is one `enqueueEvents` call — one eventStore write per tier the
 *    events touch, so a unit costs one AsyncStorage write, not one per event.
 *  - Every event is measured once against its type's cap
 *    (`recordingEventCap`, eventQueueConfig.ts), and the session against its
 *    cap. Sizes are JSON lengths (UTF-16 code units). An oversized event is
 *    split into parts when its type is chunkable, else dropped; once the
 *    session cap is reached the rest of the session is dropped (a clean
 *    prefix, never a replay with holes). An event that cannot be serialised
 *    at all (a BigInt, a cycle) is dropped as invalid. Drops are reported to
 *    Sentry once per session, by counts and sizes only, through the Sentry
 *    throttle — so a recorded event never reaches eventStore's silent
 *    `{_truncated: true}` stub.
 *
 * Send policies:
 *  - `on_unit_close` (turn-based games): each closed unit is measured and
 *    saved at the next idle moment; units closed before it runs go together.
 *  - `on_session_end` (Star Swarm): closed units are measured at idle and
 *    held; the whole session is saved in one call at `endSession()`.
 * Either way `endSession()` saves synchronously whatever is still waiting
 * (the open unit too), so a session's events always precede its
 * `game_ended`: call it before completing or closing the session —
 * `useGameRecorder` does. While the sink cannot take events (no game session
 * open yet, `canAccept()` false) measured events wait for the next save;
 * at `endSession()` they are dropped and reported as `dropped_unsent`.
 * After `endSession()`, `record()` and `beginUnit()` do nothing until the
 * next `startSession()`: what a game records after its session ended belongs
 * to no game.
 *
 * Every recorded event carries the envelope, except a type registered with
 * `envelope: false` (eventQueueConfig.ts), which is sent as recorded and never
 * chunked. The envelope is written over any `data` field of the same name: `v` (the type's schema version), `unit`, `t_ms` (ms since
 * the session started) and, where it applies, `actor`; a chunked event's
 * parts add `part` (0-based) and `parts`.
 *
 * Uploads: SyncWorker holds a foreground session's gameplay events until it
 * completes, the app is backgrounded, or GAMEPLAY_HOLD_MAX_MS passes (#3275,
 * syncWorker.ts). Queue priority comes from the event registry (#3276, #3278).
 * Out of scope here: the server dial (#3279 — it plugs into
 * `isRecordingEnabled`, read once per session).
 */

import * as Sentry from "@sentry/react-native";

import type { EnqueueEventInput } from "./gameEventClient";
import {
  RECORDER_IDLE_TIMEOUT_MS,
  RECORDER_MAX_RAW_EVENTS,
  RECORDER_MEASURE_EVERY,
  isRecordingEnabled,
  recordingConfigFor,
  recordingEventCap,
  type EventTypeOf,
  type RegisteredEventType,
  type GameRecordingConfig,
} from "./eventQueueConfig";
import { captureThrottledMessage } from "./sentryThrottle";
import type { GameType } from "./types";

export type SendPolicy = "on_unit_close" | "on_session_end";

/** Who did a recorded thing, for a game with seats. */
export interface RecordActor {
  readonly seat: number;
  readonly kind: "human" | "cpu";
  readonly cpu_type?: string;
  readonly difficulty?: string;
}

/** Where saved events go (`useGameRecorder` wires it to `useGameSync`). */
export interface RecorderSink {
  /** Cheap: whether a game session is open to take events now. */
  canAccept(): boolean;
  /** Takes the events; false when it could not, and the recorder keeps them waiting. */
  enqueueMany(events: readonly EnqueueEventInput[]): boolean;
}

/** What a session's drop report carries: counts and sizes, nothing that identifies the session. */
export interface RecordingDropReport {
  readonly game_type: GameType;
  /** `record()` calls this session (while recording was enabled). */
  readonly recorded: number;
  /** Events within the caps (saved, or held for the game session), whole or in parts. */
  readonly saved: number;
  /** Saved events that were split, and the parts they made. */
  readonly chunked: number;
  readonly parts: number;
  /** Events over their type's cap that could not be split. */
  readonly dropped_oversize: number;
  /** Events left out once the session cap was reached (or the memory ceiling). */
  readonly dropped_session_cap: number;
  /** Events that could not be serialised (a BigInt, a cycle). */
  readonly dropped_invalid: number;
  /**
   * Events within the caps that never reached the queue: the session ended
   * while the sink could not take them (no game session open, or refused),
   * or the sink failed. Not counted in `saved`.
   */
  readonly dropped_unsent: number;
  /**
   * Events refused because `RECORDER_MAX_RAW_EVENTS` unmeasured events were
   * already held (idle never came to measure them).
   */
  readonly dropped_memory: number;
  /** JSON lengths (UTF-16 code units). */
  readonly saved_bytes: number;
  readonly largest_bytes: number;
}

/** Where a recorder session stands, for a recorder that takes it over (`useGameRecorder`). */
export interface RecorderHandoff {
  readonly t0: number;
  readonly lastUnit: number;
  /** What the session has used of its caps, so a switch does not reset them. */
  readonly sessionBytes: number;
  readonly taken: number;
  readonly full: boolean;
}

export interface GameRecorderOptions<G extends GameType = GameType> {
  readonly gameType: G;
  readonly policy?: SendPolicy;
  readonly sink?: RecorderSink;
  /** Defaults to the game's entry in eventQueueConfig. */
  readonly config?: GameRecordingConfig;
  /** Clock for `t_ms`. Defaults to `Date.now()`. */
  readonly now?: () => number;
  /** Runs measuring and `on_unit_close` saves off the interaction path. Defaults to `scheduleIdle`. */
  readonly schedule?: (task: () => void) => void;
  /** Defaults to one throttled Sentry warning. */
  readonly report?: (report: RecordingDropReport) => void;
  /** Defaults to `isRecordingEnabled` (the #3279 hook point). */
  readonly enabled?: (gameType: GameType) => boolean;
}

interface RecordedEvent {
  readonly type: RegisteredEventType;
  readonly data: Record<string, unknown> | undefined;
  readonly actor: RecordActor | undefined;
  readonly t_ms: number;
}

interface Unit {
  readonly n: number;
  events: RecordedEvent[];
}

/**
 * The most events one session takes into memory: an event's envelope alone
 * (`{"v":1,"unit":1,"t_ms":0}`) is over 16 JSON units, so past this many the
 * session cap is certain to be reached and `record()` stops keeping events.
 */
export function memoryEventCeiling(config: GameRecordingConfig): number {
  return Math.floor(config.sessionMaxBytes / 16);
}

/**
 * Run `task` when the JS thread is idle: `requestIdleCallback` (React Native
 * provides it) with RN's own `timeout` deadline (`RECORDER_IDLE_TIMEOUT_MS`),
 * so a busy thread still runs it within that time. A runtime without it gets
 * a `setTimeout(task, 0)`, after the current task. The recorder itself keeps
 * no timer.
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
  captureThrottledMessage(
    `gameRecorder.drop.${report.game_type}`,
    "gameRecorder: recorded events over the size caps not saved",
    {
      level: "warning",
      tags: { subsystem: "gameRecorder", game_type: report.game_type },
      extra: { ...report },
    }
  );
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
  type: RegisteredEventType,
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

/** The per-session counters. */
interface Counters {
  /** JSON length of the events within the caps (held or saved). */
  sessionBytes: number;
  /** The session cap was reached: everything after is dropped. */
  full: boolean;
  recorded: number;
  /** Events taken into memory this session (the memory ceiling counts these). */
  taken: number;
  saved: number;
  chunked: number;
  parts: number;
  droppedOversize: number;
  droppedSessionCap: number;
  droppedInvalid: number;
  droppedUnsent: number;
  droppedMemory: number;
  largestBytes: number;
}

function freshCounters(): Counters {
  return {
    sessionBytes: 0,
    full: false,
    recorded: 0,
    taken: 0,
    saved: 0,
    chunked: 0,
    parts: 0,
    droppedOversize: 0,
    droppedSessionCap: 0,
    droppedInvalid: 0,
    droppedUnsent: 0,
    droppedMemory: 0,
    largestBytes: 0,
  };
}

export class GameRecorder<G extends GameType = GameType> {
  readonly gameType: G;
  readonly policy: SendPolicy;
  private sink: RecorderSink | null;
  private readonly config: GameRecordingConfig;
  private readonly ceiling: number;
  private readonly now: () => number;
  private readonly schedule: (task: () => void) => void;
  private readonly report: (report: RecordingDropReport) => void;
  private readonly enabledFor: (gameType: GameType) => boolean;

  /** Bumped by every reset: a scheduled task from an earlier session does nothing. */
  private generation = 0;
  /** `endSession()` ran and no `startSession()` since: recording is refused. */
  private ended = false;
  // Session state — reset by startSession / endSession.
  /** `now()` at the session's start; null until the session's first call. */
  private t0: number | null = null;
  private enabled = true;
  private unit: Unit | null = null;
  private lastUnit = 0;
  /** Closed units (or flushed parts of the open one) not measured yet. */
  private closed: Unit[] = [];
  /** Unmeasured events held (open unit and `closed`), bounded by `RECORDER_MAX_RAW_EVENTS`. */
  private rawHeld = 0;
  /** Measured events within the caps (one entry per recorded event), waiting for the sink. */
  private measured: Sized[] = [];
  private taskScheduled = false;
  private c: Counters = freshCounters();

  constructor(options: GameRecorderOptions<G>) {
    this.gameType = options.gameType;
    this.policy = options.policy ?? "on_unit_close";
    this.sink = options.sink ?? null;
    this.config = options.config ?? recordingConfigFor(options.gameType);
    this.ceiling = memoryEventCeiling(this.config);
    this.now = options.now ?? (() => Date.now());
    this.schedule = options.schedule ?? scheduleIdle;
    this.report = options.report ?? reportToSentry;
    this.enabledFor = options.enabled ?? isRecordingEnabled;
  }

  /** Where saves go; until one is set, measured events wait. */
  setSink(sink: RecorderSink): void {
    this.sink = sink;
  }

  /** Whether a recorder session is in progress (anything recorded or begun since the last reset). */
  get inSession(): boolean {
    return this.t0 !== null;
  }

  /** Raw (not yet measured) events held in memory. */
  get held(): number {
    return this.rawHeld;
  }

  /**
   * Allow recording again after an `endSession()` that ended no session in
   * progress — React StrictMode runs an effect's cleanup and setup once more
   * on mount, and the remount must behave like a fresh mount. A session in
   * progress is left alone.
   */
  rearm(): void {
    if (this.t0 === null) this.ended = false;
  }

  /**
   * The session's clock, numbering and cap usage, for a recorder taking it
   * over; null with no session. Only `endSession()` takes it, after measuring
   * and saving what was pending, so the counts include every event.
   */
  private handoff(): RecorderHandoff | null {
    if (this.t0 === null) return null;
    return {
      t0: this.t0,
      lastUnit: this.lastUnit,
      sessionBytes: this.c.sessionBytes,
      taken: this.c.taken,
      full: this.c.full,
    };
  }

  /**
   * Take over another recorder's session: `t_ms`, unit numbers and what the
   * session has used of its caps carry on from it.
   */
  continueFrom(handoff: RecorderHandoff): void {
    this.resetSession();
    this.ended = false;
    this.t0 = handoff.t0;
    this.lastUnit = handoff.lastUnit;
    this.c.sessionBytes = handoff.sessionBytes;
    this.c.taken = handoff.taken;
    this.c.full = handoff.full;
    this.enabled = this.enabledFor(this.gameType);
  }

  /**
   * Start a session: `t_ms` counts from here and units number from 1. A
   * recorder used without it starts one at its first `beginUnit`/`record`
   * (until its first `endSession`; after that only this restarts recording).
   */
  startSession(): void {
    this.resetSession();
    this.ended = false;
    this.ensureSession();
  }

  /**
   * Begin a unit (round / hand / trick / chunk), closing any open one. `n` is
   * the game's own number for it; by default the last unit's plus one, from 1.
   * Does nothing after `endSession()` until the next `startSession()`.
   */
  beginUnit(n?: number): number {
    const unit = n ?? this.lastUnit + 1;
    if (this.ended) return unit;
    this.ensureSession();
    if (this.unit) this.closeUnit();
    this.lastUnit = unit;
    this.unit = { n: unit, events: [] };
    return unit;
  }

  /**
   * Record one event in the open unit (one is begun if none is). Memory only.
   *
   * `data` is taken by ownership: pass a fresh, compact object (short keys,
   * ASCII codes) and never change it afterwards — the recorder keeps the
   * reference until it is measured and does not copy it. In development
   * builds it is shallow-frozen (whether or not it is kept), so a later
   * change throws there. Does nothing after `endSession()` until the next
   * `startSession()`.
   *
   * Allocation only: every `RECORDER_MEASURE_EVERY` events, the open unit's
   * events so far are handed to the idle measuring (the unit stays open under
   * its number, as in `flush()`), and at most `RECORDER_MAX_RAW_EVENTS`
   * unmeasured events are held — past that, events are dropped until idle
   * measures the backlog.
   */
  record(type: EventTypeOf<G>, data?: Record<string, unknown>, actor?: RecordActor): void {
    if (data && isDev()) Object.freeze(data);
    if (this.ended) return;
    this.ensureSession();
    if (!this.enabled) return;
    this.c.recorded += 1;
    // The session cap is reached, or certain to be: keep nothing more.
    if (this.c.full || this.c.taken >= this.ceiling) {
      this.c.droppedSessionCap += 1;
      return;
    }
    if (this.rawHeld >= RECORDER_MAX_RAW_EVENTS) {
      this.c.droppedMemory += 1;
      return;
    }
    if (!this.unit) this.beginUnit();
    const unit = this.unit;
    if (!unit) return;
    this.c.taken += 1;
    this.rawHeld += 1;
    const t_ms = Math.max(0, Math.round(this.now() - (this.t0 ?? 0)));
    unit.events.push({ type, data, actor, t_ms });
    if (unit.events.length >= RECORDER_MEASURE_EVERY) {
      // A long open unit: measure what it has so far at idle, same number.
      this.closed.push({ n: unit.n, events: unit.events });
      unit.events = [];
      this.scheduleWork();
    }
  }

  /** Close the open unit: it is measured (and, under `on_unit_close`, saved) at the next idle moment. */
  closeUnit(): void {
    const unit = this.unit;
    this.unit = null;
    if (!unit || unit.events.length === 0) return;
    this.closed.push(unit);
    this.scheduleWork();
  }

  /**
   * Schedule a save of what is waiting for the next idle moment
   * (`on_unit_close`; under `on_session_end` only the measuring). One task
   * at a time. `useGameRecorder` calls it when a game session opens, for
   * events recorded before it.
   */
  requestSave(): void {
    this.scheduleWork();
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
    this.measure();
    this.send();
  }

  /**
   * End the session: close the open unit, save everything still waiting now,
   * in one call, and report what the caps dropped (once, if anything). Call
   * before the session completes or closes, so its events precede
   * `game_ended`. Recording is refused until the next `startSession()`.
   *
   * Returns where the session stood once everything pending was measured and
   * saved (null with no session), for a recorder that takes it over
   * (`continueFrom`).
   */
  endSession(): RecorderHandoff | null {
    let handoff: RecorderHandoff | null = null;
    if (this.t0 !== null) {
      this.closeUnit();
      this.measure();
      this.send(true);
      this.reportDrops();
      handoff = this.handoff();
    }
    this.resetSession();
    this.ended = true;
    return handoff;
  }

  private ensureSession(): void {
    if (this.t0 !== null) return;
    this.t0 = this.now();
    this.enabled = this.enabledFor(this.gameType);
  }

  private resetSession(): void {
    this.generation += 1;
    this.taskScheduled = false;
    this.t0 = null;
    this.enabled = true;
    this.unit = null;
    this.lastUnit = 0;
    this.closed = [];
    this.rawHeld = 0;
    this.measured = [];
    this.c = freshCounters();
  }

  private scheduleWork(): void {
    if (this.taskScheduled) return;
    const sendable = this.policy === "on_unit_close" && this.measured.length > 0;
    if (this.closed.length === 0 && !sendable) return;
    this.taskScheduled = true;
    const generation = this.generation;
    this.schedule(() => {
      // A task left over from an earlier session: that session already saved
      // (or dropped) its events, and this one has its own task.
      if (generation !== this.generation) return;
      this.taskScheduled = false;
      this.measure();
      if (this.policy === "on_unit_close") this.send();
    });
  }

  /** Measure every closed unit once, keeping only what fits the caps; the raw events are released. */
  private measure(): void {
    if (this.closed.length === 0) return;
    const units = this.closed;
    this.closed = [];
    for (const unit of units) {
      this.rawHeld -= unit.events.length;
      for (const event of unit.events) {
        let sized: Sized | null = null;
        try {
          sized = this.size(unit.n, event);
        } catch {
          // Not serialisable (a BigInt, a cycle): this event only.
          this.c.droppedInvalid += 1;
        }
        if (sized) this.measured.push(sized);
      }
    }
  }

  /**
   * Hand the measured events to the sink in one call, when it can take them.
   * Otherwise they wait for the next save — unless this is the session's
   * last (`final`), when they are counted as `dropped_unsent`.
   */
  private send(final = false): void {
    if (this.measured.length === 0) return;
    const groups = this.measured;
    if (this.sink === null || !this.sink.canAccept()) {
      if (final) this.unsent(groups);
      return;
    }
    this.measured = [];
    const out: EnqueueEventInput[] = [];
    for (const g of groups) for (const e of g.events) out.push(e);
    let taken = false;
    try {
      taken = this.sink.enqueueMany(out);
    } catch (e) {
      Sentry.captureException(e, { tags: { subsystem: "gameRecorder", op: "save" } });
      this.unsent(groups); // the sink failed, not the session: the events are gone
      return;
    }
    if (taken) return;
    // Refused after all: keep them, already measured, for the next save.
    if (final) this.unsent(groups);
    else this.measured = groups.concat(this.measured);
  }

  /** Measured events that will never reach the queue: out of `saved`, into `dropped_unsent`. */
  private unsent(groups: readonly Sized[]): void {
    for (const g of groups) {
      this.c.saved -= 1;
      this.c.sessionBytes -= g.bytes;
      if (g.events.length > 1) {
        this.c.chunked -= 1;
        this.c.parts -= g.events.length;
      }
      this.c.droppedUnsent += 1;
    }
    if (groups === this.measured) this.measured = [];
  }

  /** The event with its envelope, within its caps (in parts if need be); null when dropped. */
  private size(unit: number, event: RecordedEvent): Sized | null {
    if (this.c.full) {
      this.c.droppedSessionCap += 1;
      return null;
    }
    const typeConfig = this.config.events[event.type];
    // A type with `envelope: false` is sent as recorded and measured as sent.
    const bare = typeConfig?.envelope === false;
    const data: Record<string, unknown> = bare
      ? (event.data ?? {})
      : {
          ...event.data,
          v: typeConfig?.v ?? 1,
          unit,
          t_ms: event.t_ms,
        };
    if (!bare) {
      if (event.actor) data.actor = event.actor;
      else delete data.actor;
      delete data.part;
      delete data.parts;
    }
    const bytes = jsonLength(data);
    this.c.largestBytes = Math.max(this.c.largestBytes, bytes);
    const cap = recordingEventCap(this.config, event.type);
    let sized: Sized | null = null;
    if (bytes <= cap) sized = { events: [{ type: event.type, data }], bytes };
    else if (typeConfig?.chunkField && !bare)
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
    const dropped =
      c.droppedOversize +
      c.droppedSessionCap +
      c.droppedInvalid +
      c.droppedUnsent +
      c.droppedMemory;
    if (dropped === 0) return;
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
        dropped_unsent: c.droppedUnsent,
        dropped_memory: c.droppedMemory,
        saved_bytes: c.sessionBytes,
        largest_bytes: c.largestBytes,
      });
    } catch {
      // Isolation: a report never blocks the session's end.
    }
  }
}
