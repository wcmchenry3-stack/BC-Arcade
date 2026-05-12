import React from "react";
import { Pressable, StyleSheet, View, ViewStyle } from "react-native";
import { useTranslation } from "react-i18next";

import { useTheme } from "../../theme/ThemeContext";
import { rankLabel } from "../../game/_shared/decks/cardId";
import type { CanonicalSuit } from "../../game/_shared/decks/types";
import type { Card } from "../../game/freecell/types";
import { CARD_WIDTH } from "./FreeCellSlot";
import { useCardSize } from "../../game/_shared/CardSizeContext";
import SelectableCard from "../../game/_shared/SelectableCard";
import { DraggableCard } from "../../game/_shared/drag/DraggableCard";
import { DropTarget } from "../../game/_shared/drag/DropTarget";
import type { DropHandler } from "../../game/_shared/drag/DragContext";
import type { SharedValue } from "react-native-reanimated";

const FACE_UP_OFFSET = 36;

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
}: TableauColumnProps) {
  const { colors } = useTheme();
  const { t } = useTranslation("freecell");
  const { cardWidth, cardHeight } = useCardSize();
  const faceUpOffset = Math.round(FACE_UP_OFFSET * (cardWidth / CARD_WIDTH));

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
