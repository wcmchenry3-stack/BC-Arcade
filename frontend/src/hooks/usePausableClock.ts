import { useCallback, useEffect, useRef } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { PlayClock } from "../game/_shared/playClock";
import { usePauseWhileAway, type FocusEventSource } from "./usePauseWhileAway";

export interface PausableClockOptions<T extends PlayClock> {
  navigation: FocusEventSource;
  /** The game state holding the clock, as last committed. */
  state: T | null;
  setState: Dispatch<SetStateAction<T | null>>;
  /** The game's own `pauseGame` / `resumeGame` (a finished game never resumes). */
  pauseGame: (state: T) => T;
  resumeGame: (state: T) => T;
  /**
   * Runs once with each state this hook paused, after it is committed. A game
   * that saves only on a move (2048) saves here, so a kill while the app is
   * in the background keeps the play up to the pause.
   */
  onPaused?: (paused: T) => void;
}

export interface PausableClock<T> {
  /** True while the player is away (see `usePauseWhileAway`). */
  readonly awayRef: { readonly current: boolean };
  /**
   * Pass a state loaded from storage through this before applying it. A load
   * that lands while the player is away (it resolves after the app went to
   * the background, or with another screen on top) would otherwise bring in
   * a running clock that no pause will stop: it is paused here instead, and
   * resumed with everything else on return.
   */
  adoptLoaded: (loaded: T) => T;
}

/**
 * The play clock of a game that keeps it on its React state (`startedAt` /
 * `accumulatedMs`): Solitaire, Mahjong and 2048 (#2750). It pauses the clock
 * while the player is away — another screen covers the game, or the app is in
 * the background — and resumes it on return, through `usePauseWhileAway`.
 *
 * Both run as functional updates, so they apply to the latest state, not the
 * last committed one: a move still waiting to commit (a queued 2048 move, an
 * Auto-Complete step) is paused with the rest of the state instead of being
 * overwritten by a copy from before it.
 *
 * Only a clock this hook paused is restarted on return: a board with no move
 * yet keeps waiting for its first, and a clock the game stopped for its own
 * reasons (Mahjong's Level Select) stays stopped. The paused states are
 * recognised by identity; if one is replaced while the player is away, the
 * engine's next move restarts the clock instead.
 */
export function usePausableClock<T extends PlayClock>(
  options: PausableClockOptions<T>
): PausableClock<T> {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const pausedWhileAwayRef = useRef(new WeakSet<T>());
  const notifiedRef = useRef<T | null>(null);

  const awayRef = usePauseWhileAway(
    options.navigation,
    () =>
      optionsRef.current.setState((s) => {
        if (s === null || s.startedAt === null) return s;
        const paused = optionsRef.current.pauseGame(s);
        pausedWhileAwayRef.current.add(paused);
        return paused;
      }),
    () =>
      optionsRef.current.setState((s) =>
        s !== null && pausedWhileAwayRef.current.has(s) ? optionsRef.current.resumeGame(s) : s
      )
  );

  const { state } = options;
  useEffect(() => {
    if (state === null || !pausedWhileAwayRef.current.has(state)) return;
    if (notifiedRef.current === state) return;
    notifiedRef.current = state;
    optionsRef.current.onPaused?.(state);
  }, [state]);

  const adoptLoaded = useCallback(
    (loaded: T): T => {
      if (!awayRef.current || loaded.startedAt === null) return loaded;
      const paused = optionsRef.current.pauseGame(loaded);
      pausedWhileAwayRef.current.add(paused);
      return paused;
    },
    [awayRef]
  );

  return { awayRef, adoptLoaded };
}
