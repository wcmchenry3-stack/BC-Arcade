/**
 * FreeCell's play clock (#3607), for the TIME on the stat line. It lives on the
 * game state (`FreeCellState.clock`), set by the screen, never by the engine,
 * like `recorded`: it starts at the first move, pauses while the player is away,
 * freezes at the win, and is saved with the game, so a resumed game carries on
 * from its time. An undo does not rewind it.
 *
 * The time reported for the game (`durationMs`) is still `useGameSync`'s
 * active-play window; this clock is what the player sees.
 */

import {
  clockForSave,
  clockOnLoad,
  pauseClock,
  resumeClock,
  startClockOnMove,
  stopClock,
  type PlayClock,
} from "../_shared/playClock";
import type { FreeCellState } from "./types";

/** A clock that has not started: the deal's, and a save from before #3607. */
const NOT_STARTED: PlayClock = { startedAt: null, accumulatedMs: 0 };

/** The game's clock; a game with none has not started. */
export function clockOf(state: FreeCellState): PlayClock {
  return state.clock ?? NOT_STARTED;
}

/**
 * `next` (a move or an Auto-Complete step made on `prev`) with the clock: started
 * by the first move, running on after it, stopped by the move that wins. A paused
 * clock stays paused (the move landed while the player was away).
 */
export function withMoveClock(
  prev: FreeCellState,
  next: FreeCellState,
  now: number = Date.now()
): FreeCellState {
  const clock = startClockOnMove(clockOf(prev), now);
  return {
    ...next,
    clock: next.isComplete && !prev.isComplete ? stopClock(clock, now) : clock,
  };
}

/** `next` (an undo, a hint) with `prev`'s clock: those never rewind or restart it. */
export function withClockOf(prev: FreeCellState, next: FreeCellState): FreeCellState {
  if (prev.clock === next.clock) return next;
  if (prev.clock === undefined) {
    const { clock: _dropped, ...rest } = next;
    return rest;
  }
  return { ...next, clock: prev.clock };
}

/** Pause a running clock (the player left). */
export function pauseGame(state: FreeCellState, now: number = Date.now()): FreeCellState {
  const clock = clockOf(state);
  const paused = pauseClock(clock, now);
  return paused === clock ? state : { ...state, clock: paused };
}

/** Run a paused clock again (the player is back). A finished game stays frozen. */
export function resumeGame(state: FreeCellState, now: number = Date.now()): FreeCellState {
  if (state.isComplete) return state;
  const clock = clockOf(state);
  const resumed = resumeClock(clock, now);
  return resumed === clock ? state : { ...state, clock: resumed };
}

/** The game as it is saved: the running segment banked (`clockForSave`). */
export function forSave(state: FreeCellState, now: number = Date.now()): FreeCellState {
  if (state.clock === undefined) return state;
  return { ...state, clock: clockForSave(state.clock, now) };
}

/** The game as it is loaded: none of the time the app was closed counts (`clockOnLoad`). */
export function onLoad(state: FreeCellState, now: number = Date.now()): FreeCellState {
  if (state.clock === undefined) return state;
  return { ...state, clock: clockOnLoad(state.clock, state.isComplete, now) };
}
