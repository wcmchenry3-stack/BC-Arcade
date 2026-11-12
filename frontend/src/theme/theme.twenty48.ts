/**
 * 2048 palette (#3688): a flat, high-contrast tile ladder, one colour for every value from 2 to
 * 131072 (2^1 .. 2^17, the most a 4 x 4 board can hold), replacing the neon-glow look.
 *
 * - Every tile is a solid fill with one of two text colours, picked so the number clears WCAG AA
 *   (4.5:1) on it. The ladder is the game's own meaning, so it is the same in light and dark mode.
 * - Neighbours differ in hue or in lightness, and none is close to an empty slot: the slot has its
 *   own colour per theme (`TWENTY48_SLOT`), chosen against the ladder (the old 2 tile was the slot).
 * - Only the 2048+ tiles glow (`TWENTY48_TOP_TILE_GLOW`); the rest are flat.
 *
 * `twenty48/__tests__/tileStyles.test.ts` checks distinctness, the 4.5:1 text contrast and the
 * slot distance, so a changed colour that breaks one fails there. Matches the design-tokens policy
 * skip pattern `theme\.[^./]+\.[jt]sx?$`.
 */

/** Dark number text, for the light tiles. */
export const TWENTY48_TEXT_DARK = "#14141a";

/** Light number text, for the dark tiles. */
export const TWENTY48_TEXT_LIGHT = "#ffffff";

export interface TileColors {
  readonly bg: string;
  readonly text: string;
}

/** The tile ladder, by value. */
export const TWENTY48_TILES: Readonly<Record<number, TileColors>> = {
  2: { bg: "#f4ede0", text: TWENTY48_TEXT_DARK },
  4: { bg: "#e9d5a6", text: TWENTY48_TEXT_DARK },
  8: { bg: "#f4a259", text: TWENTY48_TEXT_DARK },
  16: { bg: "#ee7b30", text: TWENTY48_TEXT_DARK },
  32: { bg: "#e5533d", text: TWENTY48_TEXT_DARK },
  64: { bg: "#c2255c", text: TWENTY48_TEXT_LIGHT },
  128: { bg: "#f5e463", text: TWENTY48_TEXT_DARK },
  256: { bg: "#b5d334", text: TWENTY48_TEXT_DARK },
  512: { bg: "#35b05a", text: TWENTY48_TEXT_DARK },
  1024: { bg: "#12908e", text: TWENTY48_TEXT_DARK },
  2048: { bg: "#ffa800", text: TWENTY48_TEXT_DARK },
  4096: { bg: "#2cb8e8", text: TWENTY48_TEXT_DARK },
  8192: { bg: "#2f6bdb", text: TWENTY48_TEXT_LIGHT },
  16384: { bg: "#5b47c9", text: TWENTY48_TEXT_LIGHT },
  32768: { bg: "#a040c8", text: TWENTY48_TEXT_LIGHT },
  65536: { bg: "#e0509a", text: TWENTY48_TEXT_DARK },
  131072: { bg: "#7b1730", text: TWENTY48_TEXT_LIGHT },
};

/** The largest value a 4 x 4 board can reach; anything above it (not reachable) uses its colours. */
export const TWENTY48_MAX_TILE = 131072;

/** The empty slots, by theme: each is well away from every tile in `TWENTY48_TILES`. */
export const TWENTY48_SLOT = {
  dark: "#2d2d38",
  light: "#b8aa8a",
} as const;

/** The glow and ring on the 2048+ tiles, the only ones that have one. */
export const TWENTY48_TOP_TILE_GLOW = "#ffd36a";

/** The first value that gets the glow. */
export const TWENTY48_GLOW_FROM = 2048;
