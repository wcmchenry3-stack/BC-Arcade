import React, { useEffect, useRef } from "react";
import { Animated, StyleSheet, Text } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "../../theme/ThemeContext";
import { formatNumber } from "../../api/statsDisplay";
import { typography } from "../../theme/typography";
import { accentAsText } from "./tableAccentText";

interface BettingCircleProps {
  bet: number;
  accentColor?: string;
  /** Diameter in px (default 148); the table sizes it to the felt. */
  size?: number;
}

export default function BettingCircle({ bet, accentColor, size = 148 }: BettingCircleProps) {
  const { t } = useTranslation("blackjack");
  const { colors } = useTheme();
  const resolvedAccent = accentColor ?? colors.accent;
  const amountSize = Math.max(12, Math.min(40, Math.round(size * 0.27)));
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
          width: size,
          height: size,
          borderRadius: size / 2,
          borderColor: resolvedAccent,
          transform: [{ scale: pulseAnim }],
        },
      ]}
    >
      <Text
        style={[
          styles.betAmount,
          {
            color: bet === 0 ? colors.textMuted : accentAsText(colors, resolvedAccent),
            fontFamily: typography.heading,
          },
          // A small spot (a landscape felt) scales its amount down to fit.
          size < 148 && { fontSize: amountSize, lineHeight: Math.round(amountSize * 1.2) },
        ]}
        accessibilityLabel={t("bet.accessibilityLabel", { amount: formatNumber(t, bet) })}
      >
        {bet === 0 ? "0" : formatNumber(t, bet)}
      </Text>
      {size >= HINT_MIN_SIZE && (
        <Text style={[styles.hint, { color: colors.textMuted, fontFamily: typography.label }]}>
          {bet === 0 ? t("betting.tapToAdd") : t("bet.label")}
        </Text>
      )}
    </Animated.View>
  );
}

/** Below this diameter the spot shows the amount only. */
const HINT_MIN_SIZE = 110;

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
