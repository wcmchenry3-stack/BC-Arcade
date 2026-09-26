import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "../../theme/ThemeContext";
import {
  UPPER_BONUS_VALUE,
  bonusCountdown,
  bonusEarned,
  upperSum,
  winnerColumn,
} from "./yachtScorecardModel";

export interface YachtScorecardSide {
  readonly scores: Readonly<Record<string, number | null>>;
  readonly upperSubtotal: number;
  readonly upperBonus: number;
  readonly yachtBonusCount: number;
  readonly totalScore: number;
}

interface Props {
  readonly you: YachtScorecardSide;
  /** Opponent side. When null/undefined the variant renders a single-column "You" layout. */
  readonly opponent?: YachtScorecardSide | null;
  /** Display label for "You" — defaults to the i18n key "yacht:score.you". */
  readonly youLabel?: string;
  /** Display label for the opponent — only rendered when `opponent` is provided. */
  readonly opponentLabel?: string;
}

const UPPER_CATS = ["ones", "twos", "threes", "fours", "fives", "sixes"] as const;
const LOWER_CATS = [
  "three_of_a_kind",
  "four_of_a_kind",
  "full_house",
  "small_straight",
  "large_straight",
  "yacht",
  "chance",
] as const;

const CATEGORY_KEY: Record<string, string> = {
  ones: "yacht:category.ones",
  twos: "yacht:category.twos",
  threes: "yacht:category.threes",
  fours: "yacht:category.fours",
  fives: "yacht:category.fives",
  sixes: "yacht:category.sixes",
  three_of_a_kind: "yacht:category.threeOfAKind",
  four_of_a_kind: "yacht:category.fourOfAKind",
  full_house: "yacht:category.fullHouse",
  small_straight: "yacht:category.smallStraight",
  large_straight: "yacht:category.largeStraight",
  yacht: "yacht:category.yacht",
  chance: "yacht:category.chance",
};

export default function YachtScorecard({ you, opponent, youLabel, opponentLabel }: Props) {
  const { t } = useTranslation(["yacht", "common"]);
  const { colors } = useTheme();
  const hasOpponent = !!opponent;
  const winner = hasOpponent ? winnerColumn(you.totalScore, opponent.totalScore) : "you";

  function totalsColor(side: "you" | "opp"): string {
    if (!hasOpponent) return colors.text;
    if (winner === "tie") return colors.text;
    return winner === side ? colors.bonus : colors.text;
  }

  function valueText(v: number | null): { text: string; muted: boolean } {
    if (v == null) return { text: t("yacht:score.empty"), muted: true };
    return { text: String(v), muted: false };
  }

  function renderCategoryRow(cat: string, isAlt: boolean) {
    const youCell = valueText(you.scores[cat] ?? null);
    const oppCell = hasOpponent ? valueText(opponent.scores[cat] ?? null) : null;
    return (
      <View key={cat} style={[styles.row, isAlt && { backgroundColor: colors.surfaceAlt + "44" }]}>
        <Text style={[styles.categoryCell, { color: colors.text }]}>{t(CATEGORY_KEY[cat]!)}</Text>
        <Text style={[styles.valueCell, { color: youCell.muted ? colors.textMuted : colors.text }]}>
          {youCell.text}
        </Text>
        {oppCell && (
          <Text
            style={[styles.valueCell, { color: oppCell.muted ? colors.textMuted : colors.text }]}
          >
            {oppCell.text}
          </Text>
        )}
      </View>
    );
  }

  function renderBonusRow() {
    const youUpper = upperSum(you.scores);
    const oppUpper = hasOpponent ? upperSum(opponent.scores) : 0;
    const youText = bonusEarned(youUpper)
      ? `+${UPPER_BONUS_VALUE}`
      : t("yacht:score.bonusCountdown", { n: bonusCountdown(youUpper) });
    const oppText =
      hasOpponent &&
      (bonusEarned(oppUpper)
        ? `+${UPPER_BONUS_VALUE}`
        : t("yacht:score.bonusCountdown", { n: bonusCountdown(oppUpper) }));
    return (
      <View
        style={[styles.row, styles.bonusRow, { borderTopColor: colors.border }]}
        accessibilityLabel={t("yacht:score.bonusRow")}
      >
        <Text style={[styles.categoryCell, styles.bonusLabel, { color: colors.textMuted }]}>
          {t("yacht:score.bonusLabel")}
        </Text>
        <Text
          style={[
            styles.valueCell,
            styles.bonusValue,
            { color: bonusEarned(youUpper) ? colors.bonus : colors.textMuted },
          ]}
        >
          {youText}
        </Text>
        {hasOpponent && (
          <Text
            style={[
              styles.valueCell,
              styles.bonusValue,
              { color: bonusEarned(oppUpper) ? colors.bonus : colors.textMuted },
            ]}
          >
            {oppText}
          </Text>
        )}
      </View>
    );
  }

  function renderTotalRow() {
    return (
      <View style={[styles.row, styles.totalRow, { borderTopColor: colors.border }]}>
        <Text style={[styles.categoryCell, styles.totalLabel, { color: colors.textMuted }]}>
          {t("yacht:score.total")}
        </Text>
        <Text style={[styles.valueCell, styles.totalValue, { color: totalsColor("you") }]}>
          {you.totalScore}
        </Text>
        {hasOpponent && (
          <Text style={[styles.valueCell, styles.totalValue, { color: totalsColor("opp") }]}>
            {opponent.totalScore}
          </Text>
        )}
      </View>
    );
  }

  const youHeader = youLabel ?? t("yacht:score.you");
  const oppHeader = opponentLabel ?? t("yacht:score.opponent");

  return (
    <View style={styles.container}>
      <View style={[styles.row, styles.headerRow, { borderBottomColor: colors.border }]}>
        <Text style={[styles.categoryCell, styles.headerText, { color: colors.textMuted }]}> </Text>
        <Text style={[styles.valueCell, styles.headerText, { color: totalsColor("you") }]}>
          {youHeader}
        </Text>
        {hasOpponent && (
          <Text style={[styles.valueCell, styles.headerText, { color: totalsColor("opp") }]}>
            {oppHeader}
          </Text>
        )}
      </View>

      <View style={[styles.table, { borderColor: colors.border }]}>
        {UPPER_CATS.map((cat, i) => renderCategoryRow(cat, i % 2 === 1))}
        {renderBonusRow()}
        {LOWER_CATS.map((cat, i) => renderCategoryRow(cat, i % 2 === 1))}
        {renderTotalRow()}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: "100%",
    gap: 8,
  },
  table: {
    borderWidth: 1,
    borderRadius: 8,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
  },
  headerRow: {
    borderBottomWidth: 1,
    paddingVertical: 4,
  },
  bonusRow: {
    borderTopWidth: 1,
    backgroundColor: "transparent",
  },
  totalRow: {
    borderTopWidth: 1,
  },
  headerText: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.3,
  },
  categoryCell: {
    flex: 2,
    paddingVertical: 6,
    paddingHorizontal: 10,
    fontSize: 13,
  },
  valueCell: {
    flex: 1,
    paddingVertical: 6,
    paddingHorizontal: 10,
    fontSize: 13,
    textAlign: "right",
    fontVariant: ["tabular-nums"],
  },
  bonusLabel: {
    fontStyle: "italic",
    fontSize: 12,
  },
  bonusValue: {
    fontStyle: "italic",
    fontSize: 12,
  },
  totalLabel: {
    fontWeight: "700",
    textTransform: "uppercase",
    fontSize: 12,
  },
  totalValue: {
    fontWeight: "700",
    fontSize: 16,
  },
});
