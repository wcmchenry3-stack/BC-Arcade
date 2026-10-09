import React from "react";
import { StyleSheet } from "react-native";
import type { SharedValue } from "react-native-reanimated";

import SharedFoundationPile from "../cards/FoundationPile";
import { RED_SUITS } from "../../game/_shared/decks/cardId";
import type { Colors } from "../../theme/ThemeContext";
import type { CanonicalSuit } from "../../game/_shared/decks/types";
import type { DropHandler } from "../../game/_shared/drag/DragContext";
import type { Card, Suit } from "../../game/freecell/types";

export interface FoundationPileProps {
  readonly pile: readonly Card[];
  readonly suit: Suit;
  readonly selected?: boolean;
  readonly shakeX?: SharedValue<number>;
  readonly hintDestination?: boolean;
  readonly onPress?: (suit: Suit) => void;
  readonly dropId?: string;
  readonly onDrop?: DropHandler;
}

const CARD_LABEL_KEYS = { normal: "card.label", selected: "card.selected" } as const;

const glyphColor = (suit: CanonicalSuit, colors: Colors) =>
  RED_SUITS.has(suit) ? colors.cardRedSuit : colors.textFilled;

/** FreeCell's foundation: the shared pile (#2983) with FreeCell's look and ids. */
export default function FoundationPile(props: FoundationPileProps) {
  return (
    <SharedFoundationPile
      {...props}
      game="freecell"
      ns="freecell"
      testIdPrefix="freecell"
      cardLabelKeys={CARD_LABEL_KEYS}
      emptyRadius={6}
      hintBorderWidth={2}
      topCardHint="card"
      suitGlyphStyle={styles.suit}
      suitGlyphColor={glyphColor}
    />
  );
}

const styles = StyleSheet.create({
  suit: {
    fontSize: 18,
    lineHeight: 22,
    opacity: 0.75,
  },
});
