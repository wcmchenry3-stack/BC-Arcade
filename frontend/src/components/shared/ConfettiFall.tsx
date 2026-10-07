import React, { useEffect } from "react";
import { StyleSheet, View, type ViewStyle } from "react-native";
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";

/** Horizontal slots across the board, one per piece. */
const LEFTS = ["8%", "22%", "36%", "52%", "66%", "80%"] as const;
const FALL_SPRING = { damping: 14, stiffness: 55 } as const;
const FADE_IN_MS = 80;

export interface ConfettiFallTiming {
  /** translateY each piece starts from, and springs down to. */
  readonly fromY: number;
  readonly toY: number;
  /** Delay between successive pieces starting. */
  readonly staggerMs: number;
  /** How long a piece stays fully visible after fading in. */
  readonly holdMs: number;
  readonly fadeOutMs: number;
}

interface ConfettiFallProps {
  /** One colour per piece, left to right (up to six). */
  readonly colors: readonly string[];
  /** Size and shape of a piece. */
  readonly pieceStyle: ViewStyle;
  readonly timing: ConfettiFallTiming;
  readonly testID?: string;
}

/**
 * A row of pieces that fall from the top of the board, fading in and out on
 * the way. Plays once on mount; decorative, so hidden from screen readers and
 * never blocks touches. Callers handle reduced motion by not rendering it.
 */
export function ConfettiFall({ colors, pieceStyle, timing, testID }: ConfettiFallProps) {
  return (
    <View
      testID={testID}
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {colors.map((color, i) => (
        <FallingPiece
          key={i}
          index={i}
          style={[styles.piece, pieceStyle, { left: LEFTS[i], backgroundColor: color }]}
          timing={timing}
        />
      ))}
    </View>
  );
}

interface FallingPieceProps {
  readonly index: number;
  readonly style: React.ComponentProps<typeof Animated.View>["style"];
  readonly timing: ConfettiFallTiming;
}

function FallingPiece({ index, style, timing }: FallingPieceProps) {
  const { fromY, toY, staggerMs, holdMs, fadeOutMs } = timing;
  const y = useSharedValue(fromY);
  const opacity = useSharedValue(0);

  useEffect(() => {
    const delay = index * staggerMs;
    y.value = fromY;
    y.value = withDelay(delay, withSpring(toY, FALL_SPRING));
    opacity.value = 0;
    opacity.value = withDelay(
      delay,
      withSequence(
        withTiming(1, { duration: FADE_IN_MS }),
        withDelay(holdMs, withTiming(0, { duration: fadeOutMs }))
      )
    );
    return () => {
      cancelAnimation(y);
      cancelAnimation(opacity);
    };
    // Plays once per mount, like the overlays it replaced.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: y.value }],
    opacity: opacity.value,
  }));

  return <Animated.View style={[style, animatedStyle]} />;
}

const styles = StyleSheet.create({
  piece: { position: "absolute", top: 0 },
});
