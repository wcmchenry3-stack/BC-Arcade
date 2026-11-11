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
import { HiddenWhileFlying, useFlightSelector } from "../cards/cardFlights";
import { cardKey } from "../cards/cardMotion";

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
  /** The game is over (the win, held for the last landing, #3573): the card can't be dragged. */
  readonly locked?: boolean;
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
  locked = false,
  onPress,
  dropId,
  onDrop,
}: FreeCellSlotProps) {
  const { colors } = useTheme();
  const { t } = useTranslation("freecell");
  const { cardWidth, cardHeight } = useCardSize();
  // A card flying into this cell (#3573) is drawn by the board's flight layer; its view here
  // stays (label, testID, touch target), transparent, with the empty cell drawn under it.
  const { flyingKey, flying } = useFlyingInto(card);

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
        draggable={!locked}
      >
        <HiddenWhileFlying cardKey={flyingKey}>{hintedEl}</HiddenWhileFlying>
      </DraggableCard>
    );
    // Always in this wrapper, so the card's view is never re-parented when its flight starts
    // or ends (a remount would drop a touch on it mid-flight).
    const body = (
      <View>
        {flying ? <EmptyUnder width={cardWidth} height={cardHeight} /> : null}
        {draggable}
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
          {body}
        </DropTarget>
      );
    }
    return body;
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

/** The cell's card's key, and whether that card is in flight (into this cell). */
function useFlyingInto(card: Card | null): { flyingKey: string; flying: boolean } {
  const flyingKey = card === null ? "" : cardKey(card);
  const flying = useFlightSelector((s) => flyingKey !== "" && s.isFlying(flyingKey), false);
  return { flyingKey, flying };
}

/** The empty cell, drawn under a card flying into it: decorative only. */
function EmptyUnder({ width, height }: { readonly width: number; readonly height: number }) {
  return (
    <View
      pointerEvents="none"
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      aria-hidden
      style={[styles.empty, styles.under, { width, height }]}
    />
  );
}

const styles = StyleSheet.create({
  empty: {
    borderRadius: 6,
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
  },
  under: {
    position: "absolute",
    top: 0,
    left: 0,
    borderColor: TABLE_SLOT_EDGE,
    borderWidth: 1.5,
    backgroundColor: TABLE_SLOT_FILL,
  },
  freeLabel: {
    fontFamily: typography.label,
    fontSize: 8,
    letterSpacing: 1,
    textTransform: "uppercase",
  },
});
