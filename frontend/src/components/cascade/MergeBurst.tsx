/**
 * Cascade's merge burst (moved out of `CascadeScreen.tsx` in #2960, the Cascade part of #2979): a
 * coloured disc that springs out from the merge point and fades, on the UI thread (Reanimated).
 * The screen skips it under Reduce Motion and drops it from its list when `onDone(id)` fires.
 * Motion polish is #3701.
 */
import React, { useEffect } from "react";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";

export interface MergeBurstData {
  readonly id: string;
  /** Screen position (points, relative to the board wrapper) of the merge. */
  readonly x: number;
  readonly y: number;
  readonly color: string;
}

const SIZE = 40;

export default function MergeBurst({
  id,
  x,
  y,
  color,
  onDone,
}: MergeBurstData & { readonly onDone: (id: string) => void }) {
  const scale = useSharedValue(0.1);
  const opacity = useSharedValue(0.75);

  useEffect(() => {
    scale.value = withSpring(2.2, { damping: 9, stiffness: 25 });
    opacity.value = withTiming(0, { duration: 1100 }, (finished) => {
      if (finished) runOnJS(onDone)(id);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const animStyle = useAnimatedStyle(() => ({
    position: "absolute",
    left: x - SIZE / 2,
    top: y - SIZE / 2,
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    backgroundColor: color,
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }));

  return <Animated.View pointerEvents="none" style={animStyle} />;
}
