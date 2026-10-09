/**
 * TableauPile (#595) — one column of a 7-column Klondike tableau.
 *
 * Stateless. Vertically offsets cards so all are visible; empty columns
 * render a dashed placeholder. Bubbles taps up as `(colIndex, cardIndex)`
 * so the parent screen can run its tap-to-select state machine. The column
 * itself is the shared `components/cards/TableauColumn` (#2983).
 */

import React from "react";
import { useTranslation } from "react-i18next";
import type { SharedValue } from "react-native-reanimated";

import SharedTableauColumn from "../cards/TableauColumn";
import type { Card } from "../../game/solitaire/types";
import CardView, { CARD_WIDTH } from "./CardView";
import { useCardSize } from "../../game/_shared/CardSizeContext";
import { rankLabel } from "../../game/_shared/decks/cardId";
import SelectableCard from "../../game/_shared/SelectableCard";
import type { DropHandler } from "../../game/_shared/drag/DragContext";

const FACE_UP_OFFSET = 28;
const FACE_DOWN_OFFSET = 20;
/**
 * Floor for the visible stripe of a covered face-up card (#2220): enough to
 * read its rank and suit and to hit it (WCAG 2.5.8's 24 px), however small
 * the cards scale on a narrow phone.
 */
export const MIN_FACE_UP_STRIPE = 24;

/** Face-up / face-down stacking offsets for a card width (#2220). */
export function computeTableauOffsets(cardWidth: number): {
  faceUpOffset: number;
  faceDownOffset: number;
} {
  const scale = cardWidth / CARD_WIDTH;
  return {
    faceUpOffset: Math.max(MIN_FACE_UP_STRIPE, Math.round(FACE_UP_OFFSET * scale)),
    faceDownOffset: Math.round(FACE_DOWN_OFFSET * scale),
  };
}

export interface TableauPileProps {
  readonly pile: readonly Card[];
  readonly colIndex: number;
  readonly selectedIndex?: number;
  readonly hintIndex?: number;
  readonly hintDestination?: boolean;
  readonly shakeX?: SharedValue<number>;
  readonly onCardPress?: (colIndex: number, cardIndex: number) => void;
  readonly onEmptyPress?: (colIndex: number) => void;
  /** Unique drop-zone ID, e.g. "solitaire-tableau-0". Required for DnD. */
  readonly dropId?: string;
  readonly onDrop?: DropHandler;
}

export default function TableauPile({
  pile,
  colIndex,
  selectedIndex,
  hintIndex,
  hintDestination,
  shakeX,
  onCardPress,
  onEmptyPress,
  dropId,
  onDrop,
}: TableauPileProps) {
  const { t } = useTranslation("solitaire");
  const { cardWidth, cardHeight } = useCardSize();
  const { faceUpOffset, faceDownOffset } = computeTableauOffsets(cardWidth);

  // Selected cards lift and carry a label; the rest are plain CardViews.
  const renderCard = (card: Card, cardIndex: number) => {
    const isSelected = selectedIndex !== undefined && cardIndex >= selectedIndex;
    if (!isSelected) return <CardView card={card} />;
    const selectedLabel = card.faceUp
      ? t("card.faceUpSelected", {
          rank: rankLabel(card.rank),
          suit: t(`suit.${card.suit}` as const),
        })
      : t("card.faceDownSelected");
    return (
      <SelectableCard
        suit={card.suit}
        rank={card.rank}
        faceDown={!card.faceUp}
        width={cardWidth}
        height={cardHeight}
        selected
        shakeX={shakeX}
        accessibilityLabel={selectedLabel}
      />
    );
  };

  return (
    <SharedTableauColumn
      game="solitaire"
      ns="solitaire"
      emptyRadius={8}
      hintBorderWidth={3}
      faceUpOffset={faceUpOffset}
      faceDownOffset={faceDownOffset}
      cardTestID={(cardIndex) =>
        cardIndex === hintIndex
          ? "solitaire-hint-source"
          : `solitaire-tableau-${colIndex}-card-${cardIndex}`
      }
      renderCard={renderCard}
      hintFrameIndex={hintIndex}
      pile={pile}
      colIndex={colIndex}
      hintDestination={hintDestination}
      onCardPress={onCardPress}
      onEmptyPress={onEmptyPress}
      dropId={dropId}
      onDrop={onDrop}
    />
  );
}
