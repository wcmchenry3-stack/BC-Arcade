/**
 * #2960: Cascade's score outside React state. The screen's loop writes the engine's score every
 * frame; subscribers (`ScoreDisplay`, through `useSyncExternalStore`) hear only when the integer
 * changes, so the score re-renders one small component, once per merge, and nothing else.
 */
export interface ScoreStore {
  /** The current score. */
  readonly get: () => number;
  /** Sets the score; notifies subscribers only when the integer value changes. */
  readonly set: (score: number) => void;
  /** `useSyncExternalStore`'s subscribe: returns the unsubscribe. */
  readonly subscribe: (listener: () => void) => () => void;
}

export function createScoreStore(initial = 0): ScoreStore {
  let score = Math.trunc(initial);
  const listeners = new Set<() => void>();
  return {
    get: () => score,
    set: (next) => {
      const value = Math.trunc(next);
      if (value === score) return;
      score = value;
      for (const listener of listeners) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
