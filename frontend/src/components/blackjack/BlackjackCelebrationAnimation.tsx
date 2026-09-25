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

const STAR_OFFSETS = [
  { x: -100, y: -90 },
  { x: 100, y: -90 },
  { x: -130, y: 0 },
  { x: 130, y: 0 },
  { x: -80, y: 90 },
  { x: 80, y: 90 },
] as const;

export function BlackjackCelebrationAnimation({ visible, onDismiss }: Props) {
  const { t } = useTranslation("blackjack");
  // The celebration gold token (#2501, #2507), so it reads in light mode too.
  const { colors } = useTheme();
  const { badgeStyle: labelStyle, particleStyles: starStyles } = useCelebration({
    visible,
    particleCount: STAR_OFFSETS.length,
    onDone: onDismiss,
    badgeSpring: { damping: 10, stiffness: 120 },
    particleSpring: { damping: 8, stiffness: 100 },
    particleStaggerMs: 60,
    exitAtMs: 1600,
    doneAtMs: 2100,
    badgeFadeOutMs: 400,
    particleFadeOutMs: 300,
    reducedMotion: { mode: "static", doneAfterMs: 1500 },
  });

  return (
    <AnimationOverlay visible={visible} onDismiss={onDismiss}>
      <View style={styles.content} pointerEvents="none">
        {STAR_OFFSETS.map((offset, i) => (
          <Animated.Text
            key={i}
            style={[
              styles.star,
              {
                left: "50%",
                top: "50%",
                marginLeft: offset.x,
                marginTop: offset.y,
                color: colors.celebration,
              },
              starStyles[i],
            ]}
          >
            ★
          </Animated.Text>
        ))}
        <Animated.View style={[styles.badge, { backgroundColor: colors.celebration }, labelStyle]}>
          <Text style={[styles.badgeText, { color: colors.background }]}>
            {t("outcome.blackjack")}
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
    paddingHorizontal: 32,
    paddingVertical: 16,
  },
  badgeText: {
    fontSize: 36,
    fontWeight: "900",
    letterSpacing: 2,
    textTransform: "uppercase",
  },
  star: {
    position: "absolute",
    fontSize: 28,
  },
});
