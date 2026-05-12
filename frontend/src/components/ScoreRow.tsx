import React from "react";
import { Pressable, Text, StyleSheet, View, Platform, TextStyle } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "../theme/ThemeContext";
import CategoryIcon from "./yacht/CategoryIcon";

interface ScoreRowProps {
  label: string;
  category: string;
  tone: "upper" | "lower";
  score: number | null;
  potential: number | undefined;
  onSelect: () => void;
  canScore: boolean;
  compact?: boolean;
}

export default function ScoreRow({
  label,
  category,
  tone,
  score,
  potential,
  onSelect,
  canScore,
  compact = false,
}: ScoreRowProps) {
  const { t } = useTranslation("yacht");
  const { colors } = useTheme();
  const isFilled = score !== null;
  const isSelectable = !isFilled && canScore;
  const hasPotential = !isFilled && canScore && potential !== undefined;

  const stateText = isFilled
    ? t("score.scored", { score })
    : hasPotential
      ? t("score.potential", { potential })
      : t("score.notAvailable");
  const accessLabel = t("score.label", { category: label, state: stateText });

  const accentColor = tone === "upper" ? colors.accent : colors.secondary;
  const glowColor = tone === "upper" ? "rgba(143,245,255,0.45)" : "rgba(214,116,255,0.45)";

  // neon text-shadow is only meaningful on web
  const glowStyle: TextStyle | null =
    isFilled && Platform.OS === "web"
      ? ({ textShadow: `0 0 10px ${glowColor}` } as TextStyle)
      : null;

  return (
    <Pressable
      style={[
        styles.row,
        compact && styles.rowCompact,
        {
          backgroundColor: colors.surface,
          borderColor: isFilled ? accentColor : colors.border,
          borderLeftWidth: isFilled ? 3 : 1,
        },
      ]}
      onPress={isSelectable ? onSelect : undefined}
      disabled={!isSelectable}
      accessibilityRole="button"
      accessibilityLabel={accessLabel}
      accessibilityState={{ disabled: !isSelectable }}
    >
      <View style={styles.labelBox}>
        {!compact && <CategoryIcon category={category} tone={tone} muted={!isFilled} />}
        <Text
          style={[
            styles.label,
            compact && styles.labelCompact,
            { color: isFilled ? colors.text : colors.textMuted },
          ]}
          numberOfLines={1}
        >
          {label}
        </Text>
      </View>
      <View style={styles.scoreBox}>
        {isFilled ? (
          <Text style={[styles.score, { color: accentColor }, glowStyle]}>{score}</Text>
        ) : hasPotential ? (
          <Text style={[styles.potential, { color: colors.potential }]}>{potential}</Text>
        ) : (
          <Text style={[styles.dash, { color: colors.textMuted }]}>—</Text>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 8,
    minHeight: 44,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 6,
  },
  rowCompact: {
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  labelBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flex: 1,
  },
  label: {
    fontSize: 13,
    fontWeight: "600",
    flexShrink: 1,
  },
  labelCompact: {
    fontSize: 12,
  },
  scoreBox: {
    minWidth: 44,
    alignItems: "flex-end",
  },
  score: {
    fontSize: 16,
    fontWeight: "800",
  },
  potential: {
    fontSize: 14,
    fontWeight: "600",
    fontStyle: "italic",
  },
  dash: {
    fontSize: 14,
  },
});
