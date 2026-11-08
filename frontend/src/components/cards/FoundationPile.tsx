/**
 * FoundationPile (#2983) — one suit's foundation slot, shared by FreeCell and
 * Solitaire.
 *
 * Stateless. Shows the top card (draggable, tappable) when the pile has cards;
 * otherwise an empty placeholder showing the suit glyph so the player can tell
 * which foundation takes which suit. Wrapped in a `DropTarget` when the board
 * passes `dropId` + `onDrop`.
 *
 * The games differ only in the props below (`game`, `ns`, label keys, corner
 * radius, hint styling and the placeholder glyph's look); the wrappers in
 * `components/freecell/` and `components/solitaire/` fix them.
 */

import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { StyleProp, TextStyle, ViewStyle } from "react-native";
import { useTranslation } from "react-i18next";
import type { SharedValue } from "react-native-reanimated";

import { useTheme, type Colors } from "../../theme/ThemeContext";
import { TABLE_SLOT_EDGE, TABLE_SLOT_FILL } from "../../theme/theme.table";
import { useCardSize } from "../../game/_shared/CardSizeContext";
import { useReduceMotion } from "../shared/useReduceMotion";
import { rankLabel, suitEmoji } from "../../game/_shared/decks/cardId";
import type { CanonicalSuit } from "../../game/_shared/decks/types";
import SelectableCard from "../../game/_shared/SelectableCard";
import { DraggableCard } from "../../game/_shared/drag/DraggableCard";
import { DropTarget } from "../../game/_shared/drag/DropTarget";
import { dropHighlightStyle } from "../../game/_shared/drag/dropHighlight";
import type { DropHandler } from "../../game/_shared/drag/DragContext";
import type { CardGame, PileCard } from "./pileTypes";
import HintFrame from "./HintFrame";

export interface FoundationPileProps {
  // ── per-game configuration (fixed by the FreeCell / Solitaire wrapper) ──
  /** `DragSource.game` for the top card. */
  readonly game: CardGame;
  /** i18n namespace holding `suit.*`, `pile.foundation.empty` and the card label keys. */
  readonly ns: CardGame;
  /** testID of the top card: `${testIdPrefix}-foundation-${suit}-card`. */
  readonly testIdPrefix: string;
  /** Card-label keys in `ns`, for the top card unselected / selected. */
  readonly cardLabelKeys: { readonly normal: string; readonly selected: string };
  /** Corner radius of the placeholder and of the drop / hint highlight. */
  readonly emptyRadius: number;
  /** Border width of a hinted placeholder (and of the hint frame). */
  readonly hintBorderWidth: number;
  /**
   * How a hint marks a non-empty pile: `"overlay"` lays a dashed destination
   * `HintFrame` over the card (FreeCell, #3346); `"frame"` wraps the card in a
   * hint-coloured frame (Solitaire).
   */
  readonly topCardHint: "overlay" | "frame";
  /** Placeholder glyph: size / line height / opacity, and its colour per suit. */
  readonly suitGlyphStyle: StyleProp<TextStyle>;
  readonly suitGlyphColor: (suit: CanonicalSuit, colors: Colors) => string;

  /** The board sits on a felt (#3606): an empty slot is a faint outline, not an opaque one. */
  readonly onFelt?: boolean;

  // ── per-render state ──
  readonly pile: readonly PileCard[];
  readonly suit: CanonicalSuit;
  readonly selected?: boolean;
  readonly shakeX?: SharedValue<number>;
  readonly hintDestination?: boolean;
  /** Solitaire: this pile's top card is the hinted move's source. */
  readonly hintSource?: boolean;
  /** The selected card can move here (#3606): a green outline and "can move here" in the label. */
  readonly legalTarget?: boolean;
  readonly onPress?: (suit: CanonicalSuit) => void;
  /** Unique drop-zone ID, e.g. "solitaire-foundation-spades"; doubles as its testID. */
  readonly dropId?: string;
  readonly onDrop?: DropHandler;
}

