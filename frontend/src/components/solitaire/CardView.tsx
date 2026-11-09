import React from "react";
import { useTranslation } from "react-i18next";
import SharedPlayingCard from "../shared/PlayingCard";
import { rankLabel } from "../../game/_shared/decks/cardId";
import type { CanonicalSuit } from "../../game/_shared/decks/types";
import { CARD_NATURAL_W, useCardSize } from "../../game/_shared/CardSizeContext";
import type { Card } from "../../game/solitaire/types";

export interface CardViewProps {
  readonly card: Card;
  readonly selected?: boolean;
  /** "Can move here" on a legal destination's top card (#3606). */
  readonly accessibilityHint?: string;
  readonly onPress?: () => void;
  /** Compact corner index (#3622): the stripe of a covered card in a compressed column. */
  readonly compactIndex?: number;
}

function CardView({
  card,
  selected = false,
  accessibilityHint,
  onPress,
  compactIndex,
}: CardViewProps) {
  const { t } = useTranslation("solitaire");
  const { cardWidth, cardHeight } = useCardSize();
  const rl = rankLabel(card.rank);
  const suitName = t(`suit.${card.suit}` as const);

  const label = !card.faceUp
    ? selected
      ? t("card.faceDownSelected")
      : t("card.faceDown")
    : selected
      ? t("card.faceUpSelected", { rank: rl, suit: suitName })
      : t("card.faceUp", { rank: rl, suit: suitName });

  return (
    <SharedPlayingCard
      suit={card.suit as CanonicalSuit}
      rank={card.rank}
      width={cardWidth}
      height={cardHeight}
      faceDown={!card.faceUp}
      highlighted={selected}
      onPress={onPress}
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      compactIndex={compactIndex}
    />
  );
}

/** Equal when the card draws the same: a move can hand a column new card
 *  objects for cards that didn't change (#2264). */
function sameCardView(a: CardViewProps, b: CardViewProps): boolean {
  return (
    a.card.suit === b.card.suit &&
    a.card.rank === b.card.rank &&
    a.card.faceUp === b.card.faceUp &&
    (a.selected ?? false) === (b.selected ?? false) &&
    a.accessibilityHint === b.accessibilityHint &&
    a.onPress === b.onPress &&
    a.compactIndex === b.compactIndex
  );
}

/** Memoized (#2264): see `sameCardView`. */
export default React.memo(CardView, sameCardView);

export const CARD_WIDTH = CARD_NATURAL_W;
