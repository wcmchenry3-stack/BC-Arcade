import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useTranslation } from "react-i18next";
import { useTheme } from "../../theme/ThemeContext";
import { sortHand } from "./cardSort";
import type { Card } from "../../game/hearts/types";

const SUIT_SYMBOL: Record<Card["suit"], string> = {
  clubs: "♣",
  diamonds: "♦",
  hearts: "♥",
  spades: "♠",
};

const RANK_TEXT: Record<number, string> = {
  1: "A",
  11: "J",
  12: "Q",
  13: "K",
};

function rankText(rank: number): string {
  return RANK_TEXT[rank] ?? String(rank);
}

function isRedSuit(suit: Card["suit"]): boolean {
  return suit === "hearts" || suit === "diamonds";
}

/**
 * Hearts penalty points: each heart is +1; Q♠ is +13.
 * Exported for tests and reuse.
 */
export function penaltyPoints(cards: readonly Card[]): number {
  return cards.reduce((sum, c) => {
    if (c.suit === "hearts") return sum + 1;
    if (c.suit === "spades" && c.rank === 12) return sum + 13;
    return sum;
  }, 0);
}

function scoringCards(cards: readonly Card[]): Card[] {
  return cards.filter((c) => c.suit === "hearts" || (c.suit === "spades" && c.rank === 12));
}

const OPP_CARD_W = 24;
const OPP_CARD_H = 28;
const OPP_OFFSET = 8;
const OPP_MAX_VISIBLE = 5;

const SELF_CARD_W = 28;
const SELF_CARD_H = 40;
const SELF_OFFSET = 18;

// Append alpha to a 6-digit hex color.
function alpha40(hex: string): string {
  return hex.length === 7 ? `${hex}66` : hex; // ~40% opacity
}
function alpha13(hex: string): string {
  return hex.length === 7 ? `${hex}22` : hex; // ~13% opacity
}

interface OpponentProps {
  cards: readonly Card[];
  seatLabel: string;
}

export function OpponentCapturedPile({ cards, seatLabel }: OpponentProps) {
  const { t } = useTranslation("hearts");
  const { colors } = useTheme();
  const count = cards.length;
  const points = penaltyPoints(cards);
  const scoredCount = scoringCards(cards).length;
  const visible = Math.min(scoredCount, OPP_MAX_VISIBLE);
  const fanWidth = visible > 0 ? (visible - 1) * OPP_OFFSET + OPP_CARD_W : 0;

  return (
    <View
      style={styles.oppContainer}
      accessibilityLabel={t("captured.opponentLabel", { label: seatLabel, count, points })}
      accessibilityRole="img"
    >
      <View style={[styles.oppFan, { width: fanWidth, height: OPP_CARD_H }]}>
        {Array.from({ length: visible }).map((_, i) => (
          <LinearGradient
            key={i}
            colors={[alpha40(colors.accent), alpha40(colors.secondary)]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[
              styles.oppCard,
              {
                left: i * OPP_OFFSET,
                borderColor: colors.border,
              },
            ]}
          />
        ))}
      </View>
      {points > 0 && (
        <Text
          style={[styles.oppBadge, { color: colors.error, backgroundColor: alpha13(colors.error) }]}
        >
          {`${scoredCount} · +${points}`}
        </Text>
      )}
    </View>
  );
}

interface SelfProps {
  cards: readonly Card[];
}

export function SelfCapturedPile({ cards }: SelfProps) {
  const { t } = useTranslation("hearts");
  const { colors } = useTheme();
  const sorted = sortHand(scoringCards(cards));
  const count = sorted.length;
  const points = penaltyPoints(cards);
  const rowWidth = count > 0 ? (count - 1) * SELF_OFFSET + SELF_CARD_W : 0;

  return (
    <View
      style={[styles.selfRow, { borderColor: colors.border }]}
      accessibilityLabel={t("captured.selfLabel", { count, points })}
      accessibilityRole="img"
    >
      <Text style={[styles.selfLabel, { color: colors.textMuted }]}>{t("captured.taken")}</Text>
      <View style={styles.selfCards}>
        {count === 0 ? (
          <Text style={[styles.selfEmpty, { color: colors.textMuted }]}>{t("captured.empty")}</Text>
        ) : (
          <View style={{ width: rowWidth, height: SELF_CARD_H }}>
            {sorted.map((card, i) => (
              <View
                key={`${card.suit}-${card.rank}-${i}`}
                style={[
                  styles.selfCard,
                  {
                    left: i * SELF_OFFSET,
                    backgroundColor: "#fff",
                    borderColor: colors.border,
                  },
                ]}
              >
                <Text
                  testID="card-rank"
                  style={[
                    styles.selfRank,
                    { color: isRedSuit(card.suit) ? colors.error : "#0e0e13" },
                  ]}
                >
                  {rankText(card.rank)}
                </Text>
                <Text
                  style={[
                    styles.selfSuit,
                    { color: isRedSuit(card.suit) ? colors.error : "#0e0e13" },
                  ]}
                >
                  {SUIT_SYMBOL[card.suit]}
                </Text>
              </View>
            ))}
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // ── Opponent ───────────────────────────────────────────────────────────────
  oppContainer: {
    alignItems: "center",
    gap: 4,
  },
  oppBadge: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
  },
  oppFan: {
    position: "relative",
  },
  oppCard: {
    position: "absolute",
    top: 0,
    width: OPP_CARD_W,
    height: OPP_CARD_H,
    borderRadius: 4,
    borderWidth: 1,
  },
  // ── Self ───────────────────────────────────────────────────────────────────
  selfRow: {
    flexDirection: "row",
    alignItems: "center",
    height: 64,
    paddingVertical: 8,
    paddingHorizontal: 14,
    gap: 10,
  },
  selfLabel: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  selfCards: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
  },
  selfEmpty: {
    fontSize: 12,
    fontStyle: "italic",
  },
  selfCard: {
    position: "absolute",
    top: 0,
    width: SELF_CARD_W,
    height: SELF_CARD_H,
    borderRadius: 4,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  selfRank: {
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 14,
  },
  selfSuit: {
    fontSize: 12,
    lineHeight: 14,
  },
});
