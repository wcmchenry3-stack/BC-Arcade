import React from "react";
import { StyleSheet, Text } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "../../theme/ThemeContext";
import { formatNumber } from "../../api/statsDisplay";
import { DetailCard, TableRow } from "./DetailCard";
import {
  YACHT_CATEGORY_LABEL,
  YACHT_LOWER,
  YACHT_UPPER,
  type YachtBreakdown,
  type YachtCard,
  type YachtCategory,
} from "./breakdowns";

const UNFILLED = "—";

/**
 * The saved Yacht scorecard (#2839): upper and lower sections, bonuses and
 * total, with the computer's card beside it in a vs game. A category a
 * partial (abandoned) card never filled shows a dash, not 0.
 */
export function YachtSection({ breakdown }: { breakdown: YachtBreakdown }) {
  const { t } = useTranslation(["profile", "yacht"]);
  const { colors } = useTheme();
  const cards: YachtCard[] = breakdown.opponent
    ? [breakdown.player, breakdown.opponent]
    : [breakdown.player];
  const names = breakdown.opponent
    ? [t("yacht:score.you"), t("yacht:vsMode.cpu")]
    : [t("yacht:score.you")];

  const row = (
    label: string,
    values: readonly (number | null)[],
    kind: "body" | "sub" | "total" = "body",
    testID?: string,
    isLast?: boolean
  ) => (
    <TableRow
      key={testID ?? label}
      kind={kind}
      testID={testID}
      isLast={isLast}
      a11yLabel={[
        label,
        ...values.map((v, i) =>
          t("profile:detail.cellA11y", {
            label: names[i],
            value: v == null ? t("yacht:score.notAvailable") : formatNumber(t, v),
          })
        ),
      ].join(", ")}
      cells={[label, ...values.map((v) => (v == null ? UNFILLED : formatNumber(t, v)))]}
    />
  );
  const categoryRow = (key: YachtCategory) =>
    row(
      t(YACHT_CATEGORY_LABEL[key]),
      cards.map((c) => c.categories[key] ?? null),
      "body",
      `yacht-cat-${key}`
    );
  const sectionHeader = (label: string) => (
    <Text key={label} style={[styles.section, { color: colors.accent }]} accessibilityRole="header">
      {label}
    </Text>
  );

  const partial = cards.some((c) => !c.complete);
  const notes = [
    // Per card: only the one that doesn't add up gets the note.
    breakdown.playerReconciled
      ? null
      : t(
          breakdown.opponent
            ? "profile:detail.yacht.playerUnreconciled"
            : "profile:detail.unreconciled"
        ),
    breakdown.opponentReconciled ? null : t("profile:detail.yacht.opponentUnreconciled"),
    partial ? t("profile:detail.yacht.partial") : null,
  ].filter(Boolean);

  return (
    <DetailCard
      title={t("profile:detail.yacht.title")}
      note={notes.join(" ")}
      testID="detail-yacht"
    >
      <TableRow
        kind="head"
        cells={[t("yacht:vsMode.category"), ...names]}
        a11yLabel={[t("yacht:vsMode.category"), ...names].join(", ")}
      />
      {sectionHeader(t("yacht:section.upper"))}
      {YACHT_UPPER.map(categoryRow)}
      {row(
        t("yacht:vsMode.upperSubtotal"),
        cards.map((c) => c.upperSubtotal),
        "sub",
        "yacht-upper-subtotal"
      )}
      {row(
        t("yacht:score.bonusLabel"),
        cards.map((c) => c.upperBonus),
        "sub",
        "yacht-upper-bonus"
      )}
      {sectionHeader(t("yacht:section.lower"))}
      {YACHT_LOWER.map(categoryRow)}
      {row(
        t("yacht:vsMode.lowerSubtotal"),
        cards.map((c) => c.lowerSubtotal),
        "sub",
        "yacht-lower-subtotal"
      )}
      {row(
        t("yacht:bonus.yachtLabel"),
        cards.map((c) => c.yachtBonusTotal),
        "sub",
        "yacht-yacht-bonus"
      )}
      {row(
        t("yacht:score.total"),
        cards.map((c) => c.total),
        "total",
        "yacht-total",
        true
      )}
    </DetailCard>
  );
}

const styles = StyleSheet.create({
  section: {
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 1,
    paddingHorizontal: 4,
    paddingTop: 12,
    paddingBottom: 4,
  },
});
