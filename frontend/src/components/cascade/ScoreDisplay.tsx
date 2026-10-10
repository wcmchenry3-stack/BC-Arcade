import React, { useEffect, useRef } from "react";
import { View, Text, Animated, StyleSheet } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "../../theme/ThemeContext";
import { useReduceMotion } from "../shared/useReduceMotion";

interface Props {
  score: number;
  children?: React.ReactNode;
}

export default function ScoreDisplay({ score, children }: Props) {
  const { t } = useTranslation("cascade");
  const { colors } = useTheme();
  const scale = useRef(new Animated.Value(1)).current;
  const prevScore = useRef(score);
  const reduceMotion = useReduceMotion();

  useEffect(() => {
    if (score !== prevScore.current) {
      prevScore.current = score;
      if (!reduceMotion) {
        Animated.sequence([
          Animated.timing(scale, { toValue: 1.25, duration: 80, useNativeDriver: true }),
          Animated.timing(scale, { toValue: 1, duration: 120, useNativeDriver: true }),
        ]).start();
      }
    }
  }, [score, scale, reduceMotion]);

  return (
    <View
      style={styles.container}
      accessibilityLiveRegion="polite"
      accessibilityLabel={t("score.display", { score: score.toLocaleString() })}
    >
      <View style={styles.scoreSection}>
        <Text style={[styles.label, { color: colors.textMuted }]}>{t("score.label")}</Text>
        <Animated.Text
          style={[styles.score, { color: colors.accent, transform: [{ scale }] }]}
          importantForAccessibility="no"
        >
          {score.toLocaleString()}
        </Animated.Text>
      </View>
      {children ? <View style={styles.center}>{children}</View> : null}
      <View style={styles.scoreSection}>
        <Text style={[styles.label, { color: colors.textMuted }]}>HIGH</Text>
        <Text style={[styles.score, { color: colors.textMuted }]}>0</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 6,
    gap: 12,
  },
  scoreSection: {
    alignItems: "center",
  },
  center: {
    flex: 1,
    alignItems: "center",
  },
  label: {
    fontSize: 10,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  score: {
    fontSize: 26,
    fontWeight: "800",
  },
});
