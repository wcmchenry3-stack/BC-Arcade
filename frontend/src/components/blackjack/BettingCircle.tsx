import React, { useEffect, useRef } from "react";
import { Animated, StyleSheet, Text } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "../../theme/ThemeContext";
import { typography } from "../../theme/typography";

interface BettingCircleProps {
  bet: number;
  accentColor?: string;
}

export default function BettingCircle({ bet, accentColor }: BettingCircleProps) {
  const { t } = useTranslation("blackjack");
  const { colors } = useTheme();
  const resolvedAccent = accentColor ?? colors.accent;
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (bet === 0) {
      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.06,
            duration: 900,
            useNativeDriver: false,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 900,
            useNativeDriver: false,
          }),
        ])
      );
      pulse.start();
      return () => pulse.stop();
    } else {
      pulseAnim.setValue(1);
    }
  }, [bet, pulseAnim]);

  return (
    <Animated.View
      style={[
        styles.circle,
        {
          borderColor: resolvedAccent,
          transform: [{ scale: pulseAnim }],
        },
      ]}
    >
      <Text
        style={[
          styles.betAmount,
          {
            color: bet === 0 ? colors.textMuted : resolvedAccent,
            fontFamily: typography.heading,
          },
        ]}
        accessibilityLabel={t("bet.accessibilityLabel", { amount: bet })}
      >
        {bet === 0 ? "0" : bet.toLocaleString()}
      </Text>
      <Text style={[styles.hint, { color: colors.textMuted, fontFamily: typography.label }]}>
        {bet === 0 ? t("betting.tapToAdd") : t("bet.label")}
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  circle: {
    width: 148,
    height: 148,
    borderRadius: 74,
    borderWidth: 2,
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  betAmount: {
    fontSize: 40,
    lineHeight: 48,
  },
  hint: {
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
});
