/**
 * Cascade's score row: the score, the next-piece preview between, and the best.
 *
 * #2960: memoized, and it can read the score from the screen's `ScoreStore` instead of a prop,
 * so it re-renders once per new integer score and the screen does not re-render for it.
 */
import React, { memo, useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { View, Text, Animated, StyleSheet } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "../../theme/ThemeContext";
import { formatNumber } from "../../api/statsDisplay";
import { useReduceMotion } from "../shared/useReduceMotion";
import type { ScoreStore } from "../../game/cascade/scoreStore";

interface Props {
  /** The score, when no `store` is given. */
  score?: number;
  /** The live score (#2960); takes precedence over `score`. */
  store?: ScoreStore;
  children?: React.ReactNode;
}

const noSubscription = () => () => {};

function ScoreDisplay({ score: scoreProp = 0, store, children }: Props) {
  const getSnapshot = useCallback(() => (store ? store.get() : scoreProp), [store, scoreProp]);
  const score = useSyncExternalStore(store ? store.subscribe : noSubscription, getSnapshot);
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
      accessibilityLabel={t("score.display", { score: formatNumber(t, score) })}
    >
      <View style={styles.scoreSection}>
        <Text style={[styles.label, { color: colors.textMuted }]}>{t("score.label")}</Text>
        <Animated.Text
          style={[styles.score, { color: colors.accent, transform: [{ scale }] }]}
          importantForAccessibility="no"
        >
          {formatNumber(t, score)}
        </Animated.Text>
      </View>
      {children ? <View style={styles.center}>{children}</View> : null}
      <View style={styles.scoreSection}>
        <Text style={[styles.label, { color: colors.textMuted }]}>{t("score.high")}</Text>
        <Text style={[styles.score, { color: colors.textMuted }]}>0</Text>
      </View>
    </View>
  );
}

export default memo(ScoreDisplay);

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
