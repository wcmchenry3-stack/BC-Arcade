import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "../../theme/ThemeContext";

interface Props {
  outcome: string;
  payout: number;
  compact?: boolean;
  /**
   * "felt" (#3580): one line (outcome and payout) in an outlined pill, for the
   * band on the table between the dealer and the player, with an optional
   * detail line under it ("Dealer busts with 22").
   */
  variant?: "card" | "felt";
  detail?: string | null;
  /** "felt": a split round's summary ("Won: 1 · Lost: 2") in place of the outcome's words. */
  summary?: string | null;
}

/** The outcome's words. On the felt a natural says what it pays: "Blackjack! 3:2" (#3621). */
function outcomeKeyOf(outcome: string, variant: "card" | "felt"): string {
  return variant === "felt" && outcome === "blackjack"
    ? "outcome.blackjackNatural"
    : `outcome.${outcome}`;
}

export default function ResultBanner({
  outcome,
  payout,
  compact = false,
  variant = "card",
  detail,
  summary = null,
}: Props) {
  const { t } = useTranslation("blackjack");
  const { colors } = useTheme();

  const outcomeText = t(outcomeKeyOf(outcome, variant) as Parameters<typeof t>[0]);

  // Per-outcome accent color: blackjack=tertiary lime, win=bonus green,
  // lose=error red, push=textMuted
  let accentColor: string;
  switch (outcome) {
    case "blackjack":
      accentColor = colors.tertiary;
      break;
    case "win":
      accentColor = colors.bonus;
      break;
    case "lose":
      accentColor = colors.error;
      break;
    default: // push
      accentColor = colors.textMuted;
  }

  let payoutText: string;
  let payoutColor: string;
  if (payout > 0) {
    payoutText = t("payout.positive", { amount: payout });
    payoutColor = colors.bonus;
  } else if (payout < 0) {
    payoutText = t("payout.negative", { amount: payout });
    payoutColor = colors.error;
  } else {
    payoutText = t("payout.zero");
    payoutColor = colors.textMuted;
  }

  if (variant === "felt") {
    return (
      <View style={styles.feltWrap} accessibilityLiveRegion="polite">
        <View
          style={[
            styles.feltPill,
            compact && styles.feltPillCompact,
            { backgroundColor: colors.surfaceHigh, borderColor: accentColor },
          ]}
        >
          <Text
            testID="result-outcome"
            style={[
              styles.feltOutcome,
              compact && styles.feltOutcomeCompact,
              { color: accentColor },
            ]}
            numberOfLines={1}
            accessibilityLabel={summary === null ? undefined : `${outcomeText}. ${summary}`}
          >
            {summary ?? outcomeText}
          </Text>
          <Text
            style={[styles.feltPayout, compact && styles.feltPayoutCompact, { color: payoutColor }]}
            accessibilityLabel={t("payout.accessibilityLabel", { amount: payout })}
            numberOfLines={1}
          >
            {payoutText}
          </Text>
        </View>
        {/* compact (split rows / grid): one line; each hand and the dealer show their own totals */}
        {detail && !compact ? (
          <Text
            testID="result-detail"
            style={[styles.feltDetail, { color: colors.textMuted }]}
            numberOfLines={1}
          >
            {detail}
          </Text>
        ) : null}
      </View>
    );
  }

  return (
    <View
      style={[
        styles.container,
        compact && styles.containerCompact,
        {
          backgroundColor: colors.surfaceHigh,
          borderColor: colors.border,
          borderTopColor: accentColor,
        },
      ]}
    >
      <Text
        testID="result-outcome"
        style={[styles.outcome, compact && styles.outcomeCompact, { color: accentColor }]}
      >
        {outcomeText}
      </Text>
      <Text
        style={[styles.payout, compact && styles.payoutCompact, { color: payoutColor }]}
        accessibilityLabel={t("payout.accessibilityLabel", { amount: payout })}
      >
        {payoutText}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: "100%",
    maxWidth: 320,
    alignItems: "center",
    borderRadius: 12,
    borderWidth: 1,
    borderTopWidth: 4,
    paddingVertical: 20,
    paddingHorizontal: 24,
    gap: 6,
  },
  containerCompact: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    gap: 4,
  },
  outcome: {
    fontSize: 26,
    fontWeight: "700",
    textAlign: "center",
    letterSpacing: -0.5,
  },
  outcomeCompact: {
    fontSize: 18,
  },
  payout: {
    fontSize: 18,
    fontWeight: "700",
    textAlign: "center",
  },
  payoutCompact: {
    fontSize: 13,
  },
  feltWrap: {
    alignItems: "center",
    gap: 4,
    maxWidth: "100%",
  },
  feltPill: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 10,
    borderRadius: 14,
    borderWidth: 1,
    paddingVertical: 4,
    paddingHorizontal: 16,
  },
  feltOutcome: {
    fontSize: 19,
    fontWeight: "700",
  },
  feltPayout: {
    fontSize: 14,
    fontWeight: "700",
  },
  feltPillCompact: {
    gap: 8,
    paddingVertical: 3,
    paddingHorizontal: 10,
    maxWidth: "100%",
  },
  feltOutcomeCompact: {
    fontSize: 15,
    flexShrink: 1,
  },
  feltPayoutCompact: {
    fontSize: 12,
    flexShrink: 1,
  },
  feltDetail: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
});
