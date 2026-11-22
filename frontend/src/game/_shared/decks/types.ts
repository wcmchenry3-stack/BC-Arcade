import type React from "react";

export type CanonicalSuit = "spades" | "hearts" | "diamonds" | "clubs";

/**
 * Props passed by PlayingCard to whichever deck renderer is active.
 * The face, ink and red-suit colours come from the ThemeContext card tokens
 * (`cardFace`, `cardInk`, `cardRedSuit`, #2983); the back is `cardBack` / `cardBackInk` (#3740) on a `cardFace` margin; borders come from
 * the border/accent tokens. Colours no token covers (the card shadow,
 * disabled scrim, selection glow and the Neon deck's own fixed dark palette) are
 * constants in `theme/theme.cards.ts` (#2989). A deck may ignore colours it
 * doesn't need (the Neon deck draws `NEON_DECK` in both themes) but must stay
 * legible in light and dark mode.
 */
export interface CardFaceProps {
  suit: CanonicalSuit;
  rank: number; // 1=A  2-10  11=J  12=Q  13=K
  width: number;
  height: number;
  faceDown: boolean;
  // ThemeContext colours injected by PlayingCard
  cardBg: string; // card face background (colors.cardFace)
  cardBgBack: string; // card back field (colors.cardBack, #3740)
  /** The back's line and lattice (colors.cardBackInk). */
  cardBackInk: string;
  border: string; // normal border colour
  borderHighlight: string; // accent border when highlighted/selected
  textColor: string; // rank text + black suits (colors.cardInk)
  redSuitColor: string; // hearts / diamonds (colors.cardRedSuit)
  /**
   * Compact corner index (#3622): the card's visible stripe, in dp, when it is a covered
   * card in a compressed tableau column. The face then draws the suit beside the rank on
   * one line, inside that stripe. Omitted: the stacked index (rank, suit under it).
   */
  compactIndex?: number;
}

export interface DeckTheme {
  id: string;
  /** Display name — used in Settings UI. */
  name: string;
  CardFace: React.ComponentType<CardFaceProps>;
}
