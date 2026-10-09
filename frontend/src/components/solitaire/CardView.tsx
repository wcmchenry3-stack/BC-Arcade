import React from "react";
import { useTranslation } from "react-i18next";
import SharedPlayingCard from "../shared/PlayingCard";
import { rankLabel } from "../../game/_shared/decks/cardId";
import type { CanonicalSuit } from "../../game/_shared/decks/types";
import { CARD_NATURAL_H, CARD_NATURAL_W, useCardSize } from "../../game/_shared/CardSizeContext";
import type { Card } from "../../game/solitaire/types";

export interface CardViewProps {
  readonly card: Card;
  readonly selected?: boolean;
  readonly onPress?: () => void;
}

export default function CardView({ card, selected = false, onPress }: CardViewProps) {
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
    />
  );
}

export const CARD_WIDTH = CARD_NATURAL_W;
export const CARD_HEIGHT = CARD_NATURAL_H;
