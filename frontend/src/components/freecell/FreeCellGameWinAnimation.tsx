import React from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated from "react-native-reanimated";
import { useTranslation } from "react-i18next";
import { AnimationOverlay } from "../shared/AnimationOverlay";
import { useCelebration } from "../shared/useCelebration";
import { useTheme } from "../../theme/ThemeContext";

interface Props {
  visible: boolean;
  onDismiss: () => void;
}

// Card suit symbols scattered around the central badge
const CARD_SUITS = ["♠", "♥", "♦", "♣", "♠", "♥", "♦", "♣"] as const;
const SUIT_OFFSETS = [
  { x: -120, y: -100 },
  { x: 120, y: -100 },
  { x: -140, y: 0 },
  { x: 140, y: 0 },
  { x: -100, y: 100 },
  { x: 100, y: 100 },
  { x: -30, y: -130 },
  { x: 30, y: 130 },
] as const;

/**
 * The win celebration: a gold badge with card suits bursting around it.
 * Rendered in the shared result card's `celebration` slot (#2508); calls
 * `onDismiss` when it has played (at once under reduce motion) so the card
 * can appear. The card announces the result, so the badge stays silent.
 */
export function FreeCellGameWinAnimation({ visible, onDismiss }: Props) {
  const { t } = useTranslation("result");
  const { colors } = useTheme();
  const {
    hidden,
    badgeStyle,
    particleStyles: suitStyles,
  } = useCelebration({
    visible,
    particleCount: SUIT_OFFSETS.length,
    onDone: onDismiss,
    badgeSpring: { damping: 10, stiffness: 120 },
    particleSpring: { damping: 8, stiffness: 100 },
    particleStaggerMs: 50,
    exitAtMs: 2200,
    doneAtMs: 2800,
    badgeFadeOutMs: 500,
    particleFadeOutMs: 400,
    // No motion wanted: go straight to the result card.
    reducedMotion: { mode: "skip" },
  });

  if (hidden) return null;

  return (
    <AnimationOverlay visible={visible} onDismiss={onDismiss}>
      <View style={styles.content} pointerEvents="none">
        {SUIT_OFFSETS.map((offset, i) => (
          <Animated.Text
            key={i}
            style={[
              styles.suitSymbol,
              {
                left: "50%",
                top: "50%",
                marginLeft: offset.x,
                marginTop: offset.y,
                color: i % 2 === 0 ? colors.text : colors.error,
              },
              suitStyles[i],
            ]}
          >
            {CARD_SUITS[i]}
          </Animated.Text>
        ))}
        <Animated.View style={[styles.badge, { backgroundColor: colors.celebration }, badgeStyle]}>
          <Text
            style={[styles.badgeText, { color: colors.background }]}
            accessibilityElementsHidden
            importantForAccessibility="no"
          >
            {t("title.win")}
          </Text>
        </Animated.View>
      </View>
    </AnimationOverlay>
  );
}

const styles = StyleSheet.create({
  content: {
    alignItems: "center",
    justifyContent: "center",
  },
  badge: {
    borderRadius: 20,
    paddingHorizontal: 36,
    paddingVertical: 18,
  },
  badgeText: {
    fontSize: 38,
    fontWeight: "900",
    letterSpacing: 2,
    textTransform: "uppercase",
  },
  suitSymbol: {
    position: "absolute",
    fontSize: 30,
  },
});
