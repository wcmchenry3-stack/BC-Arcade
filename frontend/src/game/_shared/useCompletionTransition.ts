import { useCallback, useEffect, useLayoutEffect, useRef } from "react";

/** What a screen does at the end of a game. */
export interface CompletionHandlers<T> {
  /**
   * A game completed here: end its session, clear its save, record it (rank,
   * `bestOf`, stats). Runs once per game, on the first rising edge of
   * `isComplete` after the game started or after `reset()`.
   */
  onComplete: (state: T) => void;
  /**
   * The rising edge of a game whose completion is already recorded: one the
   * restore loaded already complete (`markRestoredComplete()`), or one that
   * completes again without a `reset()`. It records nothing new (no rank, no
   * best, no stats: its result was counted when it happened), but it still
   * runs after the persisted-state save. The screens use it to clear the
   * save, and they also repeat what is safe to repeat: `syncComplete`
   * (a no-op once the session has ended), Solitaire's result card, and
   * Mahjong's idempotent layout unlock.
   */
  onAlreadyComplete?: (state: T) => void;
}

export interface CompletionTransition {
  /**
   * Call from the restore handler when the loaded game is already complete:
   * its rising edge then runs `onAlreadyComplete`, never `onComplete`.
   */
  markRestoredComplete: () => void;
  /** A new game: its completion runs `onComplete` again. */
  reset: () => void;
}

/**
 * A game screen's end-of-game edge (#3087): the step from playing to complete,
 * handled once per game.
 *
 * - Fires on each rising edge of `isComplete`: false (or no game) the render
 *   before, true now. A state that stays complete fires nothing more.
 * - `state === null` (pre-game, a cleared board) rearms the edge, so the next
 *   game's completion fires again.
 * - The first edge of a game runs `onComplete`. Any later one, and the edge of
 *   a game the restore marked with `markRestoredComplete()`, runs
 *   `onAlreadyComplete` instead, until `reset()` starts a new game.
 * - Passing a plain function runs it on every rising edge, with no
 *   once-per-game guard (Sudoku: each edge decides from the puzzle itself).
 *
 * The edge is an effect, so it runs where the hook is called: after
 * `usePersistedGameState`'s save (a winning move is saved, then the
 * completion clears it) and after any effect called above it in the screen.
 * Each handler keeps the screen's own order of side effects
 * (`syncComplete` → clear the save → rank → `bestOf` → stats); the "new
 * best" rule stays `bestOf` (`_shared/bestOf.ts`).
 *
 * The handlers are read at the edge, so they can close over the render's
 * values without being memoised.
 */
export function useCompletionTransition<T>(
  state: T | null,
  isComplete: boolean,
  handlers: CompletionHandlers<T> | ((state: T) => void)
): CompletionTransition {
  const handlersRef = useRef(handlers);
  useLayoutEffect(() => {
    handlersRef.current = handlers;
  });

  const prevCompleteRef = useRef(false);
  const recordedRef = useRef(false);

  useEffect(() => {
    if (state === null) {
      prevCompleteRef.current = false;
      return;
    }
    if (isComplete && !prevCompleteRef.current) {
      const current = handlersRef.current;
      if (typeof current === "function") {
        current(state);
      } else if (recordedRef.current) {
        current.onAlreadyComplete?.(state);
      } else {
        recordedRef.current = true;
        current.onComplete(state);
      }
    }
    prevCompleteRef.current = isComplete;
  }, [state, isComplete]);

  const markRestoredComplete = useCallback(() => {
    recordedRef.current = true;
  }, []);

  const reset = useCallback(() => {
    recordedRef.current = false;
    prevCompleteRef.current = false;
  }, []);

  return { markRestoredComplete, reset };
}