export default function FoundationPile({
  game,
  ns,
  testIdPrefix,
  cardLabelKeys,
  emptyRadius,
  hintBorderWidth,
  topCardHint,
  suitGlyphStyle,
  suitGlyphColor,
  onFelt = false,
  pile,
  suit,
  selected = false,
  shakeX,
  hintDestination = false,
  hintSource = false,
  legalTarget = false,
  onPress,
  dropId,
  onDrop,
}: FoundationPileProps) {
  const { colors } = useTheme();
  const { t } = useTranslation(ns);
  const { cardWidth, cardHeight } = useCardSize();
  const reduceMotion = useReduceMotion();
  const hasDrop = dropId !== undefined && onDrop !== undefined;
  const hinted = hintDestination || hintSource;

  // Layout-neutral: this DropTarget only wraps the fixed-size pile (#3532).
  const highlightStyle = dropHighlightStyle(colors.accent, emptyRadius);
  const hintStyle: ViewStyle = {
    borderColor: colors.bonus,
    borderWidth: hintBorderWidth,
    borderRadius: emptyRadius,
  };

  const inner = (() => {
    const top = pile[pile.length - 1];
    if (top !== undefined) {
      const rl = rankLabel(top.rank);
      const suitName = t(`suit.${top.suit}`);
      const label = selected
        ? t(cardLabelKeys.selected, { rank: rl, suit: suitName })
        : t(cardLabelKeys.normal, { rank: rl, suit: suitName });
      const card = (
        <DraggableCard
          testID={`${testIdPrefix}-foundation-${suit}-card`}
          onTap={onPress ? () => onPress(suit) : undefined}
          accessibilityLabel={label}
          dragCards={[
            {
              suit: top.suit,
              rank: top.rank,
              faceDown: false,
              width: cardWidth,
              height: cardHeight,
            },
          ]}
          dragSource={{ game, type: "foundation", suit }}
        >
          <SelectableCard
            suit={top.suit}
            rank={top.rank}
            width={cardWidth}
            height={cardHeight}
            selected={selected}
            reduceMotion={reduceMotion}
            shakeX={shakeX}
            accessibilityLabel={label}
          />
        </DraggableCard>
      );
      const targetOutline = legalTarget ? (
        <View
          pointerEvents="none"
          testID={`${testIdPrefix}-foundation-${suit}-target`}
          accessible
          accessibilityLabel={t("pile.foundation.label", { suit: suitName })}
          accessibilityHint={t("pile.canMoveHere")}
          style={[styles.targetOutline, { borderColor: colors.bonus, borderRadius: emptyRadius }]}
        />
      ) : null;
      if (topCardHint === "frame") {
        return (
          <View style={hinted ? hintStyle : undefined}>
            {card}
            {targetOutline}
          </View>
        );
      }
      return hintDestination ? (
        <View>
          {card}
          <HintFrame role="destination" radius={emptyRadius} />
          {targetOutline}
        </View>
      ) : legalTarget ? (
        <View>
          {card}
          {targetOutline}
        </View>
      ) : (
        card
      );
    }

    const emptyLabel = t("pile.foundation.empty", { suit: t(`suit.${suit}`) });
    const label = emptyLabel;
    const marked = hinted || legalTarget;
    const pileStyle = [
      styles.empty,
      {
        borderRadius: emptyRadius,
        width: cardWidth,
        height: cardHeight,
        borderColor: marked
          ? colors.bonus
          : selected
            ? colors.accent
            : onFelt
              ? TABLE_SLOT_EDGE
              : colors.border,
        borderWidth: marked ? hintBorderWidth : selected ? 2 : 1,
        backgroundColor: onFelt ? TABLE_SLOT_FILL : colors.background,
      },
    ];
    const content = (
      <Text style={[suitGlyphStyle, { color: suitGlyphColor(suit, colors) }]}>
        {suitEmoji(suit)}
      </Text>
    );

    if (onPress) {
      return (
        <Pressable
          onPress={() => onPress(suit)}
          style={pileStyle}
          accessibilityRole="button"
          accessibilityLabel={label}
          accessibilityHint={legalTarget ? t("pile.canMoveHere") : undefined}
          testID={legalTarget ? `${testIdPrefix}-foundation-${suit}-target` : undefined}
        >
          {content}
        </Pressable>
      );
    }
    return (
      <View style={pileStyle} accessibilityRole="image" accessibilityLabel={label}>
        {content}
      </View>
    );
  })();

  if (hasDrop) {
    return (
      // testID mirrors the tableau / free-cell convention (dropId doubles as
      // the Maestro-queryable id) — without it, an empty foundation pile has
      // no element Maestro can target as a drag destination. See #2346.
      <DropTarget
        id={dropId!}
        testID={dropId}
        onDrop={onDrop!}
        highlightStyle={highlightStyle}
        dimStyle={styles.dim}
      >
        {inner}
      </DropTarget>
    );
  }
  return inner;
}

const styles = StyleSheet.create({
  empty: {
    alignItems: "center",
    justifyContent: "center",
  },
  dim: { opacity: 0.4 },
  targetOutline: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderWidth: 3,
  },
});
