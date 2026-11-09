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
  /** Screen-reader hint, e.g. "Can move here" on a legal destination's top card (#3606). */
  accessibilityHint?: string;
  /** testID on the card's own Pressable/View (not a wrapper), for e2e selectors. */
  testID?: string;
  /**
   * Overlapped hands (Hearts' fan): the width of the card's left strip that takes the press, so a
   * tap lands on the visible part, not under the next card. The card still draws full size.
   * Ignored without `onPress`, or when it is not narrower than the card.
   */
  hitWidth?: number;
  /**
   * Compact corner index (#3622): the visible stripe, in dp, of a covered card in a
   * compressed tableau column; the deck draws the suit beside the rank inside it.
   */
  compactIndex?: number;
}

function PlayingCard({
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
  accessibilityHint,
  testID,
  hitWidth,
  compactIndex,
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
      compactIndex={compactIndex}
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

  if (onPress && hitWidth !== undefined && hitWidth < width) {
    // The card is drawn whole but is not itself pressable: one button covers its visible strip.
    return (
      <View style={wrapperStyle}>
        {cardFace}
        {disabledOverlay}
        <Pressable
          testID={testID}
          style={{ position: "absolute", left: 0, top: 0, width: hitWidth, height }}
          onPress={onPress}
          disabled={disabled}
          accessibilityRole="button"
          accessibilityLabel={accessibilityLabel}
          accessibilityHint={accessibilityHint}
          accessibilityState={{ disabled }}
        />
      </View>
    );
  }

  if (onPress) {
    return (
      <Pressable
        testID={testID}
        style={wrapperStyle}
        onPress={onPress}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityHint={accessibilityHint}
        accessibilityState={{ disabled }}
      >
        {cardFace}
        {disabledOverlay}
      </Pressable>
    );
  }

  return (
    <View
      testID={testID}
      style={wrapperStyle}
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
    >
      {cardFace}
      {disabledOverlay}
    </View>
  );
}

/**
 * Memoized (#2264): every prop is a primitive or a callback, so a board
 * re-render (a move, a drag start / end) skips the SVG face of every card
 * whose props didn't change. Deck and theme changes still re-render it
 * through their contexts. Pass a stable `onPress` to keep the memo useful.
 */
export default React.memo(PlayingCard);
