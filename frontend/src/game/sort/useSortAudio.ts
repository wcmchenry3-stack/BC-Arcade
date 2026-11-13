import { useCallback, useEffect, useRef } from "react";
import { useSound } from "../_shared/useSound";
import { useSoundVariants } from "../_shared/useSoundVariants";
import { POUR_START_LATENCY_BUDGET_MS, pourTimeline } from "./motion";
import { SORT_POUR_LIFT, SORT_POUR_STREAM, SORT_SELECT, SORT_SOUNDS } from "./sounds";

/**
 * Sort's sounds (#3661). Each is played from the event itself (a tap, a landing), never from a
 * frame. A pour is the one sound with a timeline: a lift at the tap, then ONE stream file for
 * the pour's unit count (1 to 4, as long as the stream runs) at `flowStartMs` (`pourTimeline`,
 * motion.ts), on a JS timer that `cancelPour` clears (a reset, a level change, leaving the
 * screen, or the app going to the background, where a late timer would fire on resume) and
 * unmount clears too.
 *
 * Each unit count has its own three variations (`useSoundVariants`, never the same one twice in
 * a row for that count).
 */
export function useSortAudio() {
  const { play: playSelect } = useSoundVariants(SORT_SELECT, SORT_SOUNDS);
  const { play: playLift } = useSoundVariants(SORT_POUR_LIFT, SORT_SOUNDS);
  // A fixed number of hook calls: one variations player set per unit count.
  const { play: playStream1 } = useSoundVariants(SORT_POUR_STREAM[0], SORT_SOUNDS);
  const { play: playStream2 } = useSoundVariants(SORT_POUR_STREAM[1], SORT_SOUNDS);
  const { play: playStream3 } = useSoundVariants(SORT_POUR_STREAM[2], SORT_SOUNDS);
  const { play: playStream4 } = useSoundVariants(SORT_POUR_STREAM[3], SORT_SOUNDS);
  const { play: playRefused } = useSound("sort.refused", SORT_SOUNDS);
  const { play: playComplete } = useSound("sort.complete", SORT_SOUNDS);
  const { play: playUndo } = useSound("sort.undo", SORT_SOUNDS);
  const { play: playHint } = useSound("sort.hint", SORT_SOUNDS);
  const { play: playWin } = useSound("sort.win", SORT_SOUNDS);

  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  /** Drops the stream a pour has not played yet (no sound for a cancelled pour). */
  const cancelPour = useCallback(() => {
    for (const timer of timersRef.current) clearTimeout(timer);
    timersRef.current = [];
  }, []);

  /**
   * A pour of `units` units starts: the lift now, then the stream for that unit count at
   * `flowStartMs` after the animation starts (plus the tap-to-animation latency budget). Under
   * Reduce Motion the pour lands at once, with no stream to follow: the lift and the 1-unit
   * stream, now.
   */
  const playPour = useCallback(
    (units: number, reduceMotion: boolean) => {
      cancelPour();
      playLift();
      if (reduceMotion) {
        playStream1();
        return;
      }
      const { flowStartMs, units: slots } = pourTimeline(units);
      const play = [playStream1, playStream2, playStream3, playStream4][
        Math.min(4, Math.max(1, slots.length)) - 1
      ]!;
      timersRef.current.push(setTimeout(play, POUR_START_LATENCY_BUDGET_MS + flowStartMs));
    },
    [cancelPour, playLift, playStream1, playStream2, playStream3, playStream4]
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
