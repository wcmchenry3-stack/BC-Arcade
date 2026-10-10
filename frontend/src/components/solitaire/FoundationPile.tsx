/**
 * FoundationPile (#595) — one of four suit-specific foundation slots.
 *
 * Stateless. Shows the top card if the pile is non-empty; otherwise a
 * placeholder with the expected suit symbol in `colors.textMuted` — this
 * is how the player identifies which foundation is for which suit. The pile
 * itself is the shared `components/cards/FoundationPile` (#2983).
 */

import React from "react";
import { StyleSheet } from "react-native";
import type { SharedValue } from "react-native-reanimated";

import SharedFoundationPile from "../cards/FoundationPile";
import type { Colors } from "../../theme/ThemeContext";
import type { DropHandler } from "../../game/_shared/drag/DragContext";
import type { Card, Suit } from "../../game/solitaire/types";

export interface FoundationPileProps {
  readonly pile: readonly Card[];
  readonly suit: Suit;
  readonly selected?: boolean;
  readonly hintDestination?: boolean;
  readonly hintSource?: boolean;
  readonly shakeX?: SharedValue<number>;
  readonly onPress?: (suit: Suit) => void;
  /** Unique drop-zone ID, e.g. "solitaire-foundation-spades". */
  readonly dropId?: string;
  readonly onDrop?: DropHandler;
}

const CARD_LABEL_KEYS = { normal: "card.faceUp", selected: "card.faceUpSelected" } as const;

const glyphColor = (_suit: Suit, colors: Colors) => colors.textMuted;

export default function FoundationPile(props: FoundationPileProps) {
  return (
    <SharedFoundationPile
      {...props}
      game="solitaire"
      ns="solitaire"
      testIdPrefix="solitaire"
      cardLabelKeys={CARD_LABEL_KEYS}
      emptyRadius={8}
      hintBorderWidth={3}
      topCardHint="frame"
      suitGlyphStyle={styles.suit}
      suitGlyphColor={glyphColor}
    />
  );
}

const styles = StyleSheet.create({
  suit: {
    fontSize: 32,
    lineHeight: 36,
  },
});
