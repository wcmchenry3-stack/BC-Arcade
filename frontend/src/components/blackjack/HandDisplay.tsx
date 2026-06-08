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
  /** Shrink cards for constrained layouts — used by split-hand side-by-side
   *  rendering and by the whole table on short-height viewports. Shrinks
   *  both the "player" and "dealer" variants when set. */
  compact?: boolean;
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
  compact = false,
  maxPerRow = 5,
}: Props) {
  const { colors } = useTheme();
  const showScore = hand.cards.length > 0;

  const rows: (typeof hand.cards)[] = [];
  for (let i = 0; i < hand.cards.length; i += maxPerRow) {
    rows.push(hand.cards.slice(i, i + maxPerRow));
  }

  return (
    <View style={[styles.container, compact && styles.containerCompact]}>
      {hand.cards.length > 0 && (
        <Text style={[styles.label, compact && styles.labelCompact, { color: colors.textMuted }]}>
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
                  variant={variant}
                  compact={compact}
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
    gap: 8,
  },
  containerCompact: {
    gap: 2,
  },
  label: {
    fontSize: 13,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  labelCompact: {
    fontSize: 11,
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
