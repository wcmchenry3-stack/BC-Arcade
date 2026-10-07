import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { useTheme } from "../../theme/ThemeContext";
import { HandResponse } from "../../game/blackjack/types";
import { calculateCardOverlap } from "../../game/blackjack/layout";
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
  scorePillFontSize?: number;
  /**
   * Width available to the row of cards. A hand always stays on one row;
   * once the cards no longer fit side by side they overlap (negative margin)
   * so every card, including the latest draw, stays visible.
   */
  rowWidth: number;
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
  scorePillFontSize,
  rowWidth,
}: Props) {
  const { colors } = useTheme();
  const showScore = hand.cards.length > 0;

  const overlap = calculateCardOverlap(hand.cards.length, cardWidth, rowWidth);

  return (
    <View style={[styles.container, { gap }]}>
      {hand.cards.length > 0 && (
        <Text style={[styles.label, { color: colors.textMuted, fontSize: labelFontSize }]}>
          {label}
        </Text>
      )}

      {showScore && variant === "player" && (
        <ScorePill
          value={hand.value}
          soft={hand.soft}
          concealed={concealed}
          variant={variant}
          fontSize={scorePillFontSize}
        />
      )}

      <View style={[styles.row, { maxWidth: rowWidth }]} testID="hand-row">
        {hand.cards.map((card, index) => (
          <View key={index} style={index > 0 ? { marginLeft: overlap } : undefined}>
            <PlayingCard
              card={card}
              width={cardWidth}
              height={cardHeight}
              rotation={variant === "player" ? (PLAYER_ROTATIONS[index] ?? 0) : 0}
            />
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
  row: {
    flexDirection: "row",
    justifyContent: "center",
  },
});
