import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "../../theme/ThemeContext";
import { typography } from "../../theme/typography";
import {
  UPPER_CATEGORY_KEYS,
  LOWER_CATEGORY_KEYS,
  CATEGORY_I18N_KEY,
} from "../../game/yacht/categories";

/** One player's finished scorecard. */
export interface FinalCard {
  scores: Record<string, number | null>;
  upperBonus: number;
  yachtBonusTotal: number;
  totalScore: number;
}

export interface YachtFinalScorecardProps {
  player: FinalCard;
  /** The CPU's card in vs mode; adds a second column. */
  opponent?: FinalCard;
}

type Winner = "you" | "cpu" | "tie";

/** Who takes a row (or the total): the higher number; `null` when a side is not scored. */
function winnerOf(you: number | null | undefined, cpu: number | null | undefined): Winner | null {
  if (you == null || cpu == null) return null;
  return you > cpu ? "you" : you < cpu ? "cpu" : "tie";
}

function fmtScore(val: number | null | undefined): string {
  return val != null ? String(val) : "—";
}

function fmtBonus(val: number): string {
  return val > 0 ? `+${val}` : "—";
}

function sumOf(scores: Record<string, number | null>, keys: readonly string[]): number {
  return keys.reduce((acc, k) => acc + (scores[k] ?? 0), 0);
}

/**
 * The full per-category final scorecard (#1819), shown in the detail slot of
 * the shared end-of-game result card (#2505). In a game against the computer it has a column per
 * player, the upper and lower subtotals of both (the result card's own Upper / Lower / Bonus stats
 * are the player's alone, so they are left to solo), and shows who won each row (#3748).
 */
