import type React from "react";

export type CanonicalSuit = "spades" | "hearts" | "diamonds" | "clubs";

/**
 * Props passed by PlayingCard to whichever deck renderer is active.
 * Every colour comes from the ThemeContext `colors` tokens: the face, ink and
 * red-suit colours from the card tokens (`cardFace`, `cardInk`, `cardRedSuit`,
 * #2983), the back and borders from the surface/border/accent tokens. A deck
 * may ignore colours it doesn't need (the Neon deck draws its own fixed dark
 * palette in both themes) but must stay legible in light and dark mode.
 */
export interface CardFaceProps {
  suit: CanonicalSuit;
  rank: number; // 1=A  2-10  11=J  12=Q  13=K
  width: number;
  height: number;
  faceDown: boolean;
  // ThemeContext colours injected by PlayingCard
  cardBg: string; // card face background (colors.cardFace)
  cardBgBack: string; // card back background
  border: string; // normal border colour
  borderHighlight: string; // accent border when highlighted/selected
  textColor: string; // rank text + black suits (colors.cardInk)
  redSuitColor: string; // hearts / diamonds (colors.cardRedSuit)
}

export interface DeckTheme {
  id: string;
  /** Display name — used in Settings UI. */
  name: string;
  CardFace: React.ComponentType<CardFaceProps>;
}
