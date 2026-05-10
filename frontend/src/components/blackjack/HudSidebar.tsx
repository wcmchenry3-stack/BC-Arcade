import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "../../theme/ThemeContext";
import { typography } from "../../theme/typography";

interface HudSidebarProps {
  chips: number;
  startingChips: number;
  runGoal: number;
  milestones: readonly number[];
  tableName: string;
  tableAccentColor: string;
  winStreak?: number;
}

export default function HudSidebar({
  chips,
  startingChips,
  runGoal,
  milestones,
  tableName,
  tableAccentColor,
  winStreak = 0,
}: HudSidebarProps) {
  const { t } = useTranslation("blackjack");
  const { colors } = useTheme();

  const isLowChips = startingChips > 0 && chips < startingChips * 0.3;
  const isCritical = startingChips > 0 && chips < startingChips * 0.2;
  const showStreak = winStreak >= 3;

  const hudColor = isCritical ? colors.error : isLowChips ? "#ffb547" : colors.text;
  const barColor = isCritical ? colors.error : isLowChips ? "#ffb547" : tableAccentColor;
  const goalProgress = Math.min(1, chips / runGoal);

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: colors.surface,
          // colors.error is always a 6-digit hex token; appending "55" gives 33% alpha
          borderColor: isCritical ? colors.error + "55" : colors.border,
        },
      ]}
    >
      {/* Top row: table pill | chip/goal | streak badge */}
      <View style={styles.topRow}>
        <View style={styles.tableTag} accessibilityElementsHidden>
          <View style={[styles.dot, { backgroundColor: tableAccentColor }]} />
          <Text style={[styles.tagText, { color: colors.textMuted, fontFamily: typography.label }]}>
            {tableName.toUpperCase()}
          </Text>
        </View>

        <View style={styles.chipBlock}>
          <Text
            style={[styles.chipsText, { color: hudColor, fontFamily: typography.heading }]}
            accessibilityLabel={t("hud.goalProgressAccessibilityLabel", { chips, goal: runGoal })}
          >
            {chips.toLocaleString()}
          </Text>
          <Text style={[styles.goalText, { color: colors.textMuted, fontFamily: typography.label }]}>
            {" / "}
            {runGoal.toLocaleString()}
          </Text>
        </View>

        {showStreak && (
          <View style={[styles.streakBadge, { borderColor: tableAccentColor }]}>
            <Text
              style={[styles.streakText, { color: tableAccentColor }]}
              accessibilityLabel={t("hud.winStreakAccessibilityLabel", { count: winStreak })}
            >
              {t("hud.winStreakBadge", { count: winStreak })}
            </Text>
          </View>
        )}
      </View>

      {/* Progress bar with milestone tick marks.
          barWrapper is 6 px tall so ticks (6 px) can protrude 1 px above/below
          the 4 px barTrack without being clipped by overflow:hidden. */}
      <View style={styles.barWrapper}>
        <View style={[styles.barTrack, { backgroundColor: colors.border }]}>
          <View
            style={[
              styles.barFill,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              { width: `${(goalProgress * 100).toFixed(1)}%` as any, backgroundColor: barColor },
            ]}
          />
        </View>
        {milestones.map((m, i) => (
          <View
            key={i}
            style={[
              styles.tick,
              {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                left: `${((m / runGoal) * 100).toFixed(1)}%` as any,
                backgroundColor: chips >= m ? barColor : colors.border,
              },
            ]}
          />
        ))}
      </View>

      {isCritical && (
        <Text style={[styles.warning, { color: colors.error, fontFamily: typography.label }]}>
          {t("hud.criticalWarning")}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
    width: "100%",
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  tableTag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  tagText: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1,
  },
  chipBlock: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 2,
    flex: 1,
    justifyContent: "center",
  },
  chipsText: {
    fontSize: 20,
    fontWeight: "800",
    letterSpacing: -0.5,
    lineHeight: 24,
  },
  goalText: {
    fontSize: 13,
    fontWeight: "600",
    lineHeight: 24,
  },
  streakBadge: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  streakText: {
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 1,
  },
  barWrapper: {
    height: 6,
    position: "relative",
    justifyContent: "center",
  },
  barTrack: {
    height: 4,
    borderRadius: 2,
  },
  barFill: {
    position: "absolute",
    top: 0,
    left: 0,
    height: "100%",
    borderRadius: 2,
  },
  tick: {
    position: "absolute",
    top: 0,
    width: 2,
    height: 6,
    borderRadius: 1,
  },
  warning: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.5,
    textAlign: "center",
  },
});
