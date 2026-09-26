import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "../../theme/ThemeContext";
import {
  barColor,
  computeStandings,
  detectMoonInRow,
  progressFraction,
  scoreColor,
} from "./heartsRoundsModel";

const HUMAN = 0;

interface Props {
  playerLabels: readonly string[];
  cumulativeScores: readonly number[];
  /** scoreHistory[round][playerIndex] = applied points that round (post-moon). */
  scoreHistory: readonly (readonly number[])[];
  /** Hide totals strip + footnote for embedding in mid-game modals. */
  compact?: boolean;
}

export default function HeartsScorecard({
  playerLabels,
  cumulativeScores,
  scoreHistory,
  compact = false,
}: Props) {
  const { t } = useTranslation("hearts");
  const { colors } = useTheme();
  const standing = computeStandings(cumulativeScores);

  return (
    <View style={styles.container}>
      {!compact && (
        <View style={styles.totalsStrip}>
          {playerLabels.map((label, i) => {
            const total = cumulativeScores[i] ?? 0;
            const isHuman = i === HUMAN;
            return (
              <View
                key={i}
                style={[
                  styles.totalsCell,
                  isHuman && {
                    backgroundColor: colors.surfaceAlt,
                    borderColor: colors.border,
                  },
                  isHuman && styles.totalsCellHuman,
                ]}
              >
                <Text style={[styles.totalsName, { color: colors.textMuted }]} numberOfLines={1}>
                  {label}
                </Text>
                <Text
                  style={[styles.totalsScore, { color: scoreColor(i, standing, colors) }]}
                  // Space Grotesk is the variable display face per the design system;
                  // fall back to default if not loaded so tests don't fail.
                >
                  {total}
                </Text>
                <View style={[styles.barTrack, { backgroundColor: colors.border }]}>
                  <View
                    style={[
                      styles.barFill,
                      {
                        width: `${progressFraction(total) * 100}%`,
                        backgroundColor: barColor(i, total, standing, colors),
                      },
                    ]}
                  />
                </View>
              </View>
            );
          })}
        </View>
      )}

      <View style={[styles.table, { borderColor: colors.border }]}>
        <View style={[styles.headerRow, { borderBottomColor: colors.border }]}>
          <Text style={[styles.roundCell, styles.headerText, { color: colors.textMuted }]}>#</Text>
          {playerLabels.map((label, i) => (
            <Text
              key={i}
              style={[styles.cell, styles.headerText, { color: scoreColor(i, standing, colors) }]}
            >
              {(label[0] ?? "?").toUpperCase()}
            </Text>
          ))}
        </View>

        {scoreHistory.map((row, round) => {
          const moon = detectMoonInRow(row);
          const isAlt = round % 2 === 1;
          return (
            <View
              key={round}
              style={[styles.row, isAlt && { backgroundColor: colors.surfaceAlt + "44" }]}
            >
              <Text style={[styles.roundCell, { color: colors.textMuted }]}>{round + 1}</Text>
              {row.map((value, i) => {
                let cellColor = colors.text;
                let display = String(value);
                if (moon) {
                  if (i === moon.shooterIndex) {
                    cellColor = colors.bonus;
                    display = "0★";
                  } else {
                    cellColor = colors.error;
                  }
                }
                return (
                  <Text key={i} style={[styles.cell, { color: cellColor }]}>
                    {display}
                  </Text>
                );
              })}
            </View>
          );
        })}

        <View style={[styles.totalRow, { borderTopColor: colors.border }]}>
          <Text style={[styles.roundCell, styles.totalText, { color: colors.textMuted }]}>Σ</Text>
          {cumulativeScores.map((score, i) => (
            <Text
              key={i}
              style={[styles.cell, styles.totalText, { color: scoreColor(i, standing, colors) }]}
            >
              {score}
            </Text>
          ))}
        </View>
      </View>

      {!compact && (
        <Text style={[styles.footnote, { color: colors.textMuted }]}>{t("score.footnote")}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: "100%",
    gap: 12,
  },
  totalsStrip: {
    flexDirection: "row",
    gap: 8,
  },
  totalsCell: {
    flex: 1,
    alignItems: "center",
    gap: 4,
    paddingVertical: 8,
    paddingHorizontal: 4,
    borderRadius: 8,
  },
  totalsCellHuman: {
    borderWidth: 1,
  },
  totalsName: {
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 0.3,
  },
  totalsScore: {
    fontSize: 24,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
  barTrack: {
    height: 4,
    width: "80%",
    borderRadius: 2,
    overflow: "hidden",
  },
  barFill: {
    height: "100%",
  },
  table: {
    borderWidth: 1,
    borderRadius: 8,
    overflow: "hidden",
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: 1,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
  },
  totalRow: {
    flexDirection: "row",
    alignItems: "center",
    borderTopWidth: 1,
  },
  headerText: {
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  totalText: {
    fontWeight: "700",
    fontSize: 13,
  },
  roundCell: {
    width: 32,
    paddingVertical: 4,
    paddingHorizontal: 6,
    fontSize: 12,
    textAlign: "center",
  },
  cell: {
    flex: 1,
    paddingVertical: 4,
    paddingHorizontal: 4,
    fontSize: 13,
    textAlign: "right",
    fontVariant: ["tabular-nums"],
  },
  footnote: {
    fontSize: 11,
    fontWeight: "500",
    textAlign: "center",
  },
});
