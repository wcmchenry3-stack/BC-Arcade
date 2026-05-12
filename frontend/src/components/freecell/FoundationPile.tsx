import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { useTheme } from "../../theme/ThemeContext";
import { rankLabel } from "../../game/_shared/decks/cardId";
import SelectableCard from "../../game/_shared/SelectableCard";
import type { CanonicalSuit } from "../../game/_shared/decks/types";
import type { Card, Suit } from "../../game/freecell/types";
import { useCardSize } from "../../game/_shared/CardSizeContext";
import { DropTarget } from "../../game/_shared/drag/DropTarget";
import type { DropHandler } from "../../game/_shared/drag/DragContext";
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
  readonly hintDestination?: boolean;
  readonly onPress?: (suit: Suit) => void;
  readonly dropId?: string;
  readonly onDrop?: DropHandler;
}

export default function FoundationPile({
  pile,
  suit,
  selected = false,
  shakeX,
  hintDestination = false,
  onPress,
  dropId,
  onDrop,
}: FoundationPileProps) {
  const { colors } = useTheme();
  const { t } = useTranslation("freecell");
  const { cardWidth, cardHeight } = useCardSize();
  const hasDrop = dropId !== undefined && onDrop !== undefined;
  const RED_SUITS = new Set(["hearts", "diamonds"]);
  const suitSymbolColor = RED_SUITS.has(suit) ? "#ff716c" : colors.textFilled;

  const inner = (() => {
    if (pile.length > 0) {
      const top = pile[pile.length - 1];
      if (top !== undefined) {
        const rl = rankLabel(top.rank);
        const suitName = t(`suit.${top.suit}` as const);
        const label = selected
          ? t("card.selected", { rank: rl, suit: suitName })
          : t("card.label", { rank: rl, suit: suitName });
        return (
          <SelectableCard
            suit={top.suit as CanonicalSuit}
            rank={top.rank}
            width={cardWidth}
            height={cardHeight}
            selected={selected}
            shakeX={shakeX}
            hintHighlighted={hintDestination}
            onPress={onPress ? () => onPress(suit) : undefined}
            accessibilityLabel={label}
          />
        );
      }
    }

    const label = t("pile.foundation.empty", { suit: t(`suit.${suit}` as const) });
    const pileStyle = [
      styles.empty,
      {
        width: cardWidth,
        height: cardHeight,
        borderColor: hintDestination ? colors.bonus : selected ? colors.accent : colors.border,
        borderWidth: hintDestination || selected ? 2 : 1,
        backgroundColor: colors.background,
      },
    ];
    const content = (
      <Text style={[styles.suit, { color: suitSymbolColor }]}>{SUIT_SYMBOL[suit]}</Text>
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
      <DropTarget
        id={dropId!}
        onDrop={onDrop!}
        highlightStyle={{ borderColor: colors.accent, borderWidth: 2, borderRadius: 6 }}
        dimStyle={{ opacity: 0.4 }}
      >
        {inner}
      </DropTarget>
    );
  }
  return inner;
}

const styles = StyleSheet.create({
  empty: {
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  suit: {
    fontSize: 18,
    lineHeight: 22,
    opacity: 0.75,
  },
});
