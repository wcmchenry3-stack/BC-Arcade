import { useEffect, useState } from "react";

/** Delayed cues (sounds, hold releases) that can be cancelled all at once or by group (#3572). */
export interface CueClock {
  /**
   * Runs `fn` after `ms` (at once when `ms` <= 0). `group` (an action's id) lets a later
   * action cancel the cues of one it called off.
   */
  schedule(fn: () => void, ms: number, group?: number): void;
  /** Drops the cues of `group` not yet run. */
  cancelGroup(group: number): void;
  /** Drops every cue not yet run. */
  cancelAll(): void;
}

function createCueClock(): CueClock {
  const timers = new Map<ReturnType<typeof setTimeout>, number | undefined>();
  return {
    schedule(fn, ms, group) {
      if (ms <= 0) {
        fn();
        return;
      }
      const timer = setTimeout(() => {
        timers.delete(timer);
        fn();
      }, ms);
      timers.set(timer, group);
    },
    cancelGroup(group) {
      for (const [timer, g] of timers) {
        if (g !== group) continue;
        clearTimeout(timer);
        timers.delete(timer);
      }
    },
    cancelAll() {
      timers.forEach((_, timer) => clearTimeout(timer));
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
