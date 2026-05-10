import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "../../theme/ThemeContext";
import { typography } from "../../theme/typography";

interface HudSidebarProps {
  currentPot: number;
  lastWin: number | null;
  chips?: number;
  runGoal?: number | null;
}

export default function HudSidebar({ currentPot, lastWin, chips, runGoal }: HudSidebarProps) {
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

  return (
    <View
      style={[styles.container, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}
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

      {/* Goal progress — only shown when table has a run goal */}
      {runGoal != null && chips != null && (
        <>
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <View style={styles.row}>
            <Text style={[styles.label, { color: colors.textMuted, fontFamily: typography.label }]}>
              {t("hud.runGoal")}
            </Text>
            <Text
              style={[styles.value, { color: colors.text, fontFamily: typography.heading }]}
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
    </View>
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
  divider: {
    height: 1,
    marginVertical: 8,
  },
});
