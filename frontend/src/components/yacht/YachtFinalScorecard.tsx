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

function fmtScore(val: number | null | undefined): string {
  return val != null ? String(val) : "—";
}

function fmtBonus(val: number): string {
  return val > 0 ? `+${val}` : "—";
}

/**
 * The full per-category final scorecard (#1819), shown in the detail slot of
 * the shared end-of-game result card (#2505).
 */
export default function YachtFinalScorecard({ player, opponent }: YachtFinalScorecardProps) {
  const { t } = useTranslation("yacht");
  const { colors } = useTheme();
  const isVs = !!opponent;

  const bonusColor = (val: number) => (val > 0 ? colors.outcomeWin : colors.textMuted);

  function renderScoreRow(cat: string) {
    return (
      <View key={cat} style={styles.row}>
        <Text style={[styles.label, { color: colors.textMuted }]} numberOfLines={1}>
          {t(CATEGORY_I18N_KEY[cat] ?? cat)}
        </Text>
        <Text style={[styles.value, { color: colors.text }]}>{fmtScore(player.scores[cat])}</Text>
        {opponent && (
          <Text style={[styles.value, { color: colors.textMuted }]}>
            {fmtScore(opponent.scores[cat])}
          </Text>
        )}
      </View>
    );
  }

  const showYachtBonus = player.yachtBonusTotal > 0 || (opponent?.yachtBonusTotal ?? 0) > 0;

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
        <Text style={[styles.totalValue, { color: colors.text }]}>{player.totalScore}</Text>
        {opponent && (
          <Text style={[styles.totalValue, { color: colors.textMuted }]}>
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
  value: { flex: 1.5, fontFamily: typography.bodyMedium, fontSize: 13, textAlign: "right" },
  colHeader: {
    flex: 1.5,
    fontFamily: typography.label,
    fontSize: 10,
    letterSpacing: 1,
    textTransform: "uppercase",
    textAlign: "right",
  },
  subtotalRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 4,
    marginTop: 2,
    borderTopWidth: 1,
  },
  subtotalLabel: { flex: 3, fontFamily: typography.label, fontSize: 13 },
  subtotalValue: { flex: 1.5, fontFamily: typography.label, fontSize: 13, textAlign: "right" },
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
  totalValue: { flex: 1.5, fontFamily: typography.heading, fontSize: 14, textAlign: "right" },
});
