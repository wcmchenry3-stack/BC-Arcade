/**
 * FoundationPile (#595) — one of four suit-specific foundation slots.
 *
 * Stateless. Shows the top card if the pile is non-empty; otherwise a
 * placeholder with the expected suit symbol in `colors.textMuted` — this
 * is how the player identifies which foundation is for which suit.
 */

import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { useTheme } from "../../../theme/ThemeContext";
import type { Card, Suit } from "../types";
import { useCardSize } from "../../_shared/CardSizeContext";
import type { CanonicalSuit } from "../../_shared/decks/types";
import { rankLabel } from "../../_shared/decks/cardId";
import SelectableCard from "../../_shared/SelectableCard";
import { DropTarget } from "../../_shared/drag/DropTarget";
import type { DropHandler } from "../../_shared/drag/DragContext";
import type { SharedValue } from "react-native-reanimated";

const SUIT_SYMBOL: Record<Suit, string> = {
  spades: "♠",
  hearts: "♥",
  diamonds: "♦",
  clubs: "♣",
};

export interface FoundationPileProps {
  readonly pile: readonly Card[];
  readonly suit: Suit;
  readonly selected?: boolean;
  readonly shakeX?: SharedValue<number>;
  readonly onPress?: (suit: Suit) => void;
  /** Unique drop-zone ID, e.g. "solitaire-foundation-spades". */
  readonly dropId?: string;
  readonly onDrop?: DropHandler;
}

export default function FoundationPile({
  pile,
  suit,
  selected = false,
  shakeX,
  onPress,
  dropId,
  onDrop,
}: FoundationPileProps) {
  const { colors } = useTheme();
  const { t } = useTranslation("solitaire");
  const { cardWidth, cardHeight } = useCardSize();
  const hasDrop = dropId !== undefined && onDrop !== undefined;

  const highlightStyle = { borderColor: colors.accent, borderWidth: 2, borderRadius: 8 };
  const dimStyle = { opacity: 0.4 };

  const inner = (() => {
    if (pile.length > 0) {
      const top = pile[pile.length - 1];
      if (top !== undefined) {
        const rl = rankLabel(top.rank);
        const suitName = t(`suit.${top.suit}` as const);
        const cardLabel = selected
          ? t("card.faceUpSelected", { rank: rl, suit: suitName })
          : t("card.faceUp", { rank: rl, suit: suitName });
        return (
          <SelectableCard
            suit={top.suit as CanonicalSuit}
            rank={top.rank}
            width={cardWidth}
            height={cardHeight}
            selected={selected}
            shakeX={shakeX}
            onPress={onPress ? () => onPress(suit) : undefined}
            accessibilityLabel={cardLabel}
          />
        );
      }
    }

    const label = t("pile.foundation.empty", { suit: t(`suit.${suit}` as const) });
    const style = [
      styles.empty,
      {
        width: cardWidth,
        height: cardHeight,
        borderColor: selected ? colors.accent : colors.border,
        borderWidth: selected ? 2 : 1,
        backgroundColor: colors.background,
      },
    ];
    const content = (
      <Text style={[styles.suit, { color: colors.textMuted }]}>{SUIT_SYMBOL[suit]}</Text>
    );

    if (onPress) {
      return (
        <Pressable
          onPress={() => onPress(suit)}
          style={style}
          accessibilityRole="button"
          accessibilityLabel={label}
        >
          {content}
        </Pressable>
      );
    }
    return (
      <View style={style} accessibilityRole="image" accessibilityLabel={label}>
        {content}
      </View>
    );
  })();

  if (hasDrop) {
    return (
      <DropTarget id={dropId!} onDrop={onDrop!} highlightStyle={highlightStyle} dimStyle={dimStyle}>
        {inner}
      </DropTarget>
    );
  }

  return inner;
}

const styles = StyleSheet.create({
  empty: {
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  suit: {
    fontSize: 32,
    lineHeight: 36,
  },
});
