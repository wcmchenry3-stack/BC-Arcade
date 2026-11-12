import React, { useEffect, useRef } from "react";
import { View, Text, StyleSheet, Animated } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "../../theme/ThemeContext";
import { typography } from "../../theme/typography";
import { SCORE_FLOAT_MS, SCORE_FLOAT_RISE_PX } from "../../game/twenty48/motion";
import { useReduceMotion } from "../shared/useReduceMotion";

interface ScoreBoardProps {
  score: number;
  bestScore: number;
  scoreDelta: number;
}

export default function ScoreBoard({ score, bestScore, scoreDelta }: ScoreBoardProps) {
  const { t } = useTranslation(["twenty48"]);
  const { colors } = useTheme();
  const reduceMotion = useReduceMotion();

  // Score delta float animation.
  const deltaOpacity = useRef(new Animated.Value(0)).current;
  const deltaTranslateY = useRef(new Animated.Value(0)).current;

  // Under Reduce Motion (read live, docs/ACCESSIBILITY.md section 3) the "+N" does not float:
  // it is not shown at all, the score itself already changed.
  const floating = useRef<Animated.CompositeAnimation | null>(null);
  useEffect(() => {
    if (scoreDelta <= 0 || reduceMotion) return;
    deltaOpacity.setValue(1);
    deltaTranslateY.setValue(0);
    const float = Animated.parallel([
      Animated.timing(deltaOpacity, {
        toValue: 0,
        duration: SCORE_FLOAT_MS,
        useNativeDriver: true,
      }),
      Animated.timing(deltaTranslateY, {
        toValue: -SCORE_FLOAT_RISE_PX,
        duration: SCORE_FLOAT_MS,
        useNativeDriver: true,
      }),
    ]);
    floating.current = float;
    float.start();
    return () => float.stop();
    // Reduce Motion is not a dependency: turning it off must not float the old delta again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scoreDelta, score]); // deltaOpacity/deltaTranslateY are stable Animated.Value refs

  // Turned on mid-float: stop it, and leave the "+N" faded out for when it is turned off again.
  useEffect(() => {
    if (!reduceMotion) return;
    floating.current?.stop();
    floating.current = null;
    deltaOpacity.setValue(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduceMotion]);

  return (
    <View style={styles.row}>
      <View
        style={[styles.card, { backgroundColor: colors.surfaceAlt, borderTopColor: colors.accent }]}
      >
        <Text numberOfLines={2} style={[styles.label, { color: colors.textMuted }]}>
          {t("twenty48:score.label")}
        </Text>
        <View style={styles.valueWrap}>
          <Text
            style={[styles.value, { color: colors.accent }]}
            numberOfLines={1}
            adjustsFontSizeToFit
            accessibilityLabel={t("twenty48:score.accessibilityLabel", { score })}
          >
            {score}
          </Text>
          {scoreDelta > 0 && !reduceMotion && (
            <Animated.Text
              style={[
                styles.delta,
                {
                  color: colors.accent,
                  opacity: deltaOpacity,
                  transform: [{ translateY: deltaTranslateY }],
                },
              ]}
              aria-hidden
              testID="scoreboard-delta"
            >
              {`+${scoreDelta}`}
            </Animated.Text>
          )}
        </View>
      </View>

      <View
        style={[
          styles.card,
          { backgroundColor: colors.surfaceAlt, borderTopColor: colors.secondary },
        ]}
      >
        <Text numberOfLines={2} style={[styles.label, { color: colors.textMuted }]}>
          {t("twenty48:score.best")}
        </Text>
        <Text
          style={[styles.value, { color: colors.secondary }]}
          numberOfLines={1}
          adjustsFontSizeToFit
          accessibilityLabel={t("twenty48:score.bestAccessibilityLabel", { score: bestScore })}
        >
          {bestScore}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // One slim row with the Highest Tile and Time cards beside it (#3688).
  row: {
    flex: 1,
    flexDirection: "row",
    gap: 8,
  },
  card: {
    flex: 1,
    minWidth: 0,
    paddingHorizontal: 6,
    paddingVertical: 6,
    borderRadius: 10,
    borderTopWidth: 2,
    alignItems: "center",
  },
  // Two lines, like the stats beside it (StatsBento): a long label wraps, never clips.
  label: {
    fontFamily: typography.label,
    fontSize: 9,
    lineHeight: 11,
    minHeight: 22,
    textAlign: "center",
    textAlignVertical: "center",
    textTransform: "uppercase",
    letterSpacing: 0.3,
  },
  value: {
    fontFamily: typography.heading,
    fontSize: 18,
    letterSpacing: -0.5,
  },
  valueWrap: {
    alignItems: "center",
    maxWidth: "100%",
  },
  delta: {
    position: "absolute",
    fontFamily: typography.label,
    fontSize: 12,
    top: -12,
  },
});
