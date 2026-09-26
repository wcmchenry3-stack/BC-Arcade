import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { useTheme } from "../../theme/ThemeContext";
import { HandResponse } from "../../game/blackjack/types";
import PlayingCard from "./PlayingCard";
import ScorePill from "./ScorePill";

interface Props {
  hand: HandResponse;
  label: string;
  concealed?: boolean;
  /** "player" renders larger cards with fan rotation and neon score pill;
   *  "dealer" renders compact cards and glass badge score. */
  variant?: "player" | "dealer";
  cardWidth: number;
  cardHeight: number;
  gap?: number;
  labelFontSize?: number;
  /**
   * Maximum cards per row. Additional cards wrap to a new row so the hand
   * grows downward into reserved table space rather than overflowing into
   * the action bar. Defaults to 5 (single-hand). Split hands pass 3.
   */
  maxPerRow?: number;
}

// First two player cards get a gentle fan tilt
const PLAYER_ROTATIONS: Record<number, number> = { 0: -3, 1: 2 };

export default function HandDisplay({
  hand,
  label,
  concealed = false,
  variant = "dealer",
  cardWidth,
  cardHeight,
  gap = 8,
  labelFontSize = 13,
  maxPerRow = 5,
}: Props) {
  const { colors } = useTheme();
  const showScore = hand.cards.length > 0;

  const rows: (typeof hand.cards)[] = [];
  for (let i = 0; i < hand.cards.length; i += maxPerRow) {
    rows.push(hand.cards.slice(i, i + maxPerRow));
  }

  return (
    <View style={[styles.container, { gap }]}>
      {hand.cards.length > 0 && (
        <Text style={[styles.label, { color: colors.textMuted, fontSize: labelFontSize }]}>
          {label}
        </Text>
      )}

      {showScore && variant === "player" && (
        <ScorePill value={hand.value} soft={hand.soft} concealed={concealed} variant={variant} />
      )}

      <View style={styles.rows}>
        {rows.map((rowCards, rowIndex) => (
          <View key={rowIndex} style={styles.row}>
            {rowCards.map((card, cardIndex) => {
              const absoluteIndex = rowIndex * maxPerRow + cardIndex;
              return (
                <PlayingCard
                  key={absoluteIndex}
                  card={card}
                  width={cardWidth}
                  height={cardHeight}
                  rotation={variant === "player" ? (PLAYER_ROTATIONS[absoluteIndex] ?? 0) : 0}
                />
              );
            })}
          </View>
        ))}
      </View>

      {showScore && variant !== "player" && (
        <ScorePill value={hand.value} soft={hand.soft} concealed={concealed} variant={variant} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
  },
  label: {
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  rows: {
    alignItems: "center",
    gap: 4,
  },
  row: {
    flexDirection: "row",
    justifyContent: "center",
  },
});
