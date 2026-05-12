import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { useTheme } from "../../theme/ThemeContext";
import { typography } from "../../theme/typography";
import { rankLabel } from "../../game/_shared/decks/cardId";
import type { CanonicalSuit } from "../../game/_shared/decks/types";
import SelectableCard from "../../game/_shared/SelectableCard";
import type { Card } from "../../game/freecell/types";
import { useCardSize } from "../../game/_shared/CardSizeContext";
import { DraggableCard } from "../../game/_shared/drag/DraggableCard";
import { DropTarget } from "../../game/_shared/drag/DropTarget";
import type { DropHandler } from "../../game/_shared/drag/DragContext";
import type { SharedValue } from "react-native-reanimated";

export const CARD_WIDTH = 40;
export const CARD_HEIGHT = 57;

export interface FreeCellSlotProps {
  readonly card: Card | null;
  readonly cellIndex: number;
  readonly selected?: boolean;
  readonly shakeX?: SharedValue<number>;
  readonly hintSource?: boolean;
  readonly hintDestination?: boolean;
  readonly onPress?: (cellIndex: number) => void;
  readonly dropId?: string;
  readonly onDrop?: DropHandler;
}

export default function FreeCellSlot({
  card,
  cellIndex,
  selected = false,
  shakeX,
  hintSource = false,
  hintDestination = false,
  onPress,
  dropId,
  onDrop,
}: FreeCellSlotProps) {
  const { colors } = useTheme();
  const { t } = useTranslation("freecell");
  const { cardWidth, cardHeight } = useCardSize();

  const handlePress = onPress ? () => onPress(cellIndex) : undefined;
  const hasDrop = dropId !== undefined && onDrop !== undefined;

  if (card !== null) {
    const rl = rankLabel(card.rank);
    const suitName = t(`suit.${card.suit}` as const);
    const label = selected
      ? t("card.selected", { rank: rl, suit: suitName })
      : t("card.label", { rank: rl, suit: suitName });

    const cardEl = (
      <SelectableCard
        suit={card.suit as CanonicalSuit}
        rank={card.rank}
        width={cardWidth}
        height={cardHeight}
        selected={selected}
        shakeX={shakeX}
        hintHighlighted={hintSource}
        accessibilityLabel={label}
      />
    );

    const draggable = (
      <DraggableCard
        onTap={handlePress}
        dragCards={[
          {
            suit: card.suit as CanonicalSuit,
            rank: card.rank,
            faceDown: false,
            width: cardWidth,
            height: cardHeight,
          },
        ]}
        dragSource={{ game: "freecell", type: "freecell", cell: cellIndex }}
      >
        {cardEl}
      </DraggableCard>
    );

    if (hasDrop) {
      return (
        <DropTarget
          id={dropId!}
          onDrop={onDrop!}
          highlightStyle={{ borderColor: colors.accent, borderWidth: 2, borderRadius: 6 }}
          dimStyle={{ opacity: 0.4 }}
        >
          {draggable}
        </DropTarget>
      );
    }
    return draggable;
  }

  // Empty slot.
  const emptyLabel = t("pile.freecell.empty", { cell: cellIndex + 1 });
  const slotStyle = [
    styles.empty,
    {
      width: cardWidth,
      height: cardHeight,
      borderColor: hintDestination ? colors.bonus : selected ? colors.accent : colors.border,
      borderWidth: hintDestination || selected ? 2 : 1,
      backgroundColor: colors.background,
    },
  ];

  const freeLabel = <Text style={[styles.freeLabel, { color: colors.textFilled }]}>free</Text>;

  const emptyEl = handlePress ? (
    <Pressable
      onPress={handlePress}
      style={slotStyle}
      accessibilityRole="button"
      accessibilityLabel={emptyLabel}
    >
      {freeLabel}
    </Pressable>
  ) : (
    <View style={slotStyle} accessibilityRole="image" accessibilityLabel={emptyLabel}>
      {freeLabel}
    </View>
  );

  if (hasDrop) {
    return (
      <DropTarget
        id={dropId!}
        onDrop={onDrop!}
        highlightStyle={{ borderColor: colors.accent, borderWidth: 2, borderRadius: 6 }}
        dimStyle={{ opacity: 0.4 }}
      >
        {emptyEl}
      </DropTarget>
    );
  }
  return emptyEl;
}

const styles = StyleSheet.create({
  empty: {
    borderRadius: 6,
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
  },
  freeLabel: {
    fontFamily: typography.label,
    fontSize: 8,
    letterSpacing: 1,
    textTransform: "uppercase",
  },
});
