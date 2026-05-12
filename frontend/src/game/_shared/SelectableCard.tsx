import React, { useEffect } from "react";
import { Platform } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";

import PlayingCard from "../../components/shared/PlayingCard";
import type { PlayingCardProps } from "../../components/shared/PlayingCard";
import { useDeck } from "./decks/CardDeckContext";
import { useTheme } from "../../theme/ThemeContext";

export interface SelectableCardProps extends Omit<PlayingCardProps, "highlighted"> {
  selected?: boolean;
  /** Optional shake animation shared value — applied as translateX. */
  shakeX?: SharedValue<number>;
}

const SPRING_IN = { duration: 180, dampingRatio: 0.65 } as const;
const TIMING_OUT = { duration: 120 } as const;

export default function SelectableCard({
  selected = false,
  shakeX,
  ...cardProps
}: SelectableCardProps) {
  const { activeDeck } = useDeck();
  const { colors } = useTheme();

  const lift = useSharedValue(0);
  const scale = useSharedValue(1);
  const glow = useSharedValue(0);

  useEffect(() => {
    if (selected) {
      lift.value = withSpring(-6, SPRING_IN);
      scale.value = withSpring(1.03, SPRING_IN);
      glow.value = withSpring(1, SPRING_IN);
    } else {
      lift.value = withTiming(0, TIMING_OUT);
      scale.value = withTiming(1, TIMING_OUT);
      glow.value = withTiming(0, TIMING_OUT);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]); // lift/scale/glow are stable SharedValue refs — safe to omit

  const isNeon = activeDeck.id === "neon";
  const glowColor = isNeon ? colors.accentBright : "#ffffff";

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: shakeX != null ? shakeX.value : 0 },
      { translateY: lift.value },
      { scale: scale.value },
    ],
    ...(Platform.OS !== "web" && {
      shadowColor: glowColor,
      shadowRadius: 12 * glow.value,
      shadowOpacity: 0.85 * glow.value,
      elevation: 8 * glow.value,
    }),
  }));

  const webFilterStyle =
    Platform.OS === "web" && selected
      ? { filter: `drop-shadow(0 0 14px ${glowColor})` }
      : undefined;

  return (
    <Animated.View style={[{ overflow: "visible" }, animatedStyle, webFilterStyle]}>
      <PlayingCard {...cardProps} highlighted={false} />
    </Animated.View>
  );
}
