/**
 * #3699: the clock of Cascade's win celebration. Renders nothing: the celebration is drawn by the
 * board on the UI thread (`CascadeBoard`, `render/drawCelebration.ts`) from `clock`, which this
 * animates from 0 (the win) to the card's time (`celebration.ts`: 2.1 s, 1.6 s under Reduce
 * Motion). `GameResultModal` mounts it as its `celebration` and shows the card on `onDone`, so the
 * card never covers the animation (#2201).
 *
 * `onDone` runs from a JS timer, not the animation's callback, so the card arrives even where the
 * animation does not run (tests, a frame callback held back). Reduce Motion switched mid-way
 * carries on at the same time on the other timeline: if that one is already over the card comes at
 * once, and it is never left waiting.
 */
import { useEffect, useRef } from "react";
import { Easing, withSequence, withTiming, type SharedValue } from "react-native-reanimated";
import { celebrationCardMs, celebrationRemainingMs } from "../../game/cascade/celebration";

export interface CascadeCelebrationProps {
  /** Ms since the win, read by the board (a Reanimated shared value). */
  readonly clock: SharedValue<number>;
  readonly reduceMotion: boolean;
  /** The celebration is over: show the card. */
  readonly onDone: () => void;
}

export default function CascadeCelebration({
  clock,
  reduceMotion,
  onDone,
}: CascadeCelebrationProps) {
  // The modal hands a new `done` each render; only the latest is called, and a new one never
  // restarts the clock.
  const onDoneRef = useRef(onDone);
  useEffect(() => {
    onDoneRef.current = onDone;
  }, [onDone]);
  const startedAtRef = useRef<number | null>(null);

  useEffect(() => {
    const now = Date.now();
    const first = startedAtRef.current === null;
    if (first) startedAtRef.current = now;
    const elapsed = now - (startedAtRef.current ?? now);
    const remaining = celebrationRemainingMs(elapsed, reduceMotion);
    const run = withTiming(celebrationCardMs(reduceMotion), {
      duration: remaining,
      easing: Easing.linear,
    });
    clock.set(first ? withSequence(withTiming(0, { duration: 0 }), run) : run);
    const timer = setTimeout(() => onDoneRef.current(), remaining);
    return () => clearTimeout(timer);
  }, [clock, reduceMotion]);

  return null;
}
