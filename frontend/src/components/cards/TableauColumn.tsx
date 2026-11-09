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
import { Pressable, StyleSheet, Text, View, type ViewStyle } from "react-native";
import { useTranslation } from "react-i18next";

import { useTheme } from "../../theme/ThemeContext";
import { TABLE_SLOT_EDGE, TABLE_SLOT_FILL, TABLE_SLOT_MARK } from "../../theme/theme.table";
import { useCardSize } from "../../game/_shared/CardSizeContext";
import { DraggableCard } from "../../game/_shared/drag/DraggableCard";
import { DropTarget } from "../../game/_shared/drag/DropTarget";
import { dropHighlightStyle } from "../../game/_shared/drag/dropHighlight";
import type { DropHandler } from "../../game/_shared/drag/DragContext";
import { compactIndexFor } from "../../game/_shared/decks/cornerIndex";
import type { CardGame, PileCard } from "./pileTypes";
import HintFrame from "./HintFrame";

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
  /**
   * The card's face, wrapped by the column in its `DraggableCard`. `compactIndex` (#3622) is
   * the visible stripe of a covered face-up card too short for the stacked corner index; the
   * game passes it to the card so its deck draws the suit beside the rank.
   */
  readonly renderCard: (
    card: C,
    cardIndex: number,
    hint?: string,
    compactIndex?: number
  ) => React.ReactNode;
  /** Solitaire: index of the card framed as the hinted move's source. */
  readonly hintFrameIndex?: number;
  /**
   * FreeCell (#3346): index of the first card of the hinted run. One source
   * frame spans from there to the bottom of the column, so a run reads as a group.
   */
  readonly hintRunFrom?: number;
  /** FreeCell (#3346): frame the top card of a non-empty column as the hint destination. */
  readonly hintDestinationFrame?: boolean;

  /**
   * The board sits on a felt (#3606): an empty column is a faint outline with
   * `emptyMarker` (Solitaire's "K") instead of an opaque slot.
   */
  readonly onFelt?: boolean;
  readonly emptyMarker?: string;

  // ── per-render state ──
  readonly pile: readonly C[];
  readonly colIndex: number;
  readonly hintDestination?: boolean;
  /**
   * The selected card or run can move here (#3606): a green outline on the
   * destination, and "can move here" in its screen-reader label.
   */
  readonly legalTarget?: boolean;
  /** The hint for a legal target ("Can move here"), in the game's language; the board passes it. */
  readonly canMoveHereHint?: string;
  readonly onCardPress?: (colIndex: number, cardIndex: number) => void;
  readonly onEmptyPress?: (colIndex: number) => void;
  /** Unique drop-zone ID, e.g. "solitaire-tableau-0"; doubles as its testID. */
  readonly dropId?: string;
  readonly onDrop?: DropHandler;
}

