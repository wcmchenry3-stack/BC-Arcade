import { useCallback, useEffect, useRef } from "react";
import { useSound } from "../_shared/useSound";
import { useSoundVariants } from "../_shared/useSoundVariants";
import { POUR_START_LATENCY_BUDGET_MS, POUR_UNIT_MS, pourTimeline } from "./motion";
import { SORT_POUR_GLUG, SORT_POUR_LIFT, SORT_SELECT, SORT_SOUNDS } from "./sounds";

/**
 * Sort's sounds (#3661). Each is played from the event itself (a tap, a landing), never from a
 * frame. A pour is the one sound with a timeline: a lift at the tap, then one glug per unit at
 * that unit's slot start (`pourTimeline`, motion.ts), on JS timers that `cancelPour` clears
 * (a reset, a level change or leaving the screen) and unmount clears too.
 *
 * The glug variations are separate players and `useSoundVariants` never repeats one twice in a
 * row, so a glug's 80 ms tail over the next slot is never cut by a restart of the same player.
 */
export function useSortAudio() {
  const { play: playSelect } = useSoundVariants(SORT_SELECT, SORT_SOUNDS);
  const { play: playLift } = useSoundVariants(SORT_POUR_LIFT, SORT_SOUNDS);
  const { play: playGlug } = useSoundVariants(SORT_POUR_GLUG, SORT_SOUNDS);
  const { play: playRefused } = useSound("sort.refused", SORT_SOUNDS);
  const { play: playComplete } = useSound("sort.complete", SORT_SOUNDS);
  const { play: playUndo } = useSound("sort.undo", SORT_SOUNDS);
  const { play: playHint } = useSound("sort.hint", SORT_SOUNDS);
  const { play: playWin } = useSound("sort.win", SORT_SOUNDS);

  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  /** Drops the glugs a pour has not played yet (no sound for a cancelled pour). */
  const cancelPour = useCallback(() => {
    for (const timer of timersRef.current) clearTimeout(timer);
    timersRef.current = [];
  }, []);

  /**
   * A pour of `units` units starts: the lift now, then a glug at each unit's slot start,
   * `flowStartMs + i * POUR_UNIT_MS` after the animation starts (plus the tap-to-animation
   * latency budget). Under Reduce Motion the pour lands at once: the lift and one glug, now.
   */
  const playPour = useCallback(
    (units: number, reduceMotion: boolean) => {
      cancelPour();
      playLift();
      if (reduceMotion) {
        playGlug();
        return;
      }
      const { flowStartMs, units: slots } = pourTimeline(units);
      slots.forEach((_, i) => {
        const delay = POUR_START_LATENCY_BUDGET_MS + flowStartMs + i * POUR_UNIT_MS;
        timersRef.current.push(setTimeout(playGlug, delay));
      });
    },
    [cancelPour, playLift, playGlug]
  );

  // A pour never sounds on an unmounted screen.
  useEffect(() => cancelPour, [cancelPour]);

  return {
    playSelect,
    playPour,
    cancelPour,
    playRefused,
    playComplete,
    playUndo,
    playHint,
    playWin,
  };
}
