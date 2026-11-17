/**
 * Rebuilding a recorded Cascade game (#3858): best effort, on one JS engine only.
 *
 * A recorded game is its `game_started` (the engine seed, the tuning, `engine_version`) and its
 * drops (`replay.ts`). `rebuild` steps a fresh engine on that seed one fixed step at a time to
 * each drop's step and drops there, and reports the score, the merges and the outcome it reaches.
 * Planck's trigonometry can differ in the last bit between Hermes, JavaScriptCore and V8, so a
 * chaotic pile may replay differently on another engine than the one that recorded it: the
 * recorded merges and outcome tell the game's story on their own (the backend reads them,
 * `backend/cascade/replay.py`). Never verify a score on the server by re-simulation. Separate
 * from `replay.ts` so the screen's bundle does not carry it; the tests and tooling read it.
 */
import { replayEngines, type ReplayEngines } from "../_shared/replayEngine";
import { CASCADE_TUNING_ID, FIXED_STEP_MS } from "./constants";
import { CascadeEngine, ENGINE_VERSION } from "./engine";
import { X_SCALE, type DangerTuple, type DropTuple, type MergeTuple } from "./replay";
import { CAPSTONE_TIER } from "./tiers";

/** A recorded event as stored: its type and data. */
export interface RecordedEvent {
  readonly type: string;
  readonly data: unknown;
}

/** Today's rules: a fresh engine on a seed. */
export interface CascadeRules {
  readonly createEngine: (seed: number) => CascadeEngine;
}

const createEngine = (seed: number): CascadeEngine => new CascadeEngine({ seed });

/** #3912: the rules each recorded `engine_version` replays with. */
export const REPLAY_ENGINES: ReplayEngines<CascadeRules> = replayEngines(
  "cascade",
  ENGINE_VERSION,
  {
    createEngine,
  }
);

export type Rebuilt =
  | {
      readonly ok: true;
      readonly score: number;
      readonly drops: number;
      readonly merges: MergeTuple[];
      readonly danger: DangerTuple[];
      readonly outcome: "win" | "loss" | null;
      readonly endStep: number;
      readonly capstoneStep: number | null;
    }
  | { readonly ok: false; readonly reason: string };

/** The most fixed steps a rebuild runs past the last drop when no end step is given (2 min). */
const TAIL_STEPS = 7200;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const isTuple = (v: unknown, n: number): v is number[] =>
  Array.isArray(v) && v.length === n && v.every((x) => Number.isInteger(x));

/**
 * Re-simulates a recorded game from its `game_started` data and its events (in event_index
 * order): a fresh engine on the recorded seed, stepped one fixed step at a time to each drop's
 * step, then on to `endStep` (the `game_ended` `end_step`) or to the game's end. Bit-exact only on
 * the JS engine that recorded it (engine.ts); a mismatch elsewhere is not an error in the game.
 */
export function rebuild(
  started: unknown,
  events: readonly RecordedEvent[],
  endStep?: number
): Rebuilt {
  const engines = REPLAY_ENGINES.resolve(started);
  if (engines.kind === "incompatible") return { ok: false, reason: engines.reason };
  if (!isRecord(started) || !Number.isInteger(started.engine_seed)) {
    return { ok: false, reason: "no engine_seed in game_started" };
  }
  if (started.tuning !== CASCADE_TUNING_ID) {
    return {
      ok: false,
      reason: `tuning ${JSON.stringify(started.tuning)}, this reader rebuilds ${CASCADE_TUNING_ID}`,
    };
  }
  const drops: DropTuple[] = [];
  for (const e of events) {
    if (e.type !== "drop" || !isRecord(e.data)) continue;
    if (e.data.rs !== undefined) return { ok: false, reason: "a restored game: not re-simulated" };
    const d = e.data.d;
    if (!Array.isArray(d) || !d.every((t) => isTuple(t, 3))) {
      return { ok: false, reason: "a malformed drop event" };
    }
    drops.push(...(d as DropTuple[]));
  }

  const engine = engines.rules.createEngine(started.engine_seed as number);
  const game = {
    merges: [] as MergeTuple[],
    danger: [] as DangerTuple[],
    chain: 0,
    outcome: null as "win" | "loss" | null,
    capstoneStep: null as number | null,
  };
  const stepOnce = (): void => {
    for (const ev of engine.step(FIXED_STEP_MS).events) {
      if (ev.type === "merge") {
        game.chain += 1;
        game.merges.push([ev.step, ev.tierA, game.chain]);
        if (ev.result === CAPSTONE_TIER) game.capstoneStep = ev.step;
      } else if (ev.type === "danger") {
        game.danger.push([ev.start, ev.peak]);
      } else if (ev.type === "win" || ev.type === "gameOver") {
        game.outcome = ev.type === "win" ? "win" : "loss";
      }
    }
  };
  try {
    for (const [at, xTenths, tier] of drops) {
      if (at < engine.steps) return { ok: false, reason: `a drop out of order at step ${at}` };
      while (engine.steps < at && game.outcome === null) stepOnce();
      if (game.outcome !== null) {
        return { ok: false, reason: `the game ended before the drop at step ${at}` };
      }
      game.chain = 0;
      engine.drop(tier, xTenths / X_SCALE);
    }
    const lastDrop = drops.length > 0 ? drops[drops.length - 1]![0] : 0;
    const until = endStep ?? lastDrop + TAIL_STEPS;
    while (engine.steps < until && game.outcome === null) stepOnce();
    return {
      ok: true,
      score: engine.getState().score,
      drops: drops.length,
      merges: game.merges,
      danger: game.danger,
      outcome: game.outcome,
      endStep: engine.steps,
      capstoneStep: game.capstoneStep,
    };
  } finally {
    engine.destroy();
  }
}
