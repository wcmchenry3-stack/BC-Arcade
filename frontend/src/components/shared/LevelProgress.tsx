import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "../../theme/ThemeContext";

export interface LevelProgressProps {
  level: number;
  totalXp: number;
  xpIntoLevel: number;
  /** XP still needed for the next level — a countdown, and 0 at max level. */
  xpForNextLevel: number;
}

/**
 * Whole-number share (0–100) of the current level already earned.
 *
 * `/stats/me` reports `xp_for_next_level` as the XP still missing, so the
 * level's full size is the two fields added together. At max level the server
 * sends 0 for it (see `backend/games/progression.py`) and the bar reads full.
 * Rounded down so the bar never shows 100% one XP short of the level.
 */
export function levelProgressPercent(xpIntoLevel: number, xpForNextLevel: number): number {
  if (xpForNextLevel <= 0) return 100;
  const levelSize = xpIntoLevel + xpForNextLevel;
  const percent = Math.floor((xpIntoLevel / levelSize) * 100);
  return Number.isFinite(percent) ? Math.min(100, Math.max(0, percent)) : 0;
}

/** Arcade level card for the Profile header: level, total XP and a bar towards the next level (#2391). */
export default function LevelProgress({
  level,
  totalXp,
  xpIntoLevel,
  xpForNextLevel,
}: LevelProgressProps) {
  const { colors } = useTheme();
  const { t } = useTranslation("profile");

  const isMaxLevel = xpForNextLevel <= 0;
  const percent = levelProgressPercent(xpIntoLevel, xpForNextLevel);
  const nextLevel = level + 1;
  const caption = isMaxLevel
    ? t("level.max")
    : t("level.xpToNext", { xp: xpForNextLevel.toLocaleString(), level: nextLevel });

  return (
    <View style={[styles.card, { backgroundColor: colors.surfaceAlt }]}>
      <Text style={[styles.label, { color: colors.textMuted }]}>{t("level.title")}</Text>
      <View style={styles.valueRow}>
        <Text style={[styles.value, { color: colors.text }]}>{t("level.value", { level })}</Text>
        <Text style={[styles.totalXp, { color: colors.textMuted }]}>
          {t("level.xpTotal", { xp: totalXp.toLocaleString() })}
        </Text>
      </View>
      <View
        style={[styles.track, { backgroundColor: colors.surfaceHigh, borderColor: colors.border }]}
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel={
          isMaxLevel ? t("level.max") : t("level.progressA11y", { level: nextLevel })
        }
        accessibilityValue={{ min: 0, max: 100, now: percent }}
      >
        <View style={[styles.fill, { backgroundColor: colors.accent, width: `${percent}%` }]} />
      </View>
      <Text style={[styles.caption, { color: colors.textMuted }]}>{caption}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  // Matches ProfileScreen's bento cards so the header reads as part of the same block.
  card: {
    marginHorizontal: 12,
    marginTop: 12,
    padding: 14,
    borderRadius: 16,
  },
  label: {
    fontSize: 10,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 1.2,
    marginBottom: 6,
  },
  valueRow: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  value: { fontSize: 24, fontWeight: "800" },
  totalXp: { fontSize: 13, fontWeight: "700" },
  track: {
    height: 10,
    borderRadius: 999,
    borderWidth: 1,
    overflow: "hidden",
  },
  fill: { height: "100%", borderRadius: 999 },
  caption: { fontSize: 11, marginTop: 6 },
});
