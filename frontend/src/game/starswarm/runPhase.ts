/**
 * Star Swarm's run lifecycle as one reducer (#2981): which of the difficulty picker, a live
 * run, a paused run and a finished run is on screen, the finished run's result card, and the
 * tick that tells the canvas to start a fresh run.
 *
 *   picker --START--> running --PAUSE--> paused --RESUME--> running
 *                        |                  |
 *                        +----GAME_OVER-----+--> over
 *   any --OPEN_PICKER--> picker
 *
 * The picker is a card over the board, not a reset: it remembers the run it covers
 * (`covers`), so the music keeps playing over a live run, holds over a paused one and stays
 * off over a finished one, and Back over a paused run still saves it. A cold start with no
 * saved run opens the picker over an empty board, which reads like a live one ("running").
 */
import type { DifficultyTier } from "./types";

export type RunPhase = "picker" | "running" | "paused" | "over";

/** The run's own state: what the picker covers, and the phase whenever the picker is closed. */
type RunUnderPicker = Exclude<RunPhase, "picker">;

/** The finished run the result card shows (#2516). */
export interface RunResult {
  readonly score: number;
  readonly wave: number;
  /** The tier the run was played at — its board, which can differ from the picker's (#2567). */
  readonly tier: DifficultyTier;
  readonly best: number;
  readonly isNewBest: boolean;
}

export interface RunState {
  readonly phase: RunPhase;
  /** The run behind the picker; equal to `phase` whenever the picker is closed. */
  readonly covers: RunUnderPicker;
  /**
   * A finished run whose board is held: it ended while paused. The E2E `endRun` hook (#2516)
   * pauses first, so the canvas stays frozen behind the card; a run the engine ends needs none.
   */
  readonly frozen: boolean;
  /** The finished run's card; null while playing and once the picker opens. */
  readonly result: RunResult | null;
  /** Bumped by every new run; GameCanvas resets its engine when it changes. */
  readonly resetTick: number;
}

export type RunAction =
  | { readonly type: "START" }
  | { readonly type: "OPEN_PICKER" }
  | { readonly type: "PAUSE" }
  | { readonly type: "RESUME" }
  | { readonly type: "GAME_OVER"; readonly result: RunResult };

/** A run restored from a saved pause opens paused; otherwise the picker comes first. */
export function initialRunState(restoredPausedRun: boolean): RunState {
  return restoredPausedRun
    ? { phase: "paused", covers: "paused", frozen: false, result: null, resetTick: 0 }
    : { phase: "picker", covers: "running", frozen: false, result: null, resetTick: 0 };
}

/** The run is held — paused, or finished while paused — whether or not the picker covers it. */
export function isRunPaused(state: RunState): boolean {
  return state.covers === "paused" || (state.covers === "over" && state.frozen);
}

/** The run has ended, whether or not the picker covers it. */
export function isRunOver(state: RunState): boolean {
  return state.covers === "over";
}

/** A run is on screen and not over — the only time pausing means anything. */
export function isLiveRun(state: RunState): boolean {
  return state.phase === "running" || state.phase === "paused";
}

/** Moves the run itself to `next`, leaving an open picker open over it. */
function setRun(state: RunState, next: RunUnderPicker): RunState {
  return state.phase === "picker"
    ? { ...state, covers: next }
    : { ...state, phase: next, covers: next };
}

export function runReducer(state: RunState, action: RunAction): RunState {
  switch (action.type) {
    case "START":
      return {
        phase: "running",
        covers: "running",
        frozen: false,
        result: null,
        resetTick: state.resetTick + 1,
      };
    case "OPEN_PICKER":
      // The card steps aside for the picker.
      return { ...state, phase: "picker", result: null };
    case "PAUSE":
      if (state.covers === "running") return setRun(state, "paused");
      if (state.covers === "over" && !state.frozen) return { ...state, frozen: true };
      return state;
    case "RESUME":
      if (state.covers === "paused") return setRun(state, "running");
      if (state.covers === "over" && state.frozen) return { ...state, frozen: false };
      return state;
    case "GAME_OVER":
      return { ...setRun(state, "over"), frozen: isRunPaused(state), result: action.result };
  }
}
