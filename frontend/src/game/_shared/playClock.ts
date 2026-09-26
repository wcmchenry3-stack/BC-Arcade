/**
 * A game's play clock, and saving and restoring it across an app kill (#2750).
 *
 * Solitaire, Mahjong and 2048 keep their clock on the game state, and Cascade
 * in a ref, all as a `PlayClock`. It is in one of four states:
 *
 * - not started: `startedAt` null, `paused` absent, nothing banked. The first
 *   move starts it (`startClockOnMove`).
 * - running: `startedAt` set.
 * - paused: `startedAt` null and `paused` true, with the play so far banked in
 *   `accumulatedMs`. Only `resumeClock` starts it again; a move never does, so
 *   a move that lands while the player is away leaves it paused.
 * - stopped: `startedAt` null and `paused` absent, after the game ended
 *   (`stopClock`). Nothing starts it again, except an undo out of Mahjong's
 *   deadlock.
 *
 * A raw `startedAt` restored after a relaunch counts the whole time the app
 * was closed as play, so the save banks the running segment and the load
 * restarts the clock from the moment of loading.
 */

/** The clock fields the games share. */
export interface PlayClock {
  /** When the running segment began; null while not running. */
  readonly startedAt: number | null;
  /** The play banked before the running segment. */
  readonly accumulatedMs: number;
  /**
   * Paused, as opposed to not started or stopped: the player is away (another
   * screen covers the game, or the app is in the background) or on Mahjong's
   * Level Select. Only ever `true` or absent; absent in saves from older
   * builds, which load as not paused.
   */
  readonly paused?: boolean;
}

/** `target` with its clock set; `paused` is written only when true. */
function setClock<T extends PlayClock>(
  target: T,
  startedAt: number | null,
  accumulatedMs: number,
  paused: boolean
): T {
  const { paused: _dropped, ...rest } = target;
  const next = paused
    ? { ...rest, startedAt, accumulatedMs, paused: true }
    : { ...rest, startedAt, accumulatedMs };
  return next as T;
}

/** `target` with the clock fields of `clock`. */
export function withClock<T extends PlayClock>(target: T, clock: PlayClock): T {
  return setClock(target, clock.startedAt, clock.accumulatedMs, clock.paused === true);
}

/** Play time so far: what is banked plus the running segment, if any. */
export function clockElapsedMs(clock: PlayClock, now: number = Date.now()): number {
  return clock.accumulatedMs + (clock.startedAt !== null ? now - clock.startedAt : 0);
}

/**
 * Pause a running clock, banking the running segment. A no-op on a clock that
 * isn't running: one not started yet waits for its first move, and a stopped
 * one stays stopped.
 */
export function pauseClock<T extends PlayClock>(clock: T, now: number = Date.now()): T {
  if (clock.startedAt === null) return clock;
  return setClock(clock, null, clockElapsedMs(clock, now), true);
}

/** Run a paused clock again from `now`. A no-op on a clock that isn't paused. */
export function resumeClock<T extends PlayClock>(clock: T, now: number = Date.now()): T {
  if (clock.paused !== true) return clock;
  return setClock(clock, now, clock.accumulatedMs, false);
}

/**
 * The clock after a move: one not started yet starts at `now`. A running one
 * runs on, and a paused one stays paused (the move landed while the player was
 * away).
 */
export function startClockOnMove<T extends PlayClock>(clock: T, now: number = Date.now()): T {
  if (clock.startedAt !== null || clock.paused === true) return clock;
  return setClock(clock, now, clock.accumulatedMs, false);
}

/** Stop the clock for good (the game ended), banking any running segment. */
export function stopClock<T extends PlayClock>(clock: T, now: number = Date.now()): T {
  return setClock(clock, null, clockElapsedMs(clock, now), false);
}

/**
 * The clock as it is saved: the running segment banked into `accumulatedMs`.
 * A running clock keeps a non-null `startedAt` (the save time) only as a
 * marker, so the load knows it was running even when nothing is banked yet;
 * `clockOnLoad` never reads the value. A paused clock is saved as it is.
 */
export function clockForSave<T extends PlayClock>(state: T, now: number = Date.now()): T {
  if (state.startedAt === null) return state;
  return {
    ...state,
    accumulatedMs: state.accumulatedMs + (now - state.startedAt),
    startedAt: now,
  };
}

/**
 * The clock as it is loaded. None of the time between the save and this load
 * (the app was closed) counts. A game already under way, whether its clock
 * was running or paused when it was saved, keeps its banked time and runs
 * again from `now`. A game with no move yet stays stopped until its first
 * move, and a finished one stays frozen. The loaded clock is never paused:
 * a screen that loads while the player is away pauses it itself.
 *
 * Saves from builds before #2750 carry an unbanked running segment in
 * `startedAt`. When the app was closed is unknown, so that segment is dropped:
 * the game keeps only what was banked (pauses, earlier sessions) and counts
 * from the load.
 */
export function clockOnLoad<T extends PlayClock>(
  state: T,
  finished: boolean,
  now: number = Date.now()
): T {
  const underWay = state.startedAt !== null || state.paused === true || state.accumulatedMs > 0;
  return setClock(state, underWay && !finished ? now : null, state.accumulatedMs, false);
}
