import { useCallback, useEffect, useRef } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { PlayClock } from "../game/_shared/playClock";
import { usePauseWhileAway, type FocusEventSource } from "./usePauseWhileAway";

export interface PausableClockOptions<T extends PlayClock> {
  navigation: FocusEventSource;
  /** The game state holding the clock, as last rendered. */
  state: T | null;
  setState: Dispatch<SetStateAction<T | null>>;
  /**
   * The game's own `pauseGame` / `resumeGame`: pause only a running clock,
   * resume only a paused one, and never resume a finished game.
   */
  pauseGame: (state: T, now: number) => T;
  resumeGame: (state: T, now: number) => T;
  /**
   * While true, returning doesn't resume the clock: the game paused it for a
   * reason of its own that still holds (Mahjong's Level Select).
   */
  hold?: boolean;
  /**
   * Called in the pause event's own handler with the latest rendered state
   * paused at the event's time, so the save doesn't wait for a render that
   * may never come once the app is in the background. Best effort: a move
   * not yet rendered is missing from it, and `onPaused` or the game's own
   * save of the committed state follows.
   */
  saveOnLeave?: (paused: T) => void;
  /**
   * Called once with each committed state whose clock is paused. A game that
   * saves only on a move (2048) saves here as well as in `saveOnLeave`.
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
  /**
   * Pass a state computed from a rendered one (a move built from the
   * screen's `state`) through this before applying it with a plain
   * `setState(next)`. If the player left in between, `next` still carries
   * the running clock from before the pause and would replace the paused
   * state: it is paused here instead.
   */
  pauseIfAway: (next: T) => T;
}

/**
 * The play clock of a game that keeps it on its React state (a `PlayClock`):
 * Solitaire, Mahjong and 2048 (#2750). It pauses the clock while the player is
 * away — another screen covers the game, or the app is in the background —
 * and resumes it on return, through `usePauseWhileAway`.
 *
 * Both are functional updates at the event's time, so they apply to the
 * latest state, not the last rendered one: a move still waiting to commit (a
 * queued 2048 move, an Auto-Complete step) is paused with the rest of the
 * state instead of being overwritten by a copy from before it.
 *
 * The clock's own state decides what happens (`PlayClock`): a pause stops
 * only a running clock, a resume restarts only a paused one, and an engine
 * move never restarts a paused one. So a board with no move yet keeps waiting
 * for its first, a finished game stays frozen, and a state replaced while the
 * player is away (a move that landed meanwhile) is still resumed on return.
 */
export function usePausableClock<T extends PlayClock>(
  options: PausableClockOptions<T>
): PausableClock<T> {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const notifiedRef = useRef<T | null>(null);

  const awayRef = usePauseWhileAway(
    options.navigation,
    () => {
      const now = Date.now();
      const o = optionsRef.current;
      o.setState((s) => (s === null ? s : o.pauseGame(s, now)));
      const latest = o.state;
      if (o.saveOnLeave && latest !== null) {
        const paused = o.pauseGame(latest, now);
        if (paused !== latest) o.saveOnLeave(paused);
      }
    },
    () => {
      const now = Date.now();
      optionsRef.current.setState((s) => {
        const o = optionsRef.current;
        return s === null || o.hold ? s : o.resumeGame(s, now);
      });
    }
  );

  const { state } = options;
  useEffect(() => {
    if (state === null || state.paused !== true || notifiedRef.current === state) return;
    notifiedRef.current = state;
    optionsRef.current.onPaused?.(state);
  }, [state]);

  const pauseIfAway = useCallback(
    (next: T): T => (awayRef.current ? optionsRef.current.pauseGame(next, Date.now()) : next),
    [awayRef]
  );

  return { awayRef, adoptLoaded: pauseIfAway, pauseIfAway };
}