/** FreeCell hint frames (#3346): one source frame over the run, one dashed frame over the top card. */
function HintOverlays({
  offsets,
  radius,
  runFrom,
  destination,
}: {
  readonly offsets: readonly number[];
  readonly radius: number;
  readonly runFrom?: number;
  readonly destination: boolean;
}) {
  const runTop = runFrom === undefined ? undefined : offsets[runFrom];
  return (
    <>
      {runTop !== undefined ? <HintFrame role="source" radius={radius} top={runTop} /> : null}
      {destination ? (
        <HintFrame role="destination" radius={radius} top={offsets[offsets.length - 1]} />
      ) : null}
    </>
  );
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
  hintRunFrom,
  hintDestinationFrame = false,
  onFelt = false,
  emptyMarker,
  pile,
  colIndex,
  hintDestination = false,
  legalTarget = false,
  canMoveHereHint,
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
    const emptyLabel = t("pile.tableau.empty", { col: colIndex + 1 });
    const marked = hintDestination || legalTarget;
    const emptyHint = legalTarget ? canMoveHereHint : undefined;
    const empty = (
      <Pressable
        onPress={onEmptyPress ? () => onEmptyPress(colIndex) : undefined}
        style={[
          styles.empty,
          {
            borderRadius: emptyRadius,
            width: cardWidth,
            height: cardHeight,
            borderColor: marked ? colors.bonus : onFelt ? TABLE_SLOT_EDGE : colors.border,
            borderWidth: marked ? hintBorderWidth : 1,
            backgroundColor: onFelt ? TABLE_SLOT_FILL : colors.background,
          },
        ]}
        accessibilityRole="button"
        accessibilityLabel={emptyLabel}
        accessibilityHint={emptyHint}
        testID={legalTarget ? `${dropId ?? "tableau"}-target` : undefined}
      >
        {emptyMarker !== undefined ? (
          <Text
            style={[styles.emptyMarker, { color: TABLE_SLOT_MARK, fontSize: cardWidth * 0.5 }]}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            testID={`${dropId ?? "tableau"}-marker`}
          >
            {emptyMarker}
          </Text>
        ) : null}
      </Pressable>
    );
    if (hasDrop) {
      return (
        <DropTarget
          id={dropId!}
          testID={dropId}
          onDrop={onDrop!}
          // Layout-neutral: this DropTarget only wraps the fixed-size empty
          // slot (#3532). The filled column below has a fixed size, so its
          // border is already inside its box.
          highlightStyle={dropHighlightStyle(colors.accent, emptyRadius)}
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
  // The compact corner index (#3622), from each card's real stripe: only a covered face-up
  // card whose stripe is too short for the stacked index gets it, never the top card.
  const compact = pile.map((card, i) =>
    i === pile.length - 1 || card.faceUp === false
      ? undefined
      : compactIndexFor((offsets[i + 1] ?? 0) - (offsets[i] ?? 0))
  );
  const containerHeight = cardHeight + (offsets[pile.length - 1] ?? 0);
  const containerStyle: ViewStyle = { width: cardWidth, height: containerHeight };
  const pileLabel = t("pile.tableau.label", { col: colIndex + 1, count: pile.length });
  // The hint goes on the destination's top card, the element a screen reader lands on.
  const topHint = legalTarget ? canMoveHereHint : undefined;
  const targetOutline = legalTarget ? (
    <View
      pointerEvents="none"
      accessible={false}
      importantForAccessibility="no"
      testID={`${dropId ?? "tableau"}-target`}
      style={{
        position: "absolute",
        left: 0,
        top: offsets[pile.length - 1] ?? 0,
        width: cardWidth,
        height: cardHeight,
        borderRadius: emptyRadius,
        borderWidth: 3,
        borderColor: colors.bonus,
      }}
    />
  ) : null;
  const hintOverlays = (
    <HintOverlays
      offsets={offsets}
      radius={emptyRadius}
      runFrom={hintRunFrom}
      destination={hintDestinationFrame && hintDestination}
    />
  );

  const cards = pile.map((card, cardIndex) => {
    const isTop = cardIndex === pile.length - 1;
    const handlePress = onCardPress ? () => onCardPress(colIndex, cardIndex) : undefined;
    // stackTop: the ghost fans the run with this pile's real offsets (#3531).
    const runTop = offsets[cardIndex] ?? 0;
    const dragCards = pile.slice(cardIndex).map((c, i) => ({
      suit: c.suit,
      rank: c.rank,
      faceDown: c.faceUp === false,
      width: cardWidth,
      height: cardHeight,
      stackTop: (offsets[cardIndex + i] ?? 0) - runTop,
      compactIndex: compact[cardIndex + i],
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
        {renderCard(card, cardIndex, isTop ? topHint : undefined, compact[cardIndex])}
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
          {hintOverlays}
          {targetOutline}
        </View>
      </DropTarget>
    );
  }

  return (
    <View style={containerStyle} accessibilityLabel={pileLabel}>
      {cards}
      {hintOverlays}
      {targetOutline}
    </View>
  );
}

const styles = StyleSheet.create({
  empty: {
    borderWidth: 1,
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
  },
  emptyMarker: {
    fontWeight: "700",
    textAlign: "center",
  },
  cardSlot: {
    position: "absolute",
    left: 0,
  },
});
