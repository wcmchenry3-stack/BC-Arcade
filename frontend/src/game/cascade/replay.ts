/**
 * Cascade's replay recording (#3858, epic #3273): what a game records on the shared
 * `GameRecorder`, and how a recorded game is rebuilt.
 *
 * What is recorded (docs/games/cascade-decisions.md#replay-recording-3858):
 *  - `game_started` (`startedData`): the piece set, the queue seed, the engine seed (the drop
 *    nudge's RNG), the physics tuning id and `engine_version`. The app version is not recorded
 *    yet (#3942, for every game); the golden fixture, recorded before, still carries one.
 *  - One unit per `CASCADE_DROPS_PER_UNIT` drops (or fewer, when the game ends or the app goes
 *    to the background): a `drop` event, `{ d: [[step, x_tenths, tier], ...], z?: [[start,
 *    peak], ...], rs?: 1 }`, and a `merge` event, `{ m: [[step, tierFrom, chain], ...] }`.
 *    `step` is the engine's fixed-step index (`CascadeEngine.steps`), never wall time; `x` is in
 *    tenths of a pixel (the screen drops at exactly that x, `quantizeX`); `chain` counts the
 *    merges since the last drop, from 1; `z` holds the danger moments (the lid's overflow count
 *    ran from `start` to `peak` steps); `rs` marks the first unit whose steps cannot be
 *    re-simulated from `game_started`: after a restored game, or a test seam's reseed.
 *  - `game_ended` (`CascadeLog.endData`, beside #3700's result block): the step the game ended
 *    on, the step the capstone was made (a win), the first step the lid's count ran.
 *  - Rebuilding a recorded game: `rebuild.ts`.
 *  - No positions per frame and no board snapshots.
 *
 * Cost, then performance: the screen's moments (`drop`, `merge`, `danger`) only push a small
 * tuple into this module's arrays; nothing runs per frame or on the physics step. A unit is
 * handed to the recorder in one go (`close`) on a drop, the game's end or a background, and the
 * recorder measures and saves it at the next idle moment, one storage write. Caps: the per-event
 * and per-session caps in `eventQueueConfig.ts`, `CASCADE_MAX_UNITS` units a game,
 * `CASCADE_MAX_DANGER` danger moments a game; past a cap the game records nothing more of it and
 * says so in `game_ended` (`rec_cut`, `z_cut`).
 *
 * Replays: physics replays bit for bit only within one JS engine (engine.ts), so the merges and
 * the outcome are recorded to tell the game's story on their own; `rebuild` (rebuild.ts) re-simulates the
 * drops as a best-effort extra (the golden test runs it on V8). Never verify a score on the
 * server by re-simulation.
 */
import { CASCADE_MAX_UNITS } from "../_shared/eventQueueConfig";
import { CASCADE_TUNING_ID } from "./constants";
import { ENGINE_VERSION, type EngineEvent } from "./engine";
import { CAPSTONE_TIER } from "./tiers";

/** Drops per unit: one `drop` and one `merge` row per this many drops. */
export const CASCADE_DROPS_PER_UNIT = 20;
/** A drop's x is recorded, and played, in tenths of a pixel. */
export const X_SCALE = 10;
/** A danger moment shorter than this (fixed steps, 1/6 s) is a flicker, not recorded. */
export const DANGER_MIN_TICKS = 10;
/** The most danger moments one game records; the rest are counted in `game_ended` (`z_cut`). */
export const CASCADE_MAX_DANGER = 32;

export type DropTuple = [step: number, xTenths: number, tier: number];
export type MergeTuple = [step: number, tierFrom: number, chain: number];
export type DangerTuple = [start: number, peak: number];

/** The x a drop is played and recorded at: `x` to a tenth of a pixel. */
export function quantizeX(x: number): number {
  return Math.round(x * X_SCALE) / X_SCALE;
}

/** A game's two seeds: the piece queue's and the engine's drop nudge. */
export interface CascadeSeeds {
  readonly queue: number;
  readonly engine: number;
}

/** Fresh seeds, each in 1..2^31-1 (the queue's Lehmer generator needs a non-zero seed). */
export function newSeeds(random: () => number = Math.random): CascadeSeeds {
  const draw = () => 1 + Math.floor(random() * 0x7ffffffe);
  return { queue: draw(), engine: draw() };
}

/** What `game_started` carries for a Cascade game (a type: `useGameSync` takes a Record). */
export type CascadeStarted = {
  readonly fruit_set: string;
  readonly theme: string;
  /** The piece queue's seed. */
  readonly seed: number;
  /** The engine's seed: the drop nudge (`CascadeEngine` `seed`). */
  readonly engine_seed: number;
  readonly tuning: string;
  readonly engine_version: number;
};

export function startedData(pieceSet: string, seeds: CascadeSeeds): CascadeStarted {
  return {
    fruit_set: pieceSet,
    theme: pieceSet,
    seed: seeds.queue,
    engine_seed: seeds.engine,
    tuning: CASCADE_TUNING_ID,
    engine_version: ENGINE_VERSION,
  };
}

/** The part of the recorder the log writes to (`useGameRecorder("cascade")`). */
export interface CascadeRecordSink {
  beginUnit(n?: number): number;
  record(type: "drop" | "merge", data: Record<string, unknown>): void;
  closeUnit(): void;
}

/** What a game adds to its `game_ended` data. */
export type CascadeEndData = {
  /** The fixed step the game ended on (the loss, the win, or the abandon). */
  readonly end_step: number;
  /** The step the capstone was made: the win. */
  readonly capstone_step?: number;
  /** The first step the lid's overflow count ran. */
  readonly lid_step?: number;
  /** Units not recorded past `CASCADE_MAX_UNITS`. */
  readonly rec_cut?: number;
  /** Danger moments not recorded past `CASCADE_MAX_DANGER`. */
  readonly z_cut?: number;
};

