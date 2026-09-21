import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { LinearGradient } from "expo-linear-gradient";
import { useTheme } from "../../theme/ThemeContext";
import { typography } from "../../theme/typography";
import { GAME_TITLE_NAMESPACES, gameTitle } from "../../i18n/gameTitle";
import type { ChallengeGoal } from "../../game/daily_challenge/api";
import { useDailyChallenge } from "../../game/daily_challenge/useDailyChallenge";

/**
 * Today's cross-game challenge, shown at the top of Home (#2392).
 *
 * A decorative-adjacent surface: while loading it holds its space so the grid
 * doesn't jump, and a server-side failure renders nothing rather than an error
 * the player can't act on. Only being offline gets a message, because that one
 * they can fix.
 */
export default function DailyChallengeCard() {
  const { t } = useTranslation(["daily_challenge", ...GAME_TITLE_NAMESPACES]);
  const { colors } = useTheme();
  const { phase, challenge, refresh } = useDailyChallenge();

  const gradient: [string, string] = [colors.tertiary, colors.secondary];

  function goalLabel(goal: ChallengeGoal): string {
    const game = gameTitle(t, goal.gameSlug);
    return goal.kind === "score_at_least"
      ? t("daily_challenge:goal.scoreAtLeast", { game, target: goal.target })
      : t("daily_challenge:goal.complete", { game });
  }

  function renderBody() {
    if (challenge) {
      const total = challenge.goals.length;
      const done = challenge.goals.filter((goal) => goal.completed).length;
      const allDone = total > 0 && done === total;
      return (
        <>
          <View style={styles.headerRow}>
            <Text style={[styles.title, { color: colors.text }]}>{t("daily_challenge:title")}</Text>
            <Text
              style={[styles.progress, { color: allDone ? colors.accent : colors.textMuted }]}
              testID="daily-challenge-progress"
            >
              {t("daily_challenge:progress", { done, total })}
            </Text>
          </View>
          <View style={styles.chips}>
            {challenge.goals.map((goal) => {
              const label = goalLabel(goal);
              return (
                <View
                  key={goal.id}
                  style={[
                    styles.chip,
                    goal.completed
                      ? { backgroundColor: colors.accent, borderColor: colors.accent }
                      : { borderColor: colors.border },
                  ]}
                  accessible
                  accessibilityRole="text"
                  accessibilityLabel={t(
                    goal.completed
                      ? "daily_challenge:goal.doneA11y"
                      : "daily_challenge:goal.todoA11y",
                    { goal: label }
                  )}
                  testID={`daily-challenge-goal-${goal.id}`}
                >
                  {/* "✓" / "○" are text-presentation glyphs: they take the Text colour
                      (default black), so set it explicitly. The a11y label carries the
                      state, so the glyph itself is hidden from screen readers. */}
                  <Text
                    style={[
                      styles.chipMark,
                      { color: goal.completed ? colors.textOnAccent : colors.textMuted },
                    ]}
                    importantForAccessibility="no"
                    accessibilityElementsHidden
                    testID={`daily-challenge-mark-${goal.id}`}
                  >
                    {goal.completed ? "✓" : "○"}
                  </Text>
                  <Text
                    style={[
                      styles.chipText,
                      { color: goal.completed ? colors.textOnAccent : colors.text },
                    ]}
                    importantForAccessibility="no"
                    accessibilityElementsHidden
                  >
                    {label}
                  </Text>
                </View>
              );
            })}
          </View>
          {allDone ? (
            <Text style={[styles.note, { color: colors.textMuted }]}>
              {t("daily_challenge:allDone")}
            </Text>
          ) : null}
        </>
      );
    }

    if (phase === "offline") {
      return (
        <Pressable
          onPress={refresh}
          accessibilityRole="button"
          accessibilityLabel={t("daily_challenge:offline.retryA11y")}
          testID="daily-challenge-offline"
        >
          <Text style={[styles.title, { color: colors.text }]}>{t("daily_challenge:title")}</Text>
          <Text style={[styles.offlineTitle, { color: colors.text }]}>
            {t("daily_challenge:offline.title")}
          </Text>
          <Text style={[styles.note, { color: colors.textMuted }]}>
            {t("daily_challenge:offline.body")}
          </Text>
        </Pressable>
      );
    }

    // loading — same footprint as a one-row card so the grid doesn't jump when it resolves.
    return (
      <View
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel={t("daily_challenge:loading.a11y")}
        testID="daily-challenge-loading"
      >
        <Text style={[styles.title, { color: colors.text }]}>{t("daily_challenge:title")}</Text>
        <View style={styles.chips}>
          {[0, 1, 2].map((i) => (
            <View key={i} style={[styles.chipSkeleton, { backgroundColor: colors.surfaceAlt }]} />
          ))}
        </View>
      </View>
    );
  }

  if (phase === "unavailable") return null;

  return (
    <View
      style={[styles.card, { backgroundColor: colors.surfaceHigh }]}
      testID="daily-challenge-card"
    >
      <LinearGradient
        colors={gradient}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={styles.gradientBorder}
      />
      <View style={styles.body}>{renderBody()}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 24,
    overflow: "hidden",
  },
  gradientBorder: {
    width: "100%",
    height: 3,
  },
  body: {
    padding: 16,
    gap: 12,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: 8,
  },
  title: {
    fontFamily: typography.heading,
    fontSize: 16,
    letterSpacing: -0.3,
  },
  progress: {
    fontFamily: typography.label,
    fontSize: 11,
    letterSpacing: 0.6,
  },
  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  chipMark: {
    fontFamily: typography.label,
    fontSize: 12,
  },
  chipText: {
    fontFamily: typography.label,
    fontSize: 12,
  },
  chipSkeleton: {
    width: 96,
    height: 30,
    borderRadius: 999,
  },
  note: {
    fontFamily: typography.body,
    fontSize: 12,
    lineHeight: 16,
  },
  offlineTitle: {
    fontFamily: typography.label,
    fontSize: 13,
    marginTop: 8,
    marginBottom: 2,
  },
});
