/**
 * The Hearts play clock (#2629): active play time only.
 *
 * A match spans many hands and often several visits, so the clock adds up
 * the spans the game is actually on screen: it runs while an unfinished game
 * is shown with the app in the foreground, and pauses when the app goes to
 * the background, the screen loses focus, or the game ends. The total goes
 * out as the game's `durationMs` (and on an abandon).
 *
 * The screen keeps the clock in a ref rather than in `HeartsState`: the AI
 * turn loop writes back a state copied before its awaits, which would undo a
 * pause made meanwhile. Saves persist the total as `SavedHeartsState.accumulatedMs`
 * (see `withPlayTime`), so it survives a restore and a killed app; time spent
 * away from the app is never counted, since a restored clock starts a new span.
 * The total belongs to one game session: the screen restores it only when it
 * continues that session, and starts from 0 otherwise.
 */

import type { HeartsState, SavedHeartsState } from "./types";

export interface PlayClock {
  /** Play time of the finished spans. */
  readonly accumulatedMs: number;
  /** `Date.now()` when the current span began; null while paused. */
  readonly runningSince: number | null;
}

/** A paused clock holding `accumulatedMs` (`loadGame` sanitises a stored value). */
export function pausedClock(accumulatedMs = 0): PlayClock {
  return { accumulatedMs, runningSince: null };
}

/** Total play time, including the running span. */
export function clockMs(clock: PlayClock, now: number = Date.now()): number {
  if (clock.runningSince === null) return clock.accumulatedMs;
  return clock.accumulatedMs + Math.max(0, now - clock.runningSince);
}

/** Starts a span, unless one is running. */
export function runClock(clock: PlayClock, now: number = Date.now()): PlayClock {
  return clock.runningSince === null ? { ...clock, runningSince: now } : clock;
}

/** Ends the running span, folding it into the total. */
export function pauseClock(clock: PlayClock, now: number = Date.now()): PlayClock {
  return clock.runningSince === null ? clock : pausedClock(clockMs(clock, now));
}

/** The state as saved: carrying the clock's total so far. */
export function withPlayTime(
  state: HeartsState,
  clock: PlayClock,
  now: number = Date.now()
): SavedHeartsState {
  return { ...state, accumulatedMs: Math.round(clockMs(clock, now)) };
}
