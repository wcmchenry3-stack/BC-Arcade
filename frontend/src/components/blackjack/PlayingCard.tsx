import React from "react";
import { useTranslation } from "react-i18next";
import SharedPlayingCard from "../shared/PlayingCard";
import { rankLabel } from "../../game/_shared/decks/cardId";
import type { CanonicalSuit } from "../../game/_shared/decks/types";
import type { CardResponse } from "../../game/blackjack/types";

interface Props {
  card: CardResponse;
  rotation?: number;
  width: number;
  height: number;
}

const EMOJI_TO_SUIT: Record<string, CanonicalSuit> = {
  "♠": "spades",
  "♥": "hearts",
  "♦": "diamonds",
  "♣": "clubs",
};

const RANK_STR_TO_NUM: Record<string, number> = { A: 1, J: 11, Q: 12, K: 13 };

export default function PlayingCard({ card, rotation = 0, width, height }: Props) {
  const { t } = useTranslation("blackjack");

  const suit = EMOJI_TO_SUIT[card.suit] ?? "spades";
  const rank = RANK_STR_TO_NUM[card.rank] ?? parseInt(card.rank, 10);
  const suitName = t(`card.suit.${suit}`);
  const label = card.face_down
    ? t("card.faceDown")
    : t("card.accessibilityLabel", { rank: rankLabel(rank), suit: suitName });

  return (
    <SharedPlayingCard
      suit={suit}
      rank={rank}
      faceDown={card.face_down}
      width={width}
      height={height}
      rotation={rotation}
      accessibilityLabel={label}
    />
  );
}
