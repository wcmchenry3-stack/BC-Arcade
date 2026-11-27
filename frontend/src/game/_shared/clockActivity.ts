/**
 * Whether a game's clock is advancing right now (started, not paused), kept
 * outside React state so a pause or the first move does not re-render the game
 * screen: only the `ElapsedText` that reads it does (#2964).
 */
export interface ClockActivity {
  subscribe: (onChange: () => void) => () => void;
  getSnapshot: () => boolean;
  /** Set whether the clock is advancing; listeners run only when it changes. */
  set: (advancing: boolean) => void;
}

export function createClockActivity(): ClockActivity {
  let advancing = false;
  const listeners = new Set<() => void>();
  return {
    subscribe: (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    getSnapshot: () => advancing,
    set: (next) => {
      if (next === advancing) return;
      advancing = next;
      listeners.forEach((listener) => listener());
    },
  };
}
