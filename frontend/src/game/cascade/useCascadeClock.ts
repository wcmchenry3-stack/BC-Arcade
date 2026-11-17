/**
 * Cascade's play clock (#2750, #3700): a shared `PlayClock` kept in a ref (the loop and the
 * session callbacks read it outside a render), with the screen's moves on it.
 *
 * - A new game's clock is not started: its first piece starts it (`start`, `startClockOnMove`),
 *   so time looking at an empty board costs no time bonus (#3700).
 * - It stops while the player is away (`pause` / `resume`, from `usePauseWhileAway`: another
 *   screen covers the board, #2735, or the app is in the background) and for good at the
 *   game's end (`stop`), so the session and the result card read the same time.
 * - A restored game runs on from the load with its saved play banked (`restore`), paused if the
 *   load lands while the player is away.
 */
import { monotonicNow } from "../_shared/monotonicNow";
import { useState } from "react";
import {
  clockElapsedMs,
  pauseClock,
  resumeClock,
  startClockOnMove,
  stopClock,
  type PlayClock,
} from "../_shared/playClock";

interface CascadeClock {
  /** A new game: not started until its first piece. */
  reset(): void;
  /** A restored game: runs from now with `accumulatedMs` banked (paused if away). */
  restore(accumulatedMs: number): void;
  /** A piece went in: the first one starts the clock (never after `stop`, until `reset`/`restore`). */
  start(): void;
  /** The game ended. */
  stop(): void;
  /** The player left (another screen, the background). */
  pause(): void;
  /** The player is back. */
  resume(): void;
  /** Play time so far, ms. */
  elapsed(): number;
}

const NOT_STARTED: PlayClock = { startedAt: null, accumulatedMs: 0 };

/** One clock for the screen's lifetime; the returned object is stable. */
function createCascadeClock(now: () => number = monotonicNow): CascadeClock {
  let clock = NOT_STARTED;
  let away = false;
  // The game ended: no piece starts the clock again until a new or restored game.
  let stopped = false;
  return {
    reset: () => {
      clock = NOT_STARTED;
      stopped = false;
    },
    restore: (accumulatedMs) => {
      stopped = false;
      clock =
        clock.paused === true || away
          ? { accumulatedMs, startedAt: null, paused: true }
          : { accumulatedMs, startedAt: now() };
    },
    start: () => {
      if (!stopped) clock = startClockOnMove(clock, now());
    },
    stop: () => {
      stopped = true;
      clock = stopClock(clock, now());
    },
    pause: () => {
      away = true;
      clock = pauseClock(clock, now());
    },
    resume: () => {
      away = false;
      clock = resumeClock(clock, now());
    },
    elapsed: () => clockElapsedMs(clock, now()),
  };
}

export function useCascadeClock(): CascadeClock {
  const [clock] = useState(() => createCascadeClock());
  return clock;
}
