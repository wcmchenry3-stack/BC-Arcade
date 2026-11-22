/**
 * Cascade's merge burst (moved out of `CascadeScreen.tsx` in #2960, the Cascade part of #2979): a
 * coloured disc that springs out from the merge point and fades, on the UI thread (Reanimated).
 * The screen skips it under Reduce Motion and drops it from its list when `onDone(id)` fires.
 * Its numbers live in `game/cascade/motion.ts` (`MOTION.burst`, #3701; unchanged from #2960); the
 * merge pop of #3701 is drawn on the board, on top of it.
 */
import React, { useEffect } from "react";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { MOTION } from "../../game/cascade/motion";

export interface MergeBurstData {
  readonly id: string;
  /** Screen position (points, relative to the board wrapper) of the merge. */
  readonly x: number;
  readonly y: number;
  readonly color: string;
}

const B = MOTION.burst;
const SIZE = B.size;

export default function MergeBurst({
  id,
  x,
  y,
  color,
  onDone,
}: MergeBurstData & { readonly onDone: (id: string) => void }) {
  const scale = useSharedValue<number>(B.fromScale);
  const opacity = useSharedValue<number>(B.opacity);

  useEffect(() => {
    scale.value = withSpring(B.toScale, { damping: B.damping, stiffness: B.stiffness });
    opacity.value = withTiming(0, { duration: B.fadeMs }, (finished) => {
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
