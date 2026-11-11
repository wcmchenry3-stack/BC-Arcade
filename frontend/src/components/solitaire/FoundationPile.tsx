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
 * Auto-Complete's back-to-back cards of one suit never show a card twice (`FoundationUnderTop`).
 */

import React from "react";
import { StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";
import type { SharedValue } from "react-native-reanimated";

import SharedFoundationPile from "../cards/FoundationPile";
import { FoundationUnderTop, useFoundationUnder } from "../cards/FoundationUnderTop";
import type { Colors } from "../../theme/ThemeContext";
import type { DropHandler } from "../../game/_shared/drag/DragContext";
import type { Card, Suit } from "../../game/solitaire/types";

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

export default function FoundationPile(props: FoundationPileProps) {
  const { t } = useTranslation("solitaire");
  const { pile } = props;
  // The index of the card drawn under the top one in flight (-1: the empty slot).
  const { topHidden, under } = useFoundationUnder(pile);
  return (
    <View>
      {topHidden ? (
        <FoundationUnderTop
          card={under >= 0 ? pile[under] : undefined}
          suit={props.suit}
          radius={8}
          glyphStyle={styles.suit}
        />
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

const styles = StyleSheet.create({
  suit: {
    fontSize: 32,
    lineHeight: 36,
  },
});
