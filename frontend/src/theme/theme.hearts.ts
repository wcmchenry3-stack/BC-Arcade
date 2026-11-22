/**
 * Hearts colours that no shared token covers: the card table's felt and the three moments
 * (#3588). The moments are drawn over the felt in both light and dark mode and carry their own
 * contrast, so they do not follow the theme.
 *
 * Matches the design-tokens policy skip pattern `theme\.[^./]+\.[jt]sx?$`.
 */

/**
 * The Queen of Spades moment: a purple-dark radial scrim (`CENTRE` fully transparent, `EDGE`
 * at `HEARTS_QUEEN_SCRIM_EDGE_OPACITY`), the magenta glow and gong rings, and a lilac caption.
 */
export const HEARTS_QUEEN_SCRIM_CENTRE = "#280a3c";
export const HEARTS_QUEEN_SCRIM_EDGE = "#0e0018";
export const HEARTS_QUEEN_SCRIM_EDGE_OPACITY = 0.78;
export const HEARTS_QUEEN_GLOW = "#d674ff";
export const HEARTS_QUEEN_CAPTION = "#e9c8ff";

/** Hearts broken: the heart, the crack drawn through it, the red edge pulse and the caption. */
export const HEARTS_BROKEN_HEART = "#d0342c";
export const HEARTS_BROKEN_CRACK = "#ffffff";
export const HEARTS_BROKEN_EDGE = "#d0342c";
export const HEARTS_BROKEN_EDGE_OPACITY = 0.4;
export const HEARTS_BROKEN_CAPTION = "#ff9a92";

/**
 * The moon shot: a night sky (top, middle at 55 %, bottom), stars, the moon (a radial
 * gradient from `LIGHT` near its upper left through `MID` to `RIM`, with a soft `GLOW`), the
 * hill and wolves in one silhouette colour, and the two captions (`TITLE` with a `TITLE_GLOW`).
 */
export const HEARTS_MOON_SKY_TOP = "#060814";
export const HEARTS_MOON_SKY_MID = "#0b1030";
export const HEARTS_MOON_SKY_BOTTOM = "#121a3f";
export const HEARTS_MOON_STAR = "#ffffff";
export const HEARTS_MOON_LIGHT = "#fffbe8";
export const HEARTS_MOON_MID = "#f3e7b6";
export const HEARTS_MOON_RIM = "#d9c98a";
export const HEARTS_MOON_GLOW = "#fff4c8";
export const HEARTS_MOON_SILHOUETTE = "#05060d";
export const HEARTS_MOON_TITLE = "#fff7d6";
export const HEARTS_MOON_TITLE_GLOW = "#fff0b499";
export const HEARTS_MOON_PENALTY = "#cfd6ff";

/**
 * The card table's felt (#3587): green in both light and dark mode, so the cards and the
 * plates read the same everywhere. A vertical gradient from `CENTRE` (top) to `EDGE`
 * (bottom) inside a `BORDER` rim; React Native has no radial gradient.
 */
export const HEARTS_FELT_CENTRE = "#16322c";
export const HEARTS_FELT_EDGE = "#0f201c";
export const HEARTS_FELT_BORDER = "#22433b";
