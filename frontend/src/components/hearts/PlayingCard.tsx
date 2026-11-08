import React from "react";
import { useTranslation } from "react-i18next";
import SharedPlayingCard from "../shared/PlayingCard";
import { rankLabel } from "../../game/_shared/decks/cardId";
import type { CanonicalSuit } from "../../game/_shared/decks/types";
import type { Card } from "../../game/hearts/types";

interface Props {
  card: Card;
  faceDown?: boolean;
  highlighted?: boolean;
  disabled?: boolean;
  onPress?: () => void;
  testID?: string;
  /** Size and tilt on the card table (#3587); the natural size and no tilt when omitted. */
  width?: number;
  height?: number;
  rotation?: number;
}

export default function PlayingCard({
  card,
  faceDown = false,
  highlighted = false,
  disabled = false,
  onPress,
  testID,
  width,
  height,
  rotation,
}: Props) {
  const { t } = useTranslation("hearts");
  const rl = rankLabel(card.rank);
  const suitName = t(`card.suit.${card.suit}`);
  const label = faceDown
    ? t("card.faceDown")
    : highlighted
      ? t("card.highlighted", { rank: rl, suit: suitName })
      : t("card.label", { rank: rl, suit: suitName });

  return (
    <SharedPlayingCard
      suit={card.suit as CanonicalSuit}
      rank={card.rank}
      faceDown={faceDown}
      highlighted={highlighted}
      disabled={disabled}
      onPress={onPress}
      accessibilityLabel={label}
      testID={testID}
      width={width}
      height={height}
      rotation={rotation}
    />
  );
}
