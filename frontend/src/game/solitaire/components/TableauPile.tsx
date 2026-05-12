/**
 * TableauPile (#595) — one column of a 7-column Klondike tableau.
 *
 * Stateless. Vertically offsets cards so all are visible; empty columns
 * render a dashed placeholder. Bubbles taps up as `(colIndex, cardIndex)`
 * so the parent screen can run its tap-to-select state machine.
 */

import React from "react";
import { Pressable, StyleSheet, View, ViewStyle } from "react-native";
import { useTranslation } from "react-i18next";

import { useTheme } from "../../../theme/ThemeContext";
import type { Card } from "../types";
import type { CanonicalSuit } from "../../_shared/decks/types";
import CardView, { CARD_WIDTH } from "./CardView";
import { useCardSize } from "../../_shared/CardSizeContext";
import { rankLabel } from "../../_shared/decks/cardId";
import SelectableCard from "../../_shared/SelectableCard";
import { DraggableCard } from "../../_shared/drag/DraggableCard";
import { DropTarget } from "../../_shared/drag/DropTarget";
import type { DropHandler } from "../../_shared/drag/DragContext";
import type { SharedValue } from "react-native-reanimated";

const FACE_UP_OFFSET = 28;
const FACE_DOWN_OFFSET = 20;

export interface TableauPileProps {
  readonly pile: readonly Card[];
  readonly colIndex: number;
  readonly selectedIndex?: number;
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
  shakeX,
  onCardPress,
  onEmptyPress,
  dropId,
  onDrop,
}: TableauPileProps) {
  const { colors } = useTheme();
  const { t } = useTranslation("solitaire");
  const { cardWidth, cardHeight } = useCardSize();
  const scale = cardWidth / CARD_WIDTH;
  const faceUpOffset = Math.round(FACE_UP_OFFSET * scale);
  const faceDownOffset = Math.round(FACE_DOWN_OFFSET * scale);

  const highlightStyle: ViewStyle = {
    borderColor: colors.accent,
    borderWidth: 2,
    borderRadius: 8,
  };
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
            borderColor: colors.border,
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
    const card = pile[i];
    if (card === undefined) break;
    acc += card.faceUp ? faceUpOffset : faceDownOffset;
  }
  const containerHeight = cardHeight + (offsets[pile.length - 1] ?? 0);
  const containerStyle: ViewStyle = { width: cardWidth, height: containerHeight };

  const cards = pile.map((card, cardIndex) => {
    const isTop = cardIndex === pile.length - 1;
    const isSelected = selectedIndex !== undefined && cardIndex >= selectedIndex;
    const handlePress = onCardPress ? () => onCardPress(colIndex, cardIndex) : undefined;
    const dragCards = pile.slice(cardIndex).map((c) => ({
      suit: c.suit as CanonicalSuit,
      rank: c.rank,
      faceDown: !c.faceUp,
      width: cardWidth,
      height: cardHeight,
    }));
    const selectedLabel = isSelected
      ? card.faceUp
        ? t("card.faceUpSelected", {
            rank: rankLabel(card.rank),
            suit: t(`suit.${card.suit}` as const),
          })
        : t("card.faceDownSelected")
      : undefined;
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
        dragSource={{ game: "solitaire", type: "tableau", col: colIndex, fromIndex: cardIndex }}
        draggable={card.faceUp}
        hitSlop={hitSlop}
      >
        {isSelected ? (
          <SelectableCard
            suit={card.suit as CanonicalSuit}
            rank={card.rank}
            faceDown={!card.faceUp}
            width={cardWidth}
            height={cardHeight}
            selected
            shakeX={shakeX}
            accessibilityLabel={selectedLabel}
          />
        ) : (
          <CardView card={card} />
        )}
      </DraggableCard>
    );
  });

  const pileView = (
    <View
      style={containerStyle}
      accessibilityLabel={t("pile.tableau.label", { col: colIndex + 1, count: pile.length })}
    >
      {cards}
    </View>
  );

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

  return pileView;
}

const styles = StyleSheet.create({
  empty: {
    borderRadius: 8,
    borderWidth: 1,
    borderStyle: "dashed",
  },
  cardSlot: {
    position: "absolute",
    left: 0,
  },
});
