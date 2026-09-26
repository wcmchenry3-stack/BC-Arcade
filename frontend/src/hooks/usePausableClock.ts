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
   * Called in the pause event's own handler with the latest known state
   * paused at the event's time, so the save doesn't wait for a render that
   * may never come once the app is in the background. The latest known state
   * is the newest one passed through `matchPresence` (a move computed but
   * not yet rendered) or rendered since, so this never writes a board older
   * than the move the screen last saved.
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
   * Pass every state the screen computes (a move, an undo, a draw) through
   * this before applying it. It sets the clock to match whether the player
   * is here: a move built from a board rendered before the player left still
   * carries the running clock, and is paused; one built from a board
   * rendered before they came back still carries the paused clock, and is
   * resumed (unless `hold`), so the play from the return on counts. It also
   * records the result as the latest known state for `saveOnLeave`.
   */
  matchPresence: (next: T) => T;
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

  // The latest known state: the newest one computed (matchPresence) or
  // rendered. A state the screen sets directly (a deal, a load) arrives by
  // the render; one it computes is recorded before it is even set.
  const latestRef = useRef<T | null>(options.state);
  const renderedRef = useRef<T | null>(options.state);
  if (options.state !== renderedRef.current) {
    renderedRef.current = options.state;
    latestRef.current = options.state;
  }

  const awayRef = usePauseWhileAway(
    options.navigation,
    () => {
      const now = Date.now();
      const o = optionsRef.current;
      o.setState((s) => (s === null ? s : o.pauseGame(s, now)));
      const latest = latestRef.current;
      if (latest === null) return;
      const paused = o.pauseGame(latest, now);
      latestRef.current = paused;
      if (o.saveOnLeave && paused !== latest) o.saveOnLeave(paused);
    },
    () => {
      const now = Date.now();
      const o = optionsRef.current;
      o.setState((s) => {
        const current = optionsRef.current;
        return s === null || current.hold ? s : current.resumeGame(s, now);
      });
      const latest = latestRef.current;
      if (latest !== null && !o.hold) latestRef.current = o.resumeGame(latest, now);
    }
  );

  const { state } = options;
  useEffect(() => {
    if (state === null || state.paused !== true || notifiedRef.current === state) return;
    notifiedRef.current = state;
    optionsRef.current.onPaused?.(state);
  }, [state]);

  const matchPresence = useCallback(
    (next: T): T => {
      const o = optionsRef.current;
      const now = Date.now();
      let settled = next;
      if (awayRef.current) settled = o.pauseGame(next, now);
      else if (!o.hold) settled = o.resumeGame(next, now);
      latestRef.current = settled;
      return settled;
    },
    [awayRef]
  );

  return { awayRef, adoptLoaded: matchPresence, matchPresence };
}
