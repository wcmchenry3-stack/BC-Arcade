import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "../../theme/ThemeContext";
import type { SessionStats } from "../../game/blackjack/sessionStats";
import { formatPL, plColor, winRatePct } from "./blackjackStatsModel";

interface Props {
  readonly stats: SessionStats;
}

export default function BlackjackScorecard({ stats }: Props) {
  const { t } = useTranslation(["blackjack", "common"]);
  const { colors } = useTheme();

  const plDisplay = formatPL(stats.plChips);
  const plTextColor = plColor(stats.plChips, colors);
  const wrPct = winRatePct(stats);
  const subLine =
    stats.handsPlayed === 0
      ? t("blackjack:score.subLineEmpty")
      : t("blackjack:score.subLine", { handsPlayed: stats.handsPlayed, winRate: wrPct ?? 0 });

  const cards: ReadonlyArray<{ key: string; label: string; value: string; accent?: boolean }> = [
    {
      key: "chipBalance",
      label: t("blackjack:score.chipBalance"),
      value: stats.chips.toLocaleString("en-US"),
      accent: true,
    },
    {
      key: "biggestWin",
      label: t("blackjack:score.biggestWin"),
      value: stats.biggestWin > 0 ? `+${stats.biggestWin.toLocaleString("en-US")}` : "—",
    },
    {
      key: "handsWon",
      label: t("blackjack:score.handsWon"),
      value: String(stats.handsWon),
    },
    {
      key: "handsLost",
      label: t("blackjack:score.handsLost"),
      value: String(stats.handsLost),
    },
    {
      key: "blackjacks",
      label: t("blackjack:score.blackjacks"),
      value: String(stats.blackjacks),
    },
    {
      key: "busts",
      label: t("blackjack:score.busts"),
      value: String(stats.busts),
    },
  ];

  return (
    <View style={styles.container}>
      <View style={styles.hero}>
        <Text style={[styles.heroLabel, { color: colors.textMuted }]}>
          {t("blackjack:score.heroLabel")}
        </Text>
        <Text style={[styles.heroValue, { color: plTextColor }]}>
          {t("blackjack:score.plLine", { amount: plDisplay })}
        </Text>
        <Text style={[styles.heroSub, { color: colors.textMuted }]}>{subLine}</Text>
      </View>

      <View style={styles.grid}>
        {cards.map((card) => (
          <View
            key={card.key}
            style={[
              styles.card,
              {
                borderColor: card.accent ? colors.accent : colors.border,
                backgroundColor: card.accent ? colors.surfaceAlt : "transparent",
              },
            ]}
            accessibilityLabel={`${card.label}: ${card.value}`}
            accessibilityRole="none"
          >
            <Text style={[styles.cardValue, { color: colors.text }]}>{card.value}</Text>
            <Text style={[styles.cardLabel, { color: colors.textMuted }]}>{card.label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: "100%",
    gap: 16,
  },
  hero: {
    alignItems: "center",
    gap: 4,
  },
  heroLabel: {
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  heroValue: {
    fontSize: 30,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
  heroSub: {
    fontSize: 13,
    fontWeight: "500",
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  card: {
    flexBasis: "31%",
    flexGrow: 1,
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 8,
    alignItems: "center",
    gap: 4,
    minWidth: 90,
  },
  cardValue: {
    fontSize: 24,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
  cardLabel: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.4,
    textTransform: "uppercase",
    textAlign: "center",
  },
});
