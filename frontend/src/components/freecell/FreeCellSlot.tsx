import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { useTheme } from "../../theme/ThemeContext";
import { TABLE_SLOT_EDGE, TABLE_SLOT_FILL } from "../../theme/theme.table";
import { typography } from "../../theme/typography";
import { rankLabel } from "../../game/_shared/decks/cardId";
import type { CanonicalSuit } from "../../game/_shared/decks/types";
import SelectableCard from "../../game/_shared/SelectableCard";
import HintFrame, { HINT_DEST_BORDER } from "../cards/HintFrame";
import type { Card } from "../../game/freecell/types";
import { useCardSize } from "../../game/_shared/CardSizeContext";
import { DraggableCard } from "../../game/_shared/drag/DraggableCard";
import { DropTarget } from "../../game/_shared/drag/DropTarget";
import { dropHighlightStyle } from "../../game/_shared/drag/dropHighlight";
import type { DropHandler } from "../../game/_shared/drag/DragContext";
import type { SharedValue } from "react-native-reanimated";

export const CARD_WIDTH = 40;
/**
 * FreeCell's natural card height (40 x 57). Since #3607 the felt's geometry sizes the cards.
 * @internal Exported for tests only; no production caller (knip --production, #3126).
 */
export const CARD_HEIGHT = 57;

export interface FreeCellSlotProps {
  readonly card: Card | null;
  readonly cellIndex: number;
  readonly selected?: boolean;
  readonly shakeX?: SharedValue<number>;
  readonly hintSource?: boolean;
  readonly hintDestination?: boolean;
  /**
   * The selected card can move here (#3607): a green outline and
   * `canMoveHereHint` on the empty slot, the element a screen reader lands on.
   */
  readonly legalTarget?: boolean;
  /** "Can move here", in the game's language; the board passes it. */
  readonly canMoveHereHint?: string;
  /** Reduce Motion (#3607): the selected card does not lift. The screen reads the setting once. */
  readonly reduceMotion?: boolean;
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
  legalTarget = false,
  canMoveHereHint,
  reduceMotion = false,
  onPress,
  dropId,
  onDrop,
}: FreeCellSlotProps) {
  const { colors } = useTheme();
  const { t } = useTranslation("freecell");
  const { cardWidth, cardHeight } = useCardSize();

  const handlePress = onPress ? () => onPress(cellIndex) : undefined;
  const hasDrop = dropId !== undefined && onDrop !== undefined;
  const hint = legalTarget ? canMoveHereHint : undefined;

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
        reduceMotion={reduceMotion}
        shakeX={shakeX}
        accessibilityLabel={label}
      />
    );
    const hintedEl = hintSource ? (
      <View>
        {cardEl}
        <HintFrame role="source" radius={6} />
      </View>
    ) : (
      cardEl
    );

    const draggable = (
      <DraggableCard
        testID={`freecell-slot-${cellIndex}-card`}
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
        {hintedEl}
      </DraggableCard>
    );

    if (hasDrop) {
      return (
        <DropTarget
          id={dropId!}
          testID={dropId}
          onDrop={onDrop!}
          highlightStyle={dropHighlightStyle(colors.accent, 6)}
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
  // On the felt (#3607): a faint dashed outline; a hint or a legal target draws it in `bonus`.
  const marked = hintDestination || legalTarget;
  const slotStyle = [
    styles.empty,
    {
      width: cardWidth,
      height: cardHeight,
      borderColor: marked ? colors.bonus : selected ? colors.accent : TABLE_SLOT_EDGE,
      borderWidth: marked ? HINT_DEST_BORDER : selected ? 2 : 1.5,
      backgroundColor: TABLE_SLOT_FILL,
    },
  ];

  // A quiet watermark on the felt, like the foundations' suit glyphs (#3607).
  const freeLabel = (
    <Text style={[styles.freeLabel, { color: colors.textMuted }]}>{t("slot.free")}</Text>
  );

  const emptyEl = handlePress ? (
    <Pressable
      onPress={handlePress}
      style={slotStyle}
      accessibilityRole="button"
      accessibilityLabel={emptyLabel}
      accessibilityHint={hint}
      testID={legalTarget ? `freecell-slot-${cellIndex}-target` : undefined}
    >
      {freeLabel}
    </Pressable>
  ) : (
    <View
      style={slotStyle}
      accessibilityRole="image"
      accessibilityLabel={emptyLabel}
      accessibilityHint={hint}
    >
      {freeLabel}
    </View>
  );

  if (hasDrop) {
    return (
      <DropTarget
        id={dropId!}
        testID={dropId}
        onDrop={onDrop!}
        highlightStyle={dropHighlightStyle(colors.accent, 6)}
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
