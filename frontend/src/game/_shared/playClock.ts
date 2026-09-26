/**
 * Saving and restoring a game's play clock across an app kill (#2750).
 *
 * Solitaire, Mahjong and 2048 keep their clock as `startedAt` (when the
 * running segment began, or null while stopped) plus `accumulatedMs` (the
 * play banked before it). A raw `startedAt` restored after a relaunch counts
 * the whole time the app was closed as play, so the save banks the running
 * segment and the load restarts the clock from the moment of loading.
 */

/** The clock fields the games share. */
export interface PlayClock {
  readonly startedAt: number | null;
  readonly accumulatedMs: number;
}

/**
 * The clock as it is saved: the running segment banked into `accumulatedMs`.
 * A running clock keeps a non-null `startedAt` (the save time) only as a
 * marker, so the load knows it was running even when nothing is banked yet;
 * `clockOnLoad` never reads the value.
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
 * was running or paused (the app went to the background, or another screen
 * covered it) when it was saved, keeps its banked time and runs again from
 * `now`. A game with no move yet stays stopped until its first move, and a
 * finished one stays frozen.
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
  const underWay = state.startedAt !== null || state.accumulatedMs > 0;
  return { ...state, startedAt: underWay && !finished ? now : null };
}
