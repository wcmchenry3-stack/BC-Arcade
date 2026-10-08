import React from "react";
import { suitEmoji } from "../cardId";
import { SUIT_PATHS } from "../classic/suitPaths";
import SvgCardFace, { type SvgCardGlyphs, type SvgCardPalette } from "../svgCardFace";
import type { CardFaceProps } from "../types";

// Neon palette — always dark, ignores ThemeContext light/dark mode.
const BG = "#0f172a";
const BG_BACK = "#070d1a";
const BORDER = "#334155";
const SPADES_CLUBS = "#e2e8f0";
const HEARTS = "#f43f5e";
const RANK_TEXT = "#f1f5f9";
const BACK_GRID = "#06b6d4";

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
