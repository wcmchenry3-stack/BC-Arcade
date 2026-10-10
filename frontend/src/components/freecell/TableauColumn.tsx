import React from "react";
import { useTranslation } from "react-i18next";
import type { SharedValue } from "react-native-reanimated";

import SharedTableauColumn from "../cards/TableauColumn";
import { rankLabel } from "../../game/_shared/decks/cardId";
import type { Card } from "../../game/freecell/types";
import { CARD_HEIGHT, CARD_WIDTH } from "./FreeCellSlot";
import { useCardSize } from "../../game/_shared/CardSizeContext";
import SelectableCard from "../../game/_shared/SelectableCard";
import type { DropHandler } from "../../game/_shared/drag/DragContext";

/** Natural (unscaled) gap between stacked cards when the column fits. */
export const FACE_UP_OFFSET = 36;
/** Natural floor for a compressed column: still shows rank and suit. */
export const MIN_FACE_UP_OFFSET = 12;
/**
 * Natural tableau height budget: 13 cards at the full offset. Used when the
 * board hasn't measured its real height yet (#1108).
 */
export const TABLEAU_MAX_HEIGHT = 12 * FACE_UP_OFFSET + CARD_HEIGHT;

/**
 * Per-card offset for a column of `pileLength` cards (#1108): the full offset
 * while the column fits in `maxHeight`, compressed evenly once it doesn't, and
 * never below `minOffset`. Defaults are FreeCell's natural sizes; the column
 * passes scaled ones. Pure, so a column that shrinks back regains full spacing.
 */
export function computeCardOffset(
  pileLength: number,
  fullOffset: number = FACE_UP_OFFSET,
  cardHeight: number = CARD_HEIGHT,
  maxHeight: number = TABLEAU_MAX_HEIGHT,
  minOffset: number = MIN_FACE_UP_OFFSET
): number {
  if (pileLength <= 1) return fullOffset;
  const fit = (maxHeight - cardHeight) / (pileLength - 1);
  return Math.max(minOffset, Math.min(fullOffset, fit));
}

export interface TableauColumnProps {
  readonly pile: readonly Card[];
  readonly colIndex: number;
  readonly selectedIndex?: number;
  readonly shakeX?: SharedValue<number>;
  readonly hintIndex?: number;
  readonly hintDestination?: boolean;
  readonly onCardPress?: (colIndex: number, cardIndex: number) => void;
  readonly onEmptyPress?: (colIndex: number) => void;
  readonly dropId?: string;
  readonly onDrop?: DropHandler;
  /**
   * Height (px) the column may take before it compresses; the board passes
   * what's left of the screen below the top row. Defaults to the scaled
   * natural budget (TABLEAU_MAX_HEIGHT).
   */
  readonly maxHeight?: number;
}

/** FreeCell's column: the shared tableau (#2983), always face-up, compressing to fit (#1108). */
export default function TableauColumn({
  pile,
  colIndex,
  selectedIndex,
  shakeX,
  hintIndex,
  hintDestination = false,
  onCardPress,
  onEmptyPress,
  dropId,
  onDrop,
  maxHeight,
}: TableauColumnProps) {
  const { t } = useTranslation("freecell");
  const { cardWidth, cardHeight } = useCardSize();
  const scale = cardWidth / CARD_WIDTH;
  const faceUpOffset = computeCardOffset(
    pile.length,
    Math.round(FACE_UP_OFFSET * scale),
    cardHeight,
    maxHeight ?? TABLEAU_MAX_HEIGHT * scale,
    MIN_FACE_UP_OFFSET * scale
  );

  const renderCard = (card: Card, cardIndex: number) => {
    const isSelected = selectedIndex !== undefined && cardIndex >= selectedIndex;
    const isHint = hintIndex !== undefined && cardIndex >= hintIndex;
    const isHintDest = hintDestination && cardIndex === pile.length - 1;
    const rl = rankLabel(card.rank);
    const suitName = t(`suit.${card.suit}` as const);
    const label = isSelected
      ? t("card.selected", { rank: rl, suit: suitName })
      : t("card.label", { rank: rl, suit: suitName });
    return (
      <SelectableCard
        suit={card.suit}
        rank={card.rank}
        width={cardWidth}
        height={cardHeight}
        selected={isSelected}
        shakeX={isSelected ? shakeX : undefined}
        hintHighlighted={isHint || isHintDest}
        accessibilityLabel={label}
      />
    );
  };

  return (
    <SharedTableauColumn
      game="freecell"
      ns="freecell"
      emptyRadius={6}
      hintBorderWidth={2}
      faceUpOffset={faceUpOffset}
      cardTestID={(cardIndex, isTop) =>
        isTop ? `freecell-col-${colIndex}-top` : `freecell-col-${colIndex}-card-${cardIndex}`
      }
      renderCard={renderCard}
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
