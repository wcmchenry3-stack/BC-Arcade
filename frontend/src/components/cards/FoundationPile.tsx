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
import { useCardSize } from "../../game/_shared/CardSizeContext";
import { rankLabel, suitEmoji } from "../../game/_shared/decks/cardId";
import type { CanonicalSuit } from "../../game/_shared/decks/types";
import SelectableCard from "../../game/_shared/SelectableCard";
import { DraggableCard } from "../../game/_shared/drag/DraggableCard";
import { DropTarget } from "../../game/_shared/drag/DropTarget";
import type { DropHandler } from "../../game/_shared/drag/DragContext";
import type { CardGame, PileCard } from "./pileTypes";

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
   * How a hint marks a non-empty pile: `"card"` passes it to the card's own
   * hint border (FreeCell); `"frame"` wraps the card in a hint-coloured frame
   * (Solitaire).
   */
  readonly topCardHint: "card" | "frame";
  /** Placeholder glyph: size / line height / opacity, and its colour per suit. */
  readonly suitGlyphStyle: StyleProp<TextStyle>;
  readonly suitGlyphColor: (suit: CanonicalSuit, colors: Colors) => string;

  // ── per-render state ──
  readonly pile: readonly PileCard[];
  readonly suit: CanonicalSuit;
  readonly selected?: boolean;
  readonly shakeX?: SharedValue<number>;
  readonly hintDestination?: boolean;
  /** Solitaire: this pile's top card is the hinted move's source. */
  readonly hintSource?: boolean;
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
  pile,
  suit,
  selected = false,
  shakeX,
  hintDestination = false,
  hintSource = false,
  onPress,
  dropId,
  onDrop,
}: FoundationPileProps) {
  const { colors } = useTheme();
  const { t } = useTranslation(ns);
  const { cardWidth, cardHeight } = useCardSize();
  const hasDrop = dropId !== undefined && onDrop !== undefined;
  const hinted = hintDestination || hintSource;

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
            shakeX={shakeX}
            hintHighlighted={topCardHint === "card" ? hintDestination : undefined}
            accessibilityLabel={label}
          />
        </DraggableCard>
      );
      return topCardHint === "frame" ? (
        <View style={hinted ? hintStyle : undefined}>{card}</View>
      ) : (
        card
      );
    }

    const label = t("pile.foundation.empty", { suit: t(`suit.${suit}`) });
    const pileStyle = [
      styles.empty,
      {
        borderRadius: emptyRadius,
        width: cardWidth,
        height: cardHeight,
        borderColor: hinted ? colors.bonus : selected ? colors.accent : colors.border,
        borderWidth: hinted ? hintBorderWidth : selected ? 2 : 1,
        backgroundColor: colors.background,
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
});
