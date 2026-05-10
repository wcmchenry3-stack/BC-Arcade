import React from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "../../theme/ThemeContext";
import { typography } from "../../theme/typography";

interface HudSidebarProps {
  currentPot: number;
  lastWin: number | null;
  chips?: number;
  startingChips?: number;
  runGoal?: number | null;
  onPress?: () => void;
  winStreak?: number;
}

export default function HudSidebar({
  currentPot,
  lastWin,
  chips,
  startingChips,
  runGoal,
  onPress,
  winStreak = 0,
}: HudSidebarProps) {
  const { t } = useTranslation("blackjack");
  const { colors } = useTheme();

  const lastWinLabel = (() => {
    if (lastWin === null) return t("hud.lastWinNull");
    if (lastWin === 0) return t("hud.lastWinZero");
    if (lastWin > 0) return t("hud.lastWinPositive", { amount: lastWin });
    return t("hud.lastWinNegative", { amount: lastWin });
  })();

  const lastWinColor = (() => {
    if (lastWin === null || lastWin === 0) return colors.textMuted;
    return lastWin > 0 ? colors.bonus : colors.error;
  })();

  const lastWinA11y = (() => {
    if (lastWin === null) return t("hud.lastWinAccessibilityLabel", { result: "none" });
    if (lastWin === 0) return t("hud.lastWinAccessibilityLabel", { result: "push" });
    return t("hud.lastWinAccessibilityLabel", { result: `${lastWin > 0 ? "+" : ""}${lastWin}` });
  })();

  const isLowChips =
    chips != null && startingChips != null && startingChips > 0 && chips < startingChips * 0.3;
  const showStreak = winStreak >= 3;

  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={[
        styles.container,
        {
          backgroundColor: colors.surfaceAlt,
          borderColor: isLowChips ? colors.error : colors.border,
        },
      ]}
      accessibilityRole={onPress ? "button" : undefined}
      accessibilityLabel={onPress ? t("hud.statsAccessibilityLabel") : undefined}
    >
      {/* Current Pot */}
      <View style={styles.row}>
        <Text style={[styles.label, { color: colors.textMuted, fontFamily: typography.label }]}>
          {t("hud.currentPot")}
        </Text>
        <Text
          style={[styles.value, { color: colors.text, fontFamily: typography.heading }]}
          accessibilityLabel={t("hud.currentPotAccessibilityLabel", { amount: currentPot })}
        >
          {currentPot > 0 ? currentPot.toLocaleString() : "—"}
        </Text>
      </View>

      <View style={[styles.divider, { backgroundColor: colors.border }]} />

      {/* Last Win */}
      <View style={styles.row}>
        <Text style={[styles.label, { color: colors.textMuted, fontFamily: typography.label }]}>
          {t("hud.lastWin")}
        </Text>
        <Text
          style={[styles.value, { color: lastWinColor, fontFamily: typography.heading }]}
          accessibilityLabel={lastWinA11y}
        >
          {lastWinLabel}
        </Text>
      </View>

      {/* Win streak badge — appears on 3+ consecutive wins */}
      {showStreak && (
        <>
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <View style={styles.row}>
            <Text
              style={[styles.streakBadge, { color: colors.bonus, fontFamily: typography.heading }]}
              accessibilityLabel={t("hud.winStreakAccessibilityLabel", { count: winStreak })}
            >
              {t("hud.winStreak", { count: winStreak })}
            </Text>
          </View>
        </>
      )}

      {/* Goal progress — only shown when table has a run goal */}
      {runGoal != null && chips != null && (
        <>
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <View style={styles.row}>
            <Text style={[styles.label, { color: colors.textMuted, fontFamily: typography.label }]}>
              {t("hud.runGoal")}
            </Text>
            <Text
              style={[
                styles.value,
                { color: isLowChips ? colors.error : colors.text, fontFamily: typography.heading },
              ]}
              accessibilityLabel={t("hud.goalProgressAccessibilityLabel", {
                chips,
                goal: runGoal,
              })}
            >
              {t("hud.goalProgress", { chips, goal: runGoal })}
            </Text>
          </View>
        </>
      )}

      {/* Stats link hint — only shown when sidebar is tappable */}
      {onPress && (
        <>
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <Text
            style={[styles.statsHint, { color: colors.accent }]}
            accessibilityElementsHidden
          >
            {t("hud.viewStats")}
          </Text>
        </>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 10,
    borderWidth: 1,
    paddingVertical: 10,
    paddingHorizontal: 12,
    minWidth: 80,
  },
  row: {
    alignItems: "center",
    gap: 2,
  },
  label: {
    fontSize: 10,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  value: {
    fontSize: 16,
    lineHeight: 20,
  },
  streakBadge: {
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 0.4,
  },
  divider: {
    height: 1,
    marginVertical: 8,
  },
  statsHint: {
    fontSize: 9,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.8,
    textAlign: "center",
  },
});
