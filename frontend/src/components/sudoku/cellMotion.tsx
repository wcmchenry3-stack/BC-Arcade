/**
 * The pieces of a cell's motion (#3774, "Calm"). Each is mounted only while its effect is on the
 * cell, plays once when it mounts (keyed by the move's id, so a new move replays it) and leaves
 * nothing running: no loop, no timer. A cell with no effect renders none of them, so an idle board
 * has no animated views. Times are in `game/sudoku/motion.ts`; Reduce Motion is the caller's
 * business (it mounts none of these, so a change mid-effect snaps the cell to rest).
 */
import React, { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import {
  CLASH_BLINK_DELAY_MS,
  CLASH_BLINK_DIM,
  CLASH_BLINK_EDGE_MS,
  CLASH_BLINK_OFF_MS,
  PLACE_FROM_SCALE,
  PLACE_MS,
} from "../../game/sudoku/motion";

function PlaceAnimated({ children }: { children: React.ReactNode }) {
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.value = withTiming(1, { duration: PLACE_MS, easing: Easing.out(Easing.quad) });
    return () => cancelAnimation(progress);
  }, [progress]);
  const style = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ scale: PLACE_FROM_SCALE + (1 - PLACE_FROM_SCALE) * progress.value }],
  }));
  return <Animated.View style={style}>{children}</Animated.View>;
}

/**
 * The digit's wrapper: it fades in and scales up when the move `id` landed it here. No `id`, or
 * Reduce Motion: a plain view, at rest.
 */
export function PlaceIn({
  id,
  reduceMotion,
  children,
}: {
  id: number | undefined;
  reduceMotion: boolean;
  children: React.ReactNode;
}) {
  if (id === undefined || reduceMotion) return <View>{children}</View>;
  return <PlaceAnimated key={id}>{children}</PlaceAnimated>;
}

/**
 * A colour laid over the cell that rises to `peak` and falls back to nothing over `ms`, after
 * `delayMs`: the error's red pulse, a unit's sweep, the solved wave. Under the digit (it is drawn
 * before it) and never takes a touch.
 */
export function PulseOverlay({
  color,
  peak,
  ms,
  delayMs = 0,
  testID,
}: {
  color: string;
  peak: number;
  ms: number;
  delayMs?: number;
  testID: string;
}) {
  const opacity = useSharedValue(0);
  useEffect(() => {
    opacity.value = withDelay(
      delayMs,
      withSequence(
        withTiming(peak, { duration: ms / 2, easing: Easing.out(Easing.quad) }),
        withTiming(0, { duration: ms / 2, easing: Easing.in(Easing.quad) })
      )
    );
    return () => cancelAnimation(opacity);
    // One run per mount: the parent re-mounts it (a new key) for a new effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return (
    <Animated.View
      pointerEvents="none"
      testID={testID}
      style={[StyleSheet.absoluteFill, { backgroundColor: color }, style]}
    />
  );
}

/**
 * The red ring of a clashing cell, blinking once when an illegal digit is entered: on, off for a
 * moment, on again. At rest it is the same ring as a still one.
 */
export function BlinkRing({
  style,
  testID,
}: {
  style: React.ComponentProps<typeof View>["style"];
  testID: string;
}) {
  const opacity = useSharedValue(1);
  useEffect(() => {
    opacity.value = withSequence(
      withTiming(1, { duration: CLASH_BLINK_DELAY_MS }),
      withTiming(CLASH_BLINK_DIM, { duration: CLASH_BLINK_EDGE_MS }),
      withTiming(CLASH_BLINK_DIM, { duration: CLASH_BLINK_OFF_MS }),
      withTiming(1, { duration: CLASH_BLINK_EDGE_MS })
    );
    return () => cancelAnimation(opacity);
  }, [opacity]);
  const animated = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return <Animated.View pointerEvents="none" testID={testID} style={[style, animated]} />;
}