export default function YachtFinalScorecard({ player, opponent }: YachtFinalScorecardProps) {
  const { t } = useTranslation("yacht");
  const { colors } = useTheme();
  const isVs = !!opponent;

  const bonusColor = (val: number) => (val > 0 ? colors.outcomeWin : colors.textMuted);

  /** A value cell: the winner of a row is bold, in its player's colour, on a tint. */
  function valueStyle(side: "you" | "cpu", winner: Winner | null) {
    const youWins = side === "you" && winner === "you";
    const cpuWins = side === "cpu" && winner === "cpu";
    return [
      styles.value,
      { color: side === "you" ? colors.text : colors.textMuted },
      youWins && {
        color: colors.outcomeWin,
        backgroundColor: colors.outcomeWinTint,
        fontFamily: typography.heading,
      },
      cpuWins && {
        color: colors.outcomeDraw,
        backgroundColor: colors.outcomeDrawTint,
        fontFamily: typography.heading,
      },
    ];
  }

  function renderScoreRow(cat: string) {
    const label = t(CATEGORY_I18N_KEY[cat] ?? cat);
    const you = player.scores[cat];
    const cpu = opponent?.scores[cat];
    const winner = opponent ? winnerOf(you, cpu) : null;
    const a11y =
      opponent && winner
        ? t(
            winner === "you"
              ? "gameOver.rowYou"
              : winner === "cpu"
                ? "gameOver.rowCpu"
                : "gameOver.rowTie",
            {
              category: label,
              you: fmtScore(you),
              cpu: fmtScore(cpu),
            }
          )
        : undefined;
    return (
      <View
        key={cat}
        style={styles.row}
        testID={`yacht-final-row-${cat}`}
        accessible={a11y !== undefined}
        accessibilityLabel={a11y}
      >
        <Text style={[styles.label, { color: colors.textMuted }]} numberOfLines={2}>
          {label}
        </Text>
        <Text style={valueStyle("you", winner)} testID={`yacht-final-you-${cat}`}>
          {fmtScore(you)}
        </Text>
        {opponent && (
          <Text style={valueStyle("cpu", winner)} testID={`yacht-final-cpu-${cat}`}>
            {fmtScore(cpu)}
          </Text>
        )}
      </View>
    );
  }

  /** A subtotal line (vs only): both players' sums, no winner. */
  function renderSubtotal(testID: string, label: string, you: number, cpu: number) {
    return (
      <View testID={testID} style={[styles.subtotalRow, { borderTopColor: colors.border }]}>
        <Text style={[styles.subtotalLabel, { color: colors.textMuted }]}>{label}</Text>
        <Text style={[styles.subtotalValue, { color: colors.text }]}>{you}</Text>
        <Text style={[styles.subtotalValue, { color: colors.textMuted }]}>{cpu}</Text>
      </View>
    );
  }

  const showYachtBonus = player.yachtBonusTotal > 0 || (opponent?.yachtBonusTotal ?? 0) > 0;
  const totalWinner = opponent ? winnerOf(player.totalScore, opponent.totalScore) : null;

  return (
    <View testID="yacht-final-scorecard" style={styles.container}>
      <Text style={[styles.header, { color: colors.textMuted }]}>{t("gameOver.scorecard")}</Text>

      {isVs && (
        <View style={styles.row}>
          <View style={styles.label} />
          <Text style={[styles.colHeader, { color: colors.textMuted }]}>{t("score.you")}</Text>
          <Text style={[styles.colHeader, { color: colors.textMuted }]}>{t("vsMode.cpu")}</Text>
        </View>
      )}

      <Text style={[styles.section, { color: colors.textMuted }]}>{t("section.upper")}</Text>
      {UPPER_CATEGORY_KEYS.map(renderScoreRow)}
      {opponent &&
        renderSubtotal(
          "yacht-final-upper-subtotal",
          t("vsMode.upperSubtotal"),
          sumOf(player.scores, UPPER_CATEGORY_KEYS),
          sumOf(opponent.scores, UPPER_CATEGORY_KEYS)
        )}
      <View style={[styles.subtotalRow, { borderTopColor: colors.border }]}>
        <Text style={[styles.subtotalLabel, { color: colors.textMuted }]}>
          {t("score.bonusRow")}
        </Text>
        <Text style={[styles.subtotalValue, { color: bonusColor(player.upperBonus) }]}>
          {fmtBonus(player.upperBonus)}
        </Text>
        {opponent && (
          <Text style={[styles.subtotalValue, { color: bonusColor(opponent.upperBonus) }]}>
            {fmtBonus(opponent.upperBonus)}
          </Text>
        )}
      </View>

      <Text style={[styles.section, styles.sectionGap, { color: colors.textMuted }]}>
        {t("section.lower")}
      </Text>
      {LOWER_CATEGORY_KEYS.map(renderScoreRow)}
      {opponent &&
        renderSubtotal(
          "yacht-final-lower-subtotal",
          t("vsMode.lowerSubtotal"),
          sumOf(player.scores, LOWER_CATEGORY_KEYS),
          sumOf(opponent.scores, LOWER_CATEGORY_KEYS)
        )}

      {showYachtBonus && (
        <View
          testID="yacht-bonus-row"
          style={[styles.subtotalRow, { borderTopColor: colors.border }]}
        >
          <Text style={[styles.subtotalLabel, { color: colors.textMuted }]}>
            {t("bonus.yachtLabel")}
          </Text>
          <Text style={[styles.subtotalValue, { color: bonusColor(player.yachtBonusTotal) }]}>
            {fmtBonus(player.yachtBonusTotal)}
          </Text>
          {opponent && (
            <Text style={[styles.subtotalValue, { color: bonusColor(opponent.yachtBonusTotal) }]}>
              {fmtBonus(opponent.yachtBonusTotal)}
            </Text>
          )}
        </View>
      )}

      <View style={[styles.totalRow, { borderTopColor: colors.border }]}>
        <Text style={[styles.totalLabel, { color: colors.text }]}>{t("section.total")}</Text>
        <Text style={valueStyle("you", totalWinner)} testID="yacht-final-you-total">
          {player.totalScore}
        </Text>
        {opponent && (
          <Text style={valueStyle("cpu", totalWinner)} testID="yacht-final-cpu-total">
            {opponent.totalScore}
          </Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignSelf: "stretch" },
  header: {
    fontFamily: typography.label,
    fontSize: 11,
    letterSpacing: 1.5,
    textTransform: "uppercase",
    marginBottom: 6,
  },
  section: {
    fontFamily: typography.label,
    fontSize: 10,
    letterSpacing: 1.5,
    textTransform: "uppercase",
    marginTop: 4,
    marginBottom: 2,
  },
  sectionGap: { marginTop: 10 },
  row: { flexDirection: "row", alignItems: "center", paddingVertical: 3 },
  label: { flex: 3, fontFamily: typography.body, fontSize: 13 },
  value: {
    flex: 1.5,
    fontFamily: typography.bodyMedium,
    fontSize: 13,
    textAlign: "right",
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 6,
    overflow: "hidden",
  },
  colHeader: {
    flex: 1.5,
    fontFamily: typography.label,
    fontSize: 10,
    letterSpacing: 1,
    textTransform: "uppercase",
    textAlign: "right",
    paddingHorizontal: 6,
  },
  subtotalRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 4,
    marginTop: 2,
    borderTopWidth: 1,
  },
  subtotalLabel: { flex: 3, fontFamily: typography.label, fontSize: 13 },
  subtotalValue: {
    flex: 1.5,
    fontFamily: typography.label,
    fontSize: 13,
    textAlign: "right",
    paddingHorizontal: 6,
  },
  totalRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 6,
    marginTop: 4,
    borderTopWidth: 1,
  },
  totalLabel: {
    flex: 3,
    fontFamily: typography.heading,
    fontSize: 14,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
});
