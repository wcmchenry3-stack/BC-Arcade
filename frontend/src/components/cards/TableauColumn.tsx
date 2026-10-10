/**
 * TableauColumn (#2983) — one tableau column, shared by FreeCell and Solitaire.
 *
 * Stateless. Stacks the cards with a vertical offset (face-down cards use the
 * tighter `faceDownOffset`); an empty column is a dashed, tappable placeholder.
 * Every card is a `DraggableCard` carrying the run from it to the top; a buried
 * card's hit area is stretched over its visible stripe (`hitSlop`, #1248). The
 * whole column is one `DropTarget` when the board passes `dropId` + `onDrop`.
 *
 * What a card looks like (and its label, hint and selection) is the game's:
 * the wrappers in `components/freecell/` and `components/solitaire/` pass
 * `renderCard` and `cardTestID`.
 */

import React from "react";
import { Pressable, StyleSheet, View, type ViewStyle } from "react-native";
import { useTranslation } from "react-i18next";

import { useTheme } from "../../theme/ThemeContext";
import { useCardSize } from "../../game/_shared/CardSizeContext";
import { DraggableCard } from "../../game/_shared/drag/DraggableCard";
import { DropTarget } from "../../game/_shared/drag/DropTarget";
import type { DropHandler } from "../../game/_shared/drag/DragContext";
import type { CardGame, PileCard } from "./pileTypes";

export interface TableauColumnProps<C extends PileCard> {
  // ── per-game configuration (fixed by the FreeCell / Solitaire wrapper) ──
  /** `DragSource.game` for every card. */
  readonly game: CardGame;
  /** i18n namespace holding `pile.tableau.label` and `pile.tableau.empty`. */
  readonly ns: CardGame;
  /** Corner radius of the placeholder and of the drop / hint highlight. */
  readonly emptyRadius: number;
  /** Border width of a hinted placeholder and of the hint frame. */
  readonly hintBorderWidth: number;
  /** Scaled gap below a face-up card, and below a face-down one (defaults to face-up). */
  readonly faceUpOffset: number;
  readonly faceDownOffset?: number;
  /** testID of the card at `cardIndex` (Maestro drag sources, #2346). */
  readonly cardTestID: (cardIndex: number, isTop: boolean) => string;
  /** The card's face, wrapped by the column in its `DraggableCard`. */
  readonly renderCard: (card: C, cardIndex: number) => React.ReactNode;
  /** Solitaire: index of the card framed as the hinted move's source. */
  readonly hintFrameIndex?: number;

  // ── per-render state ──
  readonly pile: readonly C[];
  readonly colIndex: number;
  readonly hintDestination?: boolean;
  readonly onCardPress?: (colIndex: number, cardIndex: number) => void;
  readonly onEmptyPress?: (colIndex: number) => void;
  /** Unique drop-zone ID, e.g. "solitaire-tableau-0"; doubles as its testID. */
  readonly dropId?: string;
  readonly onDrop?: DropHandler;
}

export default function TableauColumn<C extends PileCard>({
  game,
  ns,
  emptyRadius,
  hintBorderWidth,
  faceUpOffset,
  faceDownOffset = faceUpOffset,
  cardTestID,
  renderCard,
  hintFrameIndex,
  pile,
  colIndex,
  hintDestination = false,
  onCardPress,
  onEmptyPress,
  dropId,
  onDrop,
}: TableauColumnProps<C>) {
  const { colors } = useTheme();
  const { t } = useTranslation(ns);
  const { cardWidth, cardHeight } = useCardSize();

  const highlightStyle: ViewStyle = {
    borderColor: colors.accent,
    borderWidth: 2,
    borderRadius: emptyRadius,
  };
  const hintStyle: ViewStyle = {
    borderColor: colors.bonus,
    borderWidth: hintBorderWidth,
    borderRadius: emptyRadius,
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
            borderRadius: emptyRadius,
            width: cardWidth,
            height: cardHeight,
            borderColor: hintDestination ? colors.bonus : colors.border,
            borderWidth: hintDestination ? hintBorderWidth : 1,
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
  for (const card of pile) {
    offsets.push(acc);
    acc += card.faceUp === false ? faceDownOffset : faceUpOffset;
  }
  const containerHeight = cardHeight + (offsets[pile.length - 1] ?? 0);
  const containerStyle: ViewStyle = { width: cardWidth, height: containerHeight };
  const pileLabel = t("pile.tableau.label", { col: colIndex + 1, count: pile.length });

  const cards = pile.map((card, cardIndex) => {
    const isTop = cardIndex === pile.length - 1;
    const handlePress = onCardPress ? () => onCardPress(colIndex, cardIndex) : undefined;
    const dragCards = pile.slice(cardIndex).map((c) => ({
      suit: c.suit,
      rank: c.rank,
      faceDown: c.faceUp === false,
      width: cardWidth,
      height: cardHeight,
    }));
    // A buried card shows only a stripe; stretch its hit area down over it.
    const stripeHeight = isTop ? 0 : (offsets[cardIndex + 1] ?? 0) - (offsets[cardIndex] ?? 0);
    const hitSlop = isTop
      ? undefined
      : { top: 0, bottom: Math.min(24, stripeHeight), left: 4, right: 4 };
    return (
      <DraggableCard
        key={cardIndex}
        // Column-scoped: a bare per-index testID collides across columns
        // (every column has a card at index 0), so Maestro couldn't pick a
        // drag *source* by testID. See #2346.
        testID={cardTestID(cardIndex, isTop)}
        style={[
          styles.cardSlot,
          { top: offsets[cardIndex] ?? 0 },
          cardIndex === hintFrameIndex && hintStyle,
        ]}
        onTap={handlePress}
        dragCards={dragCards}
        dragSource={{ game, type: "tableau", col: colIndex, fromIndex: cardIndex }}
        draggable={card.faceUp !== false}
        hitSlop={hitSlop}
      >
        {renderCard(card, cardIndex)}
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
        <View style={StyleSheet.absoluteFill} accessibilityLabel={pileLabel}>
          {cards}
        </View>
      </DropTarget>
    );
  }

  return (
    <View style={containerStyle} accessibilityLabel={pileLabel}>
      {cards}
    </View>
  );
}

const styles = StyleSheet.create({
  empty: {
    borderWidth: 1,
    borderStyle: "dashed",
  },
  cardSlot: {
    position: "absolute",
    left: 0,
  },
});
