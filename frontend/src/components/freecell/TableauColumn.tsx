import React from "react";
import { useTranslation } from "react-i18next";
import type { SharedValue } from "react-native-reanimated";

import SharedTableauColumn from "../cards/TableauColumn";
import { HINT_DEST_BORDER } from "../cards/HintFrame";
import { rankLabel } from "../../game/_shared/decks/cardId";
import type { Card } from "../../game/freecell/types";
import { useCardSize } from "../../game/_shared/CardSizeContext";
import { CARD_WIDTH } from "./FreeCellSlot";
import SelectableCard from "../../game/_shared/SelectableCard";
import type { DropHandler } from "../../game/_shared/drag/DragContext";
import { HiddenWhileFlying } from "../cards/cardFlights";
import { cardKey } from "../cards/cardMotion";

/** The step between cards when the board passes none: 36 dp on the natural 40 dp card. */
const NATURAL_FACE_UP_OFFSET = 36;

export interface TableauColumnProps {
  readonly pile: readonly Card[];
  readonly colIndex: number;
  /**
   * The vertical step between cards (#3607): one value for the whole board,
   * from the felt's geometry (`faceUpStepFor`), so every legal column fits and
   * short columns stay airy. Omitted: the natural step scaled to the card.
   */
  readonly faceUpOffset?: number;
  readonly selectedIndex?: number;
  readonly shakeX?: SharedValue<number>;
  readonly hintIndex?: number;
  readonly hintDestination?: boolean;
  /** The selected card or run can move here (#3607): a green outline and "Can move here". */
  readonly legalTarget?: boolean;
  /** Reduce Motion (#3607): the selected run does not lift. The screen reads the setting once. */
  readonly reduceMotion?: boolean;
  /** The game is over (the win, held for the last landing, #3573): no card can be dragged. */
  readonly locked?: boolean;
  readonly onCardPress?: (colIndex: number, cardIndex: number) => void;
  readonly onEmptyPress?: (colIndex: number) => void;
  readonly dropId?: string;
  readonly onDrop?: DropHandler;
}

/** FreeCell's column: the shared tableau (#2983) on the felt (#3607), always face-up. */
export default function TableauColumn({
  pile,
  colIndex,
  faceUpOffset,
  selectedIndex,
  shakeX,
  hintIndex,
  hintDestination = false,
  legalTarget = false,
  reduceMotion = false,
  locked = false,
  onCardPress,
  onEmptyPress,
  dropId,
  onDrop,
}: TableauColumnProps) {
  const { t } = useTranslation("freecell");
  const { cardWidth, cardHeight } = useCardSize();
  const step = faceUpOffset ?? Math.round((NATURAL_FACE_UP_OFFSET * cardWidth) / CARD_WIDTH);

  const renderCard = (card: Card, cardIndex: number, hint?: string, compactIndex?: number) => {
    const isSelected = selectedIndex !== undefined && cardIndex >= selectedIndex;
    const rl = rankLabel(card.rank);
    const suitName = t(`suit.${card.suit}` as const);
    const label = isSelected
      ? t("card.selected", { rank: rl, suit: suitName })
      : t("card.label", { rank: rl, suit: suitName });
    // A card in flight (#3573) is drawn by the board's flight layer: its view here stays,
    // transparent (label, testID and touch target kept).
    return (
      <HiddenWhileFlying cardKey={cardKey(card)}>
        <SelectableCard
          suit={card.suit}
          rank={card.rank}
          width={cardWidth}
          height={cardHeight}
          selected={isSelected}
          reduceMotion={reduceMotion}
          shakeX={isSelected ? shakeX : undefined}
          accessibilityLabel={label}
          accessibilityHint={hint}
          compactIndex={compactIndex}
        />
      </HiddenWhileFlying>
    );
  };

  return (
    <SharedTableauColumn
      game="freecell"
      ns="freecell"
      emptyRadius={6}
      hintBorderWidth={HINT_DEST_BORDER}
      hintRunFrom={hintIndex}
      hintDestinationFrame
      faceUpOffset={step}
      cardTestID={(cardIndex, isTop) =>
        isTop ? `freecell-col-${colIndex}-top` : `freecell-col-${colIndex}-card-${cardIndex}`
      }
      renderCard={renderCard}
      onFelt
      pile={pile}
      colIndex={colIndex}
      hintDestination={hintDestination}
      legalTarget={legalTarget}
      canMoveHereHint={t("pile.canMoveHere")}
      onCardPress={onCardPress}
      onEmptyPress={onEmptyPress}
      dropId={dropId}
      onDrop={onDrop}
      locked={locked}
    />
  );
}
