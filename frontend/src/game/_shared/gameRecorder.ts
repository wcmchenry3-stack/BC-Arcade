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
 *    storage, no Sentry, no logging per event.
 *  - A save is one `enqueueEvents` call — one eventStore write per tier the
 *    events touch, so a unit costs one AsyncStorage write, not one per event.
 *  - Saves run off the interaction path: `on_unit_close` hands the save to
 *    `schedule` (an idle callback by default), never inside the gesture or
 *    animation callback that closed the unit. No timers or intervals.
 *  - Every event is sized once, at save, against its type's cap
 *    (`recordingEventCap`, eventQueueConfig.ts), and the session against its
 *    cap. An oversized event is split into parts when its type is chunkable,
 *    else dropped; once the session cap is reached the rest of the session is
 *    dropped (a clean prefix, never a replay with holes). Drops are reported
 *    to Sentry once per session, by counts and sizes only — so a recorded
 *    event never reaches eventStore's silent `{_truncated: true}` stub.
 *
 * Send policies:
 *  - `on_unit_close` (turn-based games): each closed unit is saved at the
 *    next idle moment; units closed before it runs are saved together.
 *  - `on_session_end` (Star Swarm): closed units wait in memory and the whole
 *    session is saved in one call at `endSession()`.
 * Either way `endSession()` saves synchronously whatever is still waiting
 * (the open unit too), so a session's events always precede its
 * `game_ended`: call it before completing or closing the session —
 * `useGameRecorder` does.
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

/** Where saved events go: `useGameSync.enqueueMany`. */
export type RecorderSink = (events: readonly EnqueueEventInput[]) => void;

/** What a session's drop report carries: counts and sizes, nothing that identifies the session. */
export interface RecordingDropReport {
  readonly game_type: GameType;
  /** Events recorded this session. */
  readonly recorded: number;
  /** Events saved, whole or in parts. */
  readonly saved: number;
  /** Saved events that were split, and the parts they made. */
  readonly chunked: number;
  readonly parts: number;
  /** Events over their type's cap that could not be split. */
  readonly dropped_oversize: number;
  /** Events left out once the session cap was reached. */
  readonly dropped_session_cap: number;
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
  readonly events: RecordedEvent[];
}

/**
 * Run `task` when the JS thread is idle (`requestIdleCallback`, which React
 * Native provides), else after the current task's microtasks. Never a timer.
 */
export function scheduleIdle(task: () => void): void {
  const ric = (globalThis as { requestIdleCallback?: (cb: () => void) => unknown })
    .requestIdleCallback;
  if (typeof ric === "function") ric(task);
  else void Promise.resolve().then(task);
}

function reportToSentry(report: RecordingDropReport): void {
  Sentry.captureMessage("gameRecorder: recorded events over the size caps not saved", {
    level: "warning",
    tags: { subsystem: "gameRecorder", game_type: report.game_type },
    extra: { ...report },
  });
}

