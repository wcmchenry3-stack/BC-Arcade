import React from "react";
import { suitEmoji } from "../cardId";
import SvgCardFace, { type SvgCardGlyphs } from "../svgCardFace";
import { SUIT_PATHS } from "./suitPaths";
import type { CardFaceProps } from "../types";

/** Classic glyphs: the vector suit pips and the Unicode corner suits. */
const CLASSIC_GLYPHS: SvgCardGlyphs = { pipPaths: SUIT_PATHS, cornerGlyph: suitEmoji };

/** The theme-aware deck: every colour comes from the ThemeContext props PlayingCard injects. */
export default function ClassicCardFace({
  suit,
  rank,
  width,
  height,
  faceDown,
  cardBg,
  cardBgBack,
  border,
  textColor,
  redSuitColor,
}: CardFaceProps) {
  return (
    <SvgCardFace
      suit={suit}
      rank={rank}
      width={width}
      height={height}
      faceDown={faceDown}
      radius={6}
      glyphs={CLASSIC_GLYPHS}
      palette={{
        face: cardBg,
        back: cardBgBack,
        border,
        faceBorder: border,
        backGrid: border,
        backGridOpacity: 0.25,
        blackSuit: textColor,
        redSuit: redSuitColor,
      }}
    />
  );
}
