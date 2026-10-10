/**
 * Shared PlayingCard — layout wrapper consumed by all card games.
 *
 * Reads the active deck from CardDeckContext and the colour tokens from
 * ThemeContext, then delegates card face rendering to the deck's CardFace
 * component. Games never import deck-specific code directly.
 *
 * To swap the global deck: call setDeck() from useDeck().
 * To add a new deck: add an entry to DECK_REGISTRY — no game code changes.
 */

import React from "react";
import { Pressable, View } from "react-native";
import { useDeck } from "../../game/_shared/decks/CardDeckContext";
import { useTheme } from "../../theme/ThemeContext";
import { CARD_DISABLED_SCRIM, CARD_SHADOW } from "../../theme/theme.cards";
import type { CanonicalSuit } from "../../game/_shared/decks/types";
import { CARD_NATURAL_H, CARD_NATURAL_W } from "../../game/_shared/CardSizeContext";

export interface PlayingCardProps {
  suit: CanonicalSuit;
  rank: number;
  faceDown?: boolean;
  width?: number;
  height?: number;
  rotation?: number;
  /** Accent border (Hearts: valid play, Solitaire: selected card). */
  highlighted?: boolean;
  /** Hint border — green, distinct from the blue selection highlight. */
  hintHighlighted?: boolean;
  disabled?: boolean;
  onPress?: () => void;
  accessibilityLabel?: string;
}

export default function PlayingCard({
  suit,
  rank,
  faceDown = false,
  width = CARD_NATURAL_W,
  height = CARD_NATURAL_H,
  rotation = 0,
  highlighted = false,
  hintHighlighted = false,
  disabled = false,
  onPress,
  accessibilityLabel,
}: PlayingCardProps) {
  const { activeDeck } = useDeck();
  const { colors } = useTheme();

  const rotateStyle = rotation !== 0 ? { transform: [{ rotate: `${rotation}deg` }] } : undefined;

  const cardFace = (
    <activeDeck.CardFace
      suit={suit}
      rank={rank}
      width={width}
      height={height}
      faceDown={faceDown}
      cardBg={colors.cardFace}
      cardBgBack={colors.surfaceAlt}
      border={hintHighlighted ? colors.bonus : highlighted ? colors.accent : colors.border}
      borderHighlight={colors.accent}
      textColor={colors.cardInk}
      redSuitColor={colors.cardRedSuit}
    />
  );

  // Disabled dimming is rendered as a dark overlay on top of the card rather
  // than by lowering the wrapper's opacity. In overlapping hand layouts (e.g.
  // Hearts) translucent cards let the card underneath bleed through — the
  // overlay keeps the card itself opaque. Radius matches CardFace.
  const wrapperStyle = [
    {
      width,
      height,
      shadowColor: CARD_SHADOW,
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.2,
      shadowRadius: 4,
      elevation: 2,
    },
    rotateStyle,
  ];
  const disabledOverlay = disabled ? (
    <View
      pointerEvents="none"
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width,
        height,
        borderRadius: 6,
        backgroundColor: CARD_DISABLED_SCRIM,
      }}
    />
  ) : null;

  if (onPress) {
    return (
      <Pressable
        style={wrapperStyle}
        onPress={onPress}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityState={{ disabled }}
      >
        {cardFace}
        {disabledOverlay}
      </Pressable>
    );
  }

  return (
    <View style={wrapperStyle} accessibilityRole="image" accessibilityLabel={accessibilityLabel}>
      {cardFace}
      {disabledOverlay}
    </View>
  );
}