/**
 * What a save carries of the log (#3858), so a relaunched game keeps its per-game counts: its
 * unit number and the caps' counts (`SavedState.replay`, storage.ts).
 */
export interface CascadeLogSave {
  /** The unit number: the last unit, plus the one waiting, if any. */
  readonly unit: number;
  /** Danger moments kept, of `CASCADE_MAX_DANGER`. */
  readonly danger: number;
  readonly unitsCut: number;
  readonly dangerCut: number;
}

export interface CascadeLog {
  /** Where units go from now on (the recorder); returns the detach. Until then they are dropped. */
  attach(sink: CascadeRecordSink): () => void;
  /** A new game: everything is cleared and units number from 1. */
  start(): void;
  /**
   * The game was restored from a save (#2654): its units continue after the save's (the units
   * the earlier process may have saved), its cap counts carry on, and the next unit is marked
   * `rs` (its steps restart on a restored board, so it cannot be re-simulated). A save from an
   * older build has none of it: counted from where the log stands.
   */
  restored(saved?: Partial<CascadeLogSave>): void;
  /**
   * The game's steps no longer follow from `game_started` (a test seam reseeded the queue and the
   * engine mid-game): the next unit is marked `rs`, like a restore.
   */
  markUnreplayable(): void;
  drop(step: number, x: number, tier: number): void;
  /** A merge of two `tierFrom` pieces, in fixed step `step`. */
  merge(step: number, tierFrom: number): void;
  /** A danger moment (the engine's `danger` event). */
  danger(start: number, peak: number): void;
  /** Hands what is waiting to the recorder as one unit (nothing when nothing waits). */
  close(): void;
  /** What a save carries (`CascadeLogSave`). */
  saveState(): CascadeLogSave;
  endData(endStep: number): CascadeEndData;
}

export function createCascadeLog(initialSink: CascadeRecordSink | null = null): CascadeLog {
  let sink = initialSink;
  let unit = 0;
  let drops: DropTuple[] = [];
  let merges: MergeTuple[] = [];
  let danger: DangerTuple[] = [];
  let chain = 0;
  let dangerKept = 0;
  let dangerCut = 0;
  let unitsCut = 0;
  /** The next unit is marked `rs` (a restore or a reseed). */
  let resumed = false;
  let capstoneStep: number | null = null;
  let lidStep: number | null = null;

  const pending = () => drops.length + merges.length + danger.length > 0 || resumed;

  function close(): void {
    if (!pending()) return;
    const d = drops;
    const m = merges;
    const z = danger;
    const rs = resumed;
    drops = [];
    merges = [];
    danger = [];
    resumed = false;
    if (unit >= CASCADE_MAX_UNITS) {
      unitsCut += 1;
      return;
    }
    unit += 1;
    if (!sink) return;
    sink.beginUnit(unit);
    if (d.length > 0 || z.length > 0 || rs) {
      sink.record("drop", { d, ...(z.length > 0 && { z }), ...(rs && { rs: 1 }) });
    }
    if (m.length > 0) sink.record("merge", { m });
    sink.closeUnit();
  }

  return {
    attach(next) {
      sink = next;
      return () => {
        if (sink === next) sink = null;
      };
    },
    start() {
      unit = 0;
      drops = [];
      merges = [];
      danger = [];
      chain = 0;
      dangerKept = 0;
      dangerCut = 0;
      unitsCut = 0;
      resumed = false;
      capstoneStep = null;
      lidStep = null;
    },
    restored(saved) {
      const count = (v: number | undefined, now: number) =>
        Number.isInteger(v) && (v as number) > now ? (v as number) : now;
      unit = count(saved?.unit, unit);
      dangerKept = count(saved?.danger, dangerKept);
      unitsCut = count(saved?.unitsCut, unitsCut);
      dangerCut = count(saved?.dangerCut, dangerCut);
      resumed = true;
    },
    markUnreplayable() {
      resumed = true;
    },
    drop(step, x, tier) {
      chain = 0;
      drops.push([step, Math.round(x * X_SCALE), tier]);
      if (drops.length >= CASCADE_DROPS_PER_UNIT) close();
    },
    merge(step, tierFrom) {
      chain += 1;
      merges.push([step, tierFrom, chain]);
      if (tierFrom + 1 === CAPSTONE_TIER && capstoneStep === null) capstoneStep = step;
    },
    danger(start, peak) {
      if (lidStep === null) lidStep = start;
      if (peak < DANGER_MIN_TICKS) return;
      if (dangerKept >= CASCADE_MAX_DANGER) {
        dangerCut += 1;
        return;
      }
      dangerKept += 1;
      danger.push([start, peak]);
    },
    close,
    saveState: () => ({
      unit: Math.min(unit + (pending() ? 1 : 0), CASCADE_MAX_UNITS),
      danger: dangerKept,
      unitsCut,
      dangerCut,
    }),
    endData(endStep) {
      return {
        end_step: endStep,
        ...(capstoneStep !== null && { capstone_step: capstoneStep }),
        ...(lidStep !== null && { lid_step: lidStep }),
        ...(unitsCut > 0 && { rec_cut: unitsCut }),
        ...(dangerCut > 0 && { z_cut: dangerCut }),
      };
    },
  };
}

/** Feeds a step's engine events to the log: merges and danger moments. */
export function logEngineEvents(log: CascadeLog, events: readonly EngineEvent[]): void {
  for (const ev of events) {
    if (ev.type === "merge") log.merge(ev.step, ev.tierA);
    else if (ev.type === "danger") log.danger(ev.start, ev.peak);
  }
}
