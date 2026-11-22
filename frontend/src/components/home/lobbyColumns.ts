/** Below this viewport width the lobby grid collapses to a single column. */
export const SINGLE_COL_BREAKPOINT = 360;
/** From this width the lobby uses 3 columns (tablet portrait / small split view). */
export const THREE_COL_BREAKPOINT = 700;
/** From this width the lobby uses 4 columns (tablet landscape / large windows). */
export const FOUR_COL_BREAKPOINT = 1000;

/**
 * Height (pt) of the icon slot at the top of every lobby tile. Every tile's 64 pt scene
 * (`cardArt`, #4011-#4013) is centred in it.
 */
export const TILE_ICON_ZONE = 68;

/** How many tile columns the lobby shows at a given window width (#4005). */
export function lobbyColumns(width: number): 1 | 2 | 3 | 4 {
  if (width < SINGLE_COL_BREAKPOINT) return 1;
  if (width < THREE_COL_BREAKPOINT) return 2;
  if (width < FOUR_COL_BREAKPOINT) return 3;
  return 4;
}

/** Lobby tile type sizes in pt (#4006). Nothing in a tile is below 11 pt. */
export const LOBBY_TITLE_SIZE = 16;
export const LOBBY_TITLE_LINE_HEIGHT = 20;
export const LOBBY_DESCRIPTION_SIZE = 12;
export const LOBBY_DESCRIPTION_LINE_HEIGHT = 16;
export const LOBBY_BUTTON_SIZE = 13;
/** Description lines every tile reserves at the default font scale (#431, #4005). */
export const LOBBY_DESCRIPTION_LINES = 3;
/**
 * Description lines reserved once text is enlarged. Measured in Manrope at the 1.5x cap in the
 * narrowest two-column tile (360 pt): the longest translations (de, he, ja, ko, pt, ru) need 5.
 * Pinned by e2e/tests/lobby-tile-text-fit.spec.ts.
 */
export const LOBBY_DESCRIPTION_LINES_LARGE = 5;

/**
 * Cap on how far the system font scale (iOS Dynamic Type, Android font size) may grow tile text.
 * Applied as `maxFontSizeMultiplier` on every tile Text; the reserved heights use the same cap.
 */
export const LOBBY_MAX_FONT_SCALE = 1.5;

/**
 * Title and description room for a tile at the given system font scale (#4006). Heights are
 * minimums that scale with the text, never fixed points, rounded up to whole points so Android's
 * per-line rounding cannot make a row uneven. The title takes one line at the default size and
 * two once text is enlarged (it wraps rather than truncates); the description three lines, five
 * once text is enlarged. Every tile in a row reserves the same, so rows stay level.
 */
export function lobbyTileTextSizing(fontScale: number): {
  titleLines: 1 | 2;
  titleMinHeight: number;
  descriptionLines: 3 | 5;
  descriptionMinHeight: number;
} {
  const scale = Math.min(Math.max(fontScale || 1, 1), LOBBY_MAX_FONT_SCALE);
  const large = scale > 1;
  const titleLines = large ? 2 : 1;
  const descriptionLines = large ? LOBBY_DESCRIPTION_LINES_LARGE : LOBBY_DESCRIPTION_LINES;
  return {
    titleLines,
    titleMinHeight: Math.ceil(LOBBY_TITLE_LINE_HEIGHT * titleLines * scale),
    descriptionLines,
    descriptionMinHeight: Math.ceil(LOBBY_DESCRIPTION_LINE_HEIGHT * descriptionLines * scale),
  };
}
