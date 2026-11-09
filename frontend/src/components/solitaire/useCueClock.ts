import { useEffect, useState } from "react";

/**
 * What a cue is, so a later action that calls its action off knows what it dropped (#3572):
 * a landing sound (`place`, `multi`), a turn's sound (`flip`, `fan`), or anything else.
 */
export type CueTag = "place" | "multi" | "flip" | "fan" | "other";

/** Delayed cues (sounds, hold releases) that can be cancelled all at once or by group (#3572). */
export interface CueClock {
  /**
   * Runs `fn` after `ms` (at once when `ms` <= 0). `group` (an action's id) lets a later
   * action cancel the cues of one it called off; `tag` says what the cue was.
   */
  schedule(fn: () => void, ms: number, group?: number, tag?: CueTag): void;
  /** Drops the cues of `group` not yet run, and returns their tags. */
  cancelGroup(group: number): readonly CueTag[];
  /** Drops every cue not yet run. */
  cancelAll(): void;
}

interface Pending {
  readonly group: number | undefined;
  readonly tag: CueTag;
}

/** @internal Exported for the motion fuzz test; the screen uses `useCueClock`. */
export function createCueClock(): CueClock {
  const timers = new Map<ReturnType<typeof setTimeout>, Pending>();
  return {
    schedule(fn, ms, group, tag = "other") {
      if (ms <= 0) {
        fn();
        return;
      }
      const timer = setTimeout(() => {
        timers.delete(timer);
        fn();
      }, ms);
      timers.set(timer, { group, tag });
    },
    cancelGroup(group) {
      const dropped: CueTag[] = [];
      for (const [timer, p] of timers) {
        if (p.group !== group) continue;
        clearTimeout(timer);
        timers.delete(timer);
        dropped.push(p.tag);
      }
      return dropped;
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
