/**
 * The chain counter's glyphs (#3701): "×" and the digits 0-9 as centre-line paths, drawn in code
 * (owner rule: no font or art files). The board strokes each twice, a thick outline in the
 * chain's tone and a thinner white fill, with round caps and joins, so the counter reads as bold
 * rounded lettering on every platform without loading a typeface on the UI thread.
 *
 * Em box: x 0..0.56, y -0.5..0.5 (y down), advance `CHAIN_GLYPH_ADVANCE`. Built once per board on
 * the JS thread (`buildChainGlyphs`), then only drawn.
 */
import { Skia } from "@shopify/react-native-skia";
import type { ChainGlyphs } from "./drawMotion";

export const CHAIN_GLYPH_ADVANCE = 0.62;

export const CHAIN_GLYPH_SVG = {
  times: "M 0.1 -0.18 L 0.46 0.18 M 0.46 -0.18 L 0.1 0.18",
  digits: [
    "M 0.28 -0.42 C 0.53 -0.42 0.53 0.42 0.28 0.42 C 0.03 0.42 0.03 -0.42 0.28 -0.42 Z",
    "M 0.12 -0.24 L 0.32 -0.42 L 0.32 0.42",
    "M 0.07 -0.22 C 0.1 -0.5 0.5 -0.48 0.48 -0.2 C 0.46 0 0.2 0.18 0.07 0.42 L 0.5 0.42",
    "M 0.07 -0.34 C 0.28 -0.5 0.56 -0.36 0.44 -0.14 C 0.38 -0.04 0.3 -0.02 0.22 -0.02 C 0.52 -0.02 0.56 0.3 0.36 0.4 C 0.24 0.46 0.12 0.42 0.05 0.34",
    "M 0.38 0.42 L 0.38 -0.42 L 0.05 0.16 L 0.52 0.16",
    "M 0.48 -0.42 L 0.14 -0.42 L 0.1 -0.04 C 0.3 -0.14 0.52 -0.04 0.5 0.16 C 0.48 0.42 0.2 0.48 0.06 0.34",
    "M 0.44 -0.4 C 0.2 -0.42 0.08 -0.16 0.08 0.12 C 0.08 0.36 0.2 0.42 0.3 0.42 C 0.44 0.42 0.5 0.3 0.5 0.18 C 0.5 0.02 0.38 -0.06 0.28 -0.06 C 0.18 -0.06 0.1 0 0.08 0.1",
    "M 0.06 -0.42 L 0.5 -0.42 L 0.22 0.42",
    "M 0.28 -0.02 C 0.06 -0.02 0.06 -0.42 0.28 -0.42 C 0.5 -0.42 0.5 -0.02 0.28 -0.02 C 0.02 -0.02 0.02 0.42 0.28 0.42 C 0.54 0.42 0.54 -0.02 0.28 -0.02 Z",
    "M 0.12 0.4 C 0.36 0.42 0.48 0.16 0.48 -0.12 C 0.48 -0.36 0.36 -0.42 0.26 -0.42 C 0.12 -0.42 0.06 -0.3 0.06 -0.18 C 0.06 -0.02 0.18 0.06 0.28 0.06 C 0.38 0.06 0.46 0 0.48 -0.1",
  ],
} as const;

/** The glyphs as Skia paths, or null when Skia cannot parse them (the counter is then skipped). */
export function buildChainGlyphs(): ChainGlyphs | null {
  try {
    const times = Skia.Path.MakeFromSVGString(CHAIN_GLYPH_SVG.times);
    const digits = CHAIN_GLYPH_SVG.digits.map((d) => Skia.Path.MakeFromSVGString(d));
    if (!times || digits.some((d) => !d)) return null;
    return {
      times,
      digits: digits as NonNullable<(typeof digits)[number]>[],
      advance: CHAIN_GLYPH_ADVANCE,
    };
  } catch {
    return null;
  }
}
