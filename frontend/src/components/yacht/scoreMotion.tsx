/**
 * The score commit's motion (#3749), for the scorecard (`ScoreTable`): a scored cell pops, the
 * total counts up to its new value, and the upper bonus's "+35" pulses when it is earned. Yours
 * and the computer's. Times are in `game/yacht/motion.ts`.
 *
 * Each runs only on a change after mount: a restored game (or a new game, which remounts the
 * table) shows its scores at rest. Under Reduce Motion (read live) nothing moves and the total
 * just changes; turning it on mid-animation stops it at rest, and turning it off replays nothing.
 */
import React, { useEffect, useRef, useState } from "react";
import { Text, type StyleProp, type TextStyle } from "react-native";
import {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { TOTAL_COUNT_MS } from "../../game/yacht/motion";

/**
 * A pop (scale 1 to `peak` and back over `ms`) each time `on` turns true after mount. Returns the
 * animated style for the view that pops.
 */
export function usePop(on: boolean, peak: number, ms: number, reduceMotion: boolean) {
  const scale = useSharedValue(1);
  const prev = useRef(on);
  const reduceMotionRef = useRef(reduceMotion);

  useEffect(() => {
    const was = prev.current;
    prev.current = on;
    if (!on || was || reduceMotionRef.current) return;
    cancelAnimation(scale);
    scale.value = withSequence(
      withTiming(peak, { duration: ms / 2, easing: Easing.out(Easing.quad) }),
      withTiming(1, { duration: ms / 2, easing: Easing.in(Easing.quad) })
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on]);

  useEffect(() => {
    reduceMotionRef.current = reduceMotion;
    if (!reduceMotion) return;
    cancelAnimation(scale);
    scale.value = 1;
  }, [reduceMotion, scale]);

  return useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
}

/** The ease-out of the count-up: fast first, settling on the value. */
function easeOutCubic(p: number): number {
  return 1 - Math.pow(1 - p, 3);
}

/**
 * A number that counts up (or down) to `value` over `TOTAL_COUNT_MS` when it changes, ease-out.
 * One small text re-rendering itself for about 18 frames; nothing else on the screen renders.
 * Its accessibility label is always the final value.
 */
export function CountUpText({
  value,
  reduceMotion,
  style,
  testID,
}: {
  value: number;
  reduceMotion: boolean;
  style?: StyleProp<TextStyle>;
  testID?: string;
}) {
  const [shown, setShown] = useState(value);
  const shownRef = useRef(value);

  useEffect(() => {
    const from = shownRef.current;
    if (from === value) {
      setShown(value);
      return;
    }
    const show = (v: number) => {
      shownRef.current = v;
      setShown(v);
    };
    if (reduceMotion) {
      show(value);
      return;
    }
    const t0 = Date.now();
    let frame: number | null = null;
    const tick = () => {
      const p = Math.min(1, (Date.now() - t0) / TOTAL_COUNT_MS);
      show(p >= 1 ? value : Math.round(from + (value - from) * easeOutCubic(p)));
      frame = p >= 1 ? null : requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      // Stopped part-way (a new value, Reduce Motion, unmount): never left showing a middle value.
      shownRef.current = value;
    };
  }, [value, reduceMotion]);

  return (
    <Text style={style} testID={testID} accessibilityLabel={String(value)}>
      {reduceMotion ? value : shown}
    </Text>
  );
}
