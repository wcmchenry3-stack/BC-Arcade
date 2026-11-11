/**
 * WinSparkles (#3664): after a win, a short burst of sparks from the solved row, spreading over
 * the board and fading, before the result card. A dozen dots driven by one progress value on
 * the UI thread; nothing renders per frame.
 */
import React, { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import type { SharedValue } from "react-native-reanimated";

import { WIN_SPARKLE_MS } from "../../game/daily_word/motion";
import { DAILYWORD_SPARK } from "../../theme/theme.dailyword";

const SPARKS = 14;
const GOLDEN_ANGLE = 2.399963229728653;

function Spark({
  index,
  progress,
  reach,
}: {
  index: number;
  progress: SharedValue<number>;
  reach: number;
}) {
  const angle = index * GOLDEN_ANGLE;
  const dist = reach * (0.45 + 0.55 * (((index * 7) % 11) / 10));
  const size = 5 + (index % 3) * 2;
  const style = useAnimatedStyle(() => {
    const p = progress.value;
    const e = 1 - (1 - p) * (1 - p) * (1 - p);
    return {
      opacity: p <= 0 || p >= 1 ? 0 : 1 - p,
      transform: [
        { translateX: Math.cos(angle) * dist * e },
        // A little gravity as they fade.
        { translateY: Math.sin(angle) * dist * e + p * p * reach * 0.35 },
        { scale: 1 - 0.5 * p },
      ],
    };
  });
  return (
    <Animated.View
      style={[
        styles.spark,
        { width: size, height: size, borderRadius: size / 2, left: -size / 2, top: -size / 2 },
        style,
      ]}
    />
  );
}

export default function WinSparkles({
  originY,
  reach,
  testID = "daily-word-win-sparkles",
}: {
  /** Where the burst starts, from the top of its container (the solved row's centre). */
  readonly originY: number;
  /** How far the sparks fly. */
  readonly reach: number;
  readonly testID?: string;
}) {
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.value = withTiming(1, { duration: WIN_SPARKLE_MS, easing: Easing.linear });
    // Once, on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill]} testID={testID}>
      <View style={[styles.origin, { top: originY }]}>
        {Array.from({ length: SPARKS }, (_, i) => (
          <Spark key={i} index={i} progress={progress} reach={reach} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  origin: {
    position: "absolute",
    left: "50%",
    width: 0,
    height: 0,
  },
  spark: {
    position: "absolute",
    backgroundColor: DAILYWORD_SPARK,
  },
});
