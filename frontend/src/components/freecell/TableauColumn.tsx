import React from "react";
import { Pressable, StyleSheet, View, ViewStyle } from "react-native";
import { useTranslation } from "react-i18next";

import { useTheme } from "../../theme/ThemeContext";
import { rankLabel } from "../../game/_shared/decks/cardId";
import type { CanonicalSuit } from "../../game/_shared/decks/types";
import type { Card } from "../../game/freecell/types";
import { CARD_HEIGHT, CARD_WIDTH } from "./FreeCellSlot";
import { useCardSize } from "../../game/_shared/CardSizeContext";
import SelectableCard from "../../game/_shared/SelectableCard";
import { DraggableCard } from "../../game/_shared/drag/DraggableCard";
import { DropTarget } from "../../game/_shared/drag/DropTarget";
import type { DropHandler } from "../../game/_shared/drag/DragContext";
import type { SharedValue } from "react-native-reanimated";

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
  const { colors } = useTheme();
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

  const highlightStyle: ViewStyle = { borderColor: colors.accent, borderWidth: 2, borderRadius: 6 };
  const dimStyle: ViewStyle = { opacity: 0.4 };
  const hasDrop = dropId !== undefined && onDrop !== undefined;

  if (pile.length === 0) {
    const empty = (
      <Pressable
        onPress={onEmptyPress ? () => onEmptyPress(colIndex) : undefined}
        style={[
          styles.empty,
          {
            width: cardWidth,
            height: cardHeight,
            borderColor: hintDestination ? colors.bonus : colors.border,
            borderWidth: hintDestination ? 2 : 1,
            backgroundColor: colors.background,
          },
        ]}
        accessibilityRole="button"
        accessibilityLabel={t("pile.tableau.empty", { col: colIndex + 1 })}
      />
    );
    if (hasDrop) {
      return (
        <DropTarget
          id={dropId!}
          testID={dropId}
          onDrop={onDrop!}
          highlightStyle={highlightStyle}
          dimStyle={dimStyle}
        >
          {empty}
        </DropTarget>
      );
    }
    return empty;
  }

  const offsets: number[] = [];
  let acc = 0;
  for (let i = 0; i < pile.length; i++) {
    offsets.push(acc);
    acc += faceUpOffset;
  }
  const containerHeight = cardHeight + (offsets[pile.length - 1] ?? 0);
  const containerStyle: ViewStyle = { width: cardWidth, height: containerHeight };

  const cards = pile.map((card, cardIndex) => {
    const isTop = cardIndex === pile.length - 1;
    const isSelected = selectedIndex !== undefined && cardIndex >= selectedIndex;
    const isHint = hintIndex !== undefined && cardIndex >= hintIndex;
    const isHintDest = hintDestination && cardIndex === pile.length - 1;
    const rl = rankLabel(card.rank);
    const suitName = t(`suit.${card.suit}` as const);
    const label = isSelected
      ? t("card.selected", { rank: rl, suit: suitName })
      : t("card.label", { rank: rl, suit: suitName });
    const handlePress = onCardPress ? () => onCardPress(colIndex, cardIndex) : undefined;

    const dragCards = pile.slice(cardIndex).map((c) => ({
      suit: c.suit as CanonicalSuit,
      rank: c.rank,
      faceDown: false,
      width: cardWidth,
      height: cardHeight,
    }));
    const stripeHeight = isTop ? 0 : (offsets[cardIndex + 1] ?? 0) - (offsets[cardIndex] ?? 0);
    const hitSlop = isTop
      ? undefined
      : { top: 0, bottom: Math.min(24, stripeHeight), left: 4, right: 4 };

    return (
      <DraggableCard
        key={cardIndex}
        testID={
          isTop ? `freecell-col-${colIndex}-top` : `freecell-col-${colIndex}-card-${cardIndex}`
        }
        style={[styles.cardSlot, { top: offsets[cardIndex] ?? 0 }]}
        onTap={handlePress}
        dragCards={dragCards}
        dragSource={{ game: "freecell", type: "tableau", col: colIndex, fromIndex: cardIndex }}
        hitSlop={hitSlop}
      >
        <SelectableCard
          suit={card.suit as CanonicalSuit}
          rank={card.rank}
          width={cardWidth}
          height={cardHeight}
          selected={isSelected}
          shakeX={isSelected ? shakeX : undefined}
          hintHighlighted={isHint || isHintDest}
          accessibilityLabel={label}
        />
      </DraggableCard>
    );
  });

  if (hasDrop) {
    return (
      <DropTarget
        id={dropId!}
        testID={dropId}
        onDrop={onDrop!}
        style={containerStyle}
        highlightStyle={highlightStyle}
        dimStyle={dimStyle}
      >
        <View
          style={StyleSheet.absoluteFill}
          accessibilityLabel={t("pile.tableau.label", { col: colIndex + 1, count: pile.length })}
        >
          {cards}
        </View>
      </DropTarget>
    );
  }

  return (
    <View
      style={containerStyle}
      accessibilityLabel={t("pile.tableau.label", { col: colIndex + 1, count: pile.length })}
    >
      {cards}
    </View>
  );
}

const styles = StyleSheet.create({
  empty: {
    borderRadius: 6,
    borderWidth: 1,
    borderStyle: "dashed",
  },
  cardSlot: {
    position: "absolute",
    left: 0,
  },
});
