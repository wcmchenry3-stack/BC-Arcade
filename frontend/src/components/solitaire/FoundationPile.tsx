/**
 * FoundationPile (#595) — one of four suit-specific foundation slots.
 *
 * Stateless. Shows the top card if the pile is non-empty; otherwise a
 * placeholder with the expected suit symbol in `colors.textMuted` — this
 * is how the player identifies which foundation is for which suit. The pile
 * itself is the shared `components/cards/FoundationPile` (#2983).
 *
 * While the top card is in flight (#3572), the card under it stays drawn beneath it (or the
 * empty slot, for an Ace): the highest card of the pile that is not itself in flight, so
 * Auto-Complete's back-to-back cards of one suit never show a card twice.
 */

import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import type { SharedValue } from "react-native-reanimated";

import SharedFoundationPile from "../cards/FoundationPile";
import PlayingCard from "../shared/PlayingCard";
import { useTheme, type Colors } from "../../theme/ThemeContext";
import { TABLE_SLOT_EDGE, TABLE_SLOT_FILL } from "../../theme/theme.table";
import { useCardSize } from "../../game/_shared/CardSizeContext";
import { suitEmoji } from "../../game/_shared/decks/cardId";
import type { DropHandler } from "../../game/_shared/drag/DragContext";
import type { Card, Suit } from "../../game/solitaire/types";
import { useFlightSelector } from "./cardFlights";
import { cardKey } from "./solitaireMotion";

export interface FoundationPileProps {
  readonly pile: readonly Card[];
  readonly suit: Suit;
  readonly selected?: boolean;
  readonly hintDestination?: boolean;
  readonly hintSource?: boolean;
  /** The selected card can move here (#3606). */
  readonly legalTarget?: boolean;
  /** Reduce Motion (#3606), read once by the board. */
  readonly reduceMotion?: boolean;
  readonly shakeX?: SharedValue<number>;
  readonly onPress?: (suit: Suit) => void;
  /** Unique drop-zone ID, e.g. "solitaire-foundation-spades". */
  readonly dropId?: string;
  readonly onDrop?: DropHandler;
  /** The game is over (Solitaire's win, #3572): no card can be dragged. Taps still reach the board. */
  readonly locked?: boolean;
}

const CARD_LABEL_KEYS = { normal: "card.faceUp", selected: "card.faceUpSelected" } as const;

const glyphColor = (_suit: Suit, colors: Colors) => colors.textMuted;

/** No card in flight. */
const NOT_FLYING = -2;

export default function FoundationPile(props: FoundationPileProps) {
  const { t } = useTranslation("solitaire");
  const { pile } = props;
  const keys = pile.map(cardKey).join("|");
  // NOT_FLYING, or the index of the card drawn under the top one in flight (-1: the empty slot).
  const under = useFlightSelector((s) => {
    const list = keys === "" ? [] : keys.split("|");
    const top = list[list.length - 1];
    if (top === undefined || !s.isFlying(top)) return NOT_FLYING;
    for (let i = list.length - 2; i >= 0; i--) if (!s.isFlying(list[i]!)) return i;
    return -1;
  }, NOT_FLYING);
  const topHidden = under !== NOT_FLYING;
  return (
    <View>
      {topHidden ? (
        <UnderTop card={under >= 0 ? pile[under] : undefined} suit={props.suit} />
      ) : null}
      <SharedFoundationPile
        {...props}
        topHidden={topHidden}
        onFelt
        canMoveHereHint={t("pile.canMoveHere")}
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
    </View>
  );
}

/** What the pile shows under its top card while that card is in flight: decorative only. */
function UnderTop({ card, suit }: { readonly card: Card | undefined; readonly suit: Suit }) {
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
        <View style={[styles.emptySlot, { width: cardWidth, height: cardHeight }]}>
          <Text style={[styles.suit, { color: glyphColor(suit, colors) }]}>{suitEmoji(suit)}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  suit: {
    fontSize: 32,
    lineHeight: 36,
  },
  under: {
    position: "absolute",
    top: 0,
    left: 0,
  },
  emptySlot: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: TABLE_SLOT_EDGE,
    backgroundColor: TABLE_SLOT_FILL,
    alignItems: "center",
    justifyContent: "center",
  },
});
