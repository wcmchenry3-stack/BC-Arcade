/**
 * What a foundation shows under its top card while that card is in flight (Solitaire #3572,
 * FreeCell #3573): the highest card of the pile that is not itself in flight, or the empty
 * slot, so Auto-Complete's back-to-back cards of one suit never show a card twice.
 *
 * The pile's own top card keeps its view (label, testID, touch target), transparent inside its
 * gesture view (`FoundationPile`'s `topHidden`); this is drawn beneath it, decorative only.
 */
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import type { StyleProp, TextStyle } from "react-native";

import PlayingCard from "../shared/PlayingCard";
import { useTheme } from "../../theme/ThemeContext";
import { TABLE_SLOT_EDGE, TABLE_SLOT_FILL } from "../../theme/theme.table";
import { useCardSize } from "../../game/_shared/CardSizeContext";
import { suitEmoji } from "../../game/_shared/decks/cardId";
import type { PlayingCard as Card, Suit } from "../../game/_shared/cards/types";
import { useFlightSelector } from "./cardFlights";
import { cardKey } from "./cardMotion";

/** No card in flight. */
const NOT_FLYING = -2;

/**
 * Whether `pile`'s top card is in flight and, if so, the index of the card drawn under it
 * (-1: the empty slot). Outside a board with motion the top never flies.
 */
export function useFoundationUnder(pile: readonly Card[]): {
  readonly topHidden: boolean;
  readonly under: number;
} {
  const keys = pile.map(cardKey).join("|");
  const under = useFlightSelector((s) => {
    const list = keys === "" ? [] : keys.split("|");
    const top = list[list.length - 1];
    if (top === undefined || !s.isFlying(top)) return NOT_FLYING;
    for (let i = list.length - 2; i >= 0; i--) if (!s.isFlying(list[i]!)) return i;
    return -1;
  }, NOT_FLYING);
  return { topHidden: under !== NOT_FLYING, under };
}

/** The pile's look under its flying top card: the card under it, or the empty slot's glyph. */
export function FoundationUnderTop({
  card,
  suit,
  radius,
  glyphStyle,
}: {
  readonly card: Card | undefined;
  readonly suit: Suit;
  /** The empty slot's corner radius (the game's own). */
  readonly radius: number;
  /** The empty slot's suit glyph (its size). */
  readonly glyphStyle: StyleProp<TextStyle>;
}) {
  const { colors } = useTheme();
  const { cardWidth, cardHeight } = useCardSize();
  return (
    <View
      style={styles.under}
      pointerEvents="none"
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      aria-hidden
    >
      {card !== undefined ? (
        <PlayingCard suit={card.suit} rank={card.rank} width={cardWidth} height={cardHeight} />
      ) : (
        <View
          style={[
            styles.emptySlot,
            { width: cardWidth, height: cardHeight, borderRadius: radius },
          ]}
        >
          <Text style={[glyphStyle, { color: colors.textMuted }]}>{suitEmoji(suit)}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  under: {
    position: "absolute",
    top: 0,
    left: 0,
  },
  emptySlot: {
    borderWidth: 1,
    borderColor: TABLE_SLOT_EDGE,
    backgroundColor: TABLE_SLOT_FILL,
    alignItems: "center",
    justifyContent: "center",
  },
});
