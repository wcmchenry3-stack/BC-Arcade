import React from "react";
import { StyleSheet, Text } from "react-native";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { useTheme } from "../../theme/ThemeContext";
import { formatNumber } from "../../api/statsDisplay";
import { DetailCard, TableRow } from "./DetailCard";
import { heartsSeatOrder, type HeartsBreakdown } from "./breakdowns";

const MOON_MARK = "★";
/** The hand-number column is narrow, so the four seat columns get the room. */
const HAND_COLUMN_FLEX = 0.8;

/** "You" for the human seat; the computer seats are numbered, since no names are stored. */
function seatLabels(t: TFunction, b: HeartsBreakdown, order: readonly number[]) {
  return order.map((seat, i) =>
    seat === b.humanSeat
      ? { short: t("hearts:player.you"), full: t("hearts:player.you") }
      : {
          short: t("profile:detail.hearts.opponent", { n: formatNumber(t, i) }),
          full: t("profile:detail.hearts.opponentA11y", { n: formatNumber(t, i) }),
        }
  );
}

/** The hand-by-hand table of a saved Hearts game (#2838): hands × seats, then totals. */
export function HeartsSection({ breakdown }: { breakdown: HeartsBreakdown }) {
  const { t } = useTranslation(["profile", "hearts"]);
  const { colors } = useTheme();
  const order = heartsSeatOrder(breakdown.humanSeat);
  const labels = seatLabels(t, breakdown, order);
  const anyMoon = breakdown.hands.some((h) => h.moonSeat != null);
  const scoresA11y = (values: readonly number[]) =>
    order
      .map((seat, i) =>
        t("profile:detail.cellA11y", {
          label: labels[i]?.full,
          value: formatNumber(t, values[seat] ?? 0),
        })
      )
      .join(", ");

  return (
    <DetailCard
      title={t("profile:detail.hearts.title")}
      note={breakdown.reconciled ? null : t("profile:detail.unreconciled")}
      testID="detail-hearts"
    >
      <TableRow
        kind="head"
        labelFlex={HAND_COLUMN_FLEX}
        cells={[t("profile:detail.hearts.hand"), ...labels.map((l) => l.short)]}
        a11yLabel={[t("profile:detail.hearts.hand"), ...labels.map((l) => l.full)].join(", ")}
      />
      {breakdown.hands.map((hand, h) => {
        const moonLabel =
          hand.moonSeat == null
            ? null
            : t("hearts:events.moonShot", {
                name: labels[order.indexOf(hand.moonSeat)]?.full ?? "",
              });
        return (
          <TableRow
            key={h}
            labelFlex={HAND_COLUMN_FLEX}
            testID={`hearts-hand-${h + 1}`}
            a11yLabel={[
              t("profile:detail.hearts.handA11y", {
                n: formatNumber(t, h + 1),
                scores: scoresA11y(hand.scores),
              }),
              moonLabel,
            ]
              .filter(Boolean)
              .join(" ")}
            cells={[
              formatNumber(t, h + 1),
              ...order.map((seat) =>
                seat === hand.moonSeat ? (
                  <Text
                    key={seat}
                    testID={`hearts-moon-${h + 1}`}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.6}
                    style={[styles.cell, styles.moon, { color: colors.bonus }]}
                  >
                    {`${MOON_MARK} ${formatNumber(t, hand.scores[seat] ?? 0)}`}
                  </Text>
                ) : (
                  formatNumber(t, hand.scores[seat] ?? 0)
                )
              ),
            ]}
          />
        );
      })}
      <TableRow
        kind="total"
        labelFlex={HAND_COLUMN_FLEX}
        isLast
        testID="hearts-totals"
        a11yLabel={t("profile:detail.hearts.totalA11y", { scores: scoresA11y(breakdown.totals) })}
        cells={[
          t("profile:detail.hearts.total"),
          ...order.map((seat) => formatNumber(t, breakdown.totals[seat] ?? 0)),
        ]}
      />
      {anyMoon && (
        <Text style={[styles.legend, { color: colors.textMuted }]}>
          {t("hearts:score.footnote")}
        </Text>
      )}
    </DetailCard>
  );
}

const styles = StyleSheet.create({
  cell: { fontSize: 14, fontVariant: ["tabular-nums"], textAlign: "right" },
  moon: { fontWeight: "700" },
  legend: { fontSize: 13, marginTop: 8, paddingHorizontal: 4 },
});