function jsonLength(value: unknown): number {
  // `undefined` inside an array serialises as `null`
  return JSON.stringify(value)?.length ?? 4;
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

export class GameRecorder {
  readonly gameType: GameType;
  readonly policy: SendPolicy;
  private sink: RecorderSink | null;
  private readonly config: GameRecordingConfig;
  private readonly now: () => number;
  private readonly schedule: (task: () => void) => void;
  private readonly report: (report: RecordingDropReport) => void;
  private readonly enabledFor: (gameType: GameType) => boolean;

  // Session state — reset by startSession / endSession.
  /** `now()` at the session's start; null until the session's first call. */
  private t0: number | null = null;
  private enabled = true;
  private unit: Unit | null = null;
  private lastUnit = 0;
  /** Closed units not saved yet. */
  private closed: Unit[] = [];
  private saveScheduled = false;
  private sessionBytes = 0;
  /** The session cap was reached: everything after is dropped. */
  private full = false;
  private recorded = 0;
  private saved = 0;
  private chunked = 0;
  private parts = 0;
  private droppedOversize = 0;
  private droppedSessionCap = 0;
  private largestBytes = 0;

  constructor(options: GameRecorderOptions) {
    this.gameType = options.gameType;
    this.policy = options.policy ?? "on_unit_close";
    this.sink = options.sink ?? null;
    this.config = options.config ?? recordingConfigFor(options.gameType);
    this.now = options.now ?? Date.now;
    this.schedule = options.schedule ?? scheduleIdle;
    this.report = options.report ?? reportToSentry;
    this.enabledFor = options.enabled ?? isRecordingEnabled;
  }

  /** Where saves go; until one is set, closed units wait. */
  setSink(sink: RecorderSink): void {
    this.sink = sink;
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

  /** Record one event in the open unit (one is begun if none is). Memory only. */
  record(type: string, data?: Record<string, unknown>, actor?: RecordActor): void {
    this.ensureSession();
    if (!this.enabled) return;
    if (!this.unit) this.beginUnit();
    this.recorded += 1;
    const t_ms = Math.max(0, Math.round(this.now() - (this.t0 ?? 0)));
    this.unit?.events.push({ type, data, actor, t_ms });
  }

  /** Close the open unit. Under `on_unit_close` its save is scheduled for the next idle moment. */
  closeUnit(): void {
    const unit = this.unit;
    this.unit = null;
    if (!unit || unit.events.length === 0) return;
    this.closed.push(unit);
    if (this.policy !== "on_unit_close" || this.saveScheduled) return;
    this.saveScheduled = true;
    this.schedule(() => {
      this.saveScheduled = false;
      this.save();
    });
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
    this.t0 = null;
    this.enabled = true;
    this.unit = null;
    this.lastUnit = 0;
    this.closed = [];
    this.sessionBytes = 0;
    this.full = false;
    this.recorded = 0;
    this.saved = 0;
    this.chunked = 0;
    this.parts = 0;
    this.droppedOversize = 0;
    this.droppedSessionCap = 0;
    this.largestBytes = 0;
  }

  /** Size and save every closed unit in one sink call. */
  private save(): void {
    if (this.closed.length === 0 || this.sink === null) return;
    const units = this.closed;
    this.closed = [];
    try {
      const out: EnqueueEventInput[] = [];
      for (const unit of units) {
        for (const event of unit.events) {
          const sized = this.size(unit.n, event);
          if (sized) for (const e of sized.events) out.push(e);
        }
      }
      if (out.length > 0) this.sink(out);
    } catch (e) {
      Sentry.captureException(e, { tags: { subsystem: "gameRecorder", op: "save" } });
    }
  }

  /** The event with its envelope, within its caps (in parts if need be); null when dropped. */
  private size(unit: number, event: RecordedEvent): Sized | null {
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
    this.largestBytes = Math.max(this.largestBytes, bytes);
    if (this.full) {
      this.droppedSessionCap += 1;
      return null;
    }
    const cap = recordingEventCap(this.config, event.type);
    let sized: Sized | null = null;
    if (bytes <= cap) sized = { events: [{ type: event.type, data }], bytes };
    else if (typeConfig?.chunkField)
      sized = splitEvent(event.type, data, typeConfig.chunkField, cap);
    if (!sized) {
      this.droppedOversize += 1;
      return null;
    }
    if (this.sessionBytes + sized.bytes > this.config.sessionMaxBytes) {
      this.full = true;
      this.droppedSessionCap += 1;
      return null;
    }
    if (sized.events.length > 1) {
      this.chunked += 1;
      this.parts += sized.events.length;
    }
    this.sessionBytes += sized.bytes;
    this.saved += 1;
    return sized;
  }

  private reportDrops(): void {
    if (this.droppedOversize === 0 && this.droppedSessionCap === 0) return;
    try {
      this.report({
        game_type: this.gameType,
        recorded: this.recorded,
        saved: this.saved,
        chunked: this.chunked,
        parts: this.parts,
        dropped_oversize: this.droppedOversize,
        dropped_session_cap: this.droppedSessionCap,
        saved_bytes: this.sessionBytes,
        largest_bytes: this.largestBytes,
      });
    } catch {
      // Isolation: a report never blocks the session's end.
    }
  }
}
