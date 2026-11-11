/**
 * The hint (#3688): an arrow and a short label ("Swipe left", and on web "or ←") over the board,
 * on the edge the swipe points to so the tiles in the middle stay visible. It never takes a touch
 * (the swipe still reaches the play area). The screen shows it for 2 s and clears it on a swipe.
 * It fades in over 150 ms, except under Reduce Motion, where it appears (and, like every hint,
 * disappears) at once.
 */
import React, { useEffect } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { useTheme } from "../../theme/ThemeContext";
import { typography } from "../../theme/typography";
import type { Direction } from "../../game/twenty48/engine";
import { useReduceMotion } from "../shared/useReduceMotion";

const ICON: Record<Direction, React.ComponentProps<typeof MaterialIcons>["name"]> = {
  up: "arrow-upward",
  down: "arrow-downward",
  left: "arrow-back",
  right: "arrow-forward",
};

/** The keyboard symbol for the same move on web. */
const KEY_SYMBOL: Record<Direction, string> = {
  up: "↑",
  down: "↓",
  left: "←",
  right: "→",
};

const FADE_MS = 150;

interface HintOverlayProps {
  direction: Direction;
  /** Web only: add "or ←" for the arrow key. */
  showKey: boolean;
}

/** The hint's label: "Swipe left", with "or ←" after it on web. */
export function hintText(t: TFunction<"twenty48">, direction: Direction, showKey: boolean): string {
  const swipe = {
    up: t("hint.swipeUp"),
    down: t("hint.swipeDown"),
    left: t("hint.swipeLeft"),
    right: t("hint.swipeRight"),
  }[direction];
  return showKey ? `${swipe} ${t("hint.orKey", { key: KEY_SYMBOL[direction] })}` : swipe;
}

export default function HintOverlay({ direction, showKey }: HintOverlayProps) {
  const { colors } = useTheme();
  const reduceMotion = useReduceMotion();
  const { t } = useTranslation("twenty48");
  const text = hintText(t, direction, showKey);

  const opacity = useSharedValue(reduceMotion ? 1 : 0);
  useEffect(() => {
    opacity.value = reduceMotion
      ? 1
      : withTiming(1, { duration: FADE_MS, easing: Easing.out(Easing.quad) });
  }, [opacity, reduceMotion]);
  const fade = useAnimatedStyle(() => ({ opacity: opacity.value }));

  // The chip sits on the edge the swipe points to, centred along it.
  const place = {
    up: { justifyContent: "flex-start", alignItems: "center" },
    down: { justifyContent: "flex-end", alignItems: "center" },
    left: { justifyContent: "center", alignItems: "flex-start" },
    right: { justifyContent: "center", alignItems: "flex-end" },
  } as const;

  return (
    <View style={[styles.fill, place[direction]]} pointerEvents="none" testID="twenty48-hint">
      <Animated.View
        style={[styles.chip, { backgroundColor: colors.accent }, fade]}
        testID="twenty48-hint-chip"
      >
        <MaterialIcons name={ICON[direction]} size={36} color={colors.textOnAccent} />
        <Text style={[styles.label, { color: colors.textOnAccent }]} testID="twenty48-hint-text">
          {text}
        </Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    padding: 12,
    zIndex: 2,
    // Above the 2048+ tiles' glow (elevation 10): on Android elevation decides draw order.
    elevation: 12,
  },
  chip: {
    alignItems: "center",
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  label: {
    fontFamily: typography.heading,
    fontSize: 13,
    letterSpacing: 0.3,
  },
});
