import { useEffect, useState } from "react";

/** Delayed cues (sounds, hold releases) that can all be cancelled at once (#3572). */
export interface CueClock {
  /** Runs `fn` after `ms` (at once when `ms` <= 0). */
  schedule(fn: () => void, ms: number): void;
  /** Drops every cue not yet run. */
  cancelAll(): void;
}

function createCueClock(): CueClock {
  const timers = new Set<ReturnType<typeof setTimeout>>();
  return {
    schedule(fn, ms) {
      if (ms <= 0) {
        fn();
        return;
      }
      const timer = setTimeout(() => {
        timers.delete(timer);
        fn();
      }, ms);
      timers.add(timer);
    },
    cancelAll() {
      timers.forEach(clearTimeout);
      timers.clear();
    },
  };
}

/** A `CueClock` for a screen: every cue still pending is cancelled when it unmounts. */
export function useCueClock(): CueClock {
  const [clock] = useState(createCueClock);
  useEffect(() => () => clock.cancelAll(), [clock]);
  return clock;
}
