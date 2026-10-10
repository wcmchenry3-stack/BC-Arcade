import React from "react";
import { suitEmoji } from "../cardId";
import { SUIT_PATHS } from "../classic/suitPaths";
import SvgCardFace, { type SvgCardGlyphs, type SvgCardPalette } from "../svgCardFace";
import type { CardFaceProps } from "../types";
import { NEON_DECK } from "../../../../theme/theme.cards";

// Neon palette — always dark, ignores ThemeContext light/dark mode.
const BG = NEON_DECK.face;
const BG_BACK = NEON_DECK.back;
const BORDER = NEON_DECK.border;
const SPADES_CLUBS = NEON_DECK.blackSuit;
const HEARTS = NEON_DECK.redSuit;
const RANK_TEXT = NEON_DECK.rank;
const BACK_GRID = NEON_DECK.backGrid;

/** Neon glyphs: today the same vector pips and Unicode corner suits as Classic. */
const NEON_GLYPHS: SvgCardGlyphs = { pipPaths: SUIT_PATHS, cornerGlyph: suitEmoji };

const PALETTE: Omit<SvgCardPalette, "faceBorder"> = {
  face: BG,
  back: BG_BACK,
  border: BORDER,
  backGrid: BACK_GRID,
  backGridOpacity: 0.35,
  blackSuit: SPADES_CLUBS,
  redSuit: HEARTS, // hearts and diamonds
  rank: RANK_TEXT,
};

export default function NeonCardFace({
  suit,
  rank,
  width,
  height,
  faceDown,
  borderHighlight,
}: CardFaceProps) {
  return (
    <SvgCardFace
      suit={suit}
      rank={rank}
      width={width}
      height={height}
      faceDown={faceDown}
      radius={8}
      glyphs={NEON_GLYPHS}
      glowFilter="neon-glow"
      palette={{ ...PALETTE, faceBorder: borderHighlight ?? BORDER }}
    />
  );
}
