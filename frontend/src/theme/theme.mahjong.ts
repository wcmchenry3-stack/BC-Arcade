/**
 * Mahjong palette — every colour the board canvases, the flying-pair animation
 * and the screen draw with, in one place.
 *
 * The native (Skia) and web (2D canvas) renderers both import from here, so the
 * two cannot drift apart (the native board once did: "#1a3a1a" vs the web
 * "#2d3d2d"). The tile art is a physical object (ivory face, wooden sides), so
 * none of these change with the light/dark theme.
 *
 * Matches the design-tokens policy skip pattern `theme\.[^./]+\.[jt]sx?$`.
 */

/** Mahjong board background — desaturated sage green (hsl 120 15% 21%).
 *  Reduced saturation vs. the original #1a3a1a to lower chromatic contrast
 *  against white tile faces during long play sessions. */
export const MAHJONG_BOARD_BG = "#2d3d2d";

/** Mahjong tile face when selected — soft yellow highlight. */
export const MAHJONG_TILE_FACE_SELECTED = "#fff8c0";

/** Mahjong selected tile glow — subtle gold background. */
export const MAHJONG_GLOW_BG = "rgba(255,215,0,0.35)";

/** Mahjong selected tile glow — stronger gold shadow effect. */
export const MAHJONG_GLOW_SHADOW = "rgba(255,215,0,0.7)";

/** Mahjong hint tile accent colour — used for borders, text, and glow tints. */
export const MAHJONG_HINT_COLOR = "#5dbcd2";

/** Mahjong hint tile glow — blue background for matching free tiles. */
export const MAHJONG_HINT_GLOW_BG = "rgba(93,188,210,0.65)";

/** Mahjong hint tile glow — blue shadow effect (web canvas). */
export const MAHJONG_HINT_GLOW_SHADOW = "rgba(93,188,210,0.9)";

/** Mahjong "no moves" overlay scrim. */
export const MAHJONG_NO_MOVES_OVERLAY_BG = "rgba(0,0,0,0.72)";

/** Mahjong overlay action button — dark green, used by the no-moves prompt. */
export const MAHJONG_OVERLAY_BTN_BG = "#2a7a2a";

/** "No moves" overlay title and button label, and the lighter detail line. */
export const MAHJONG_OVERLAY_TEXT = "#ffffff";
export const MAHJONG_OVERLAY_DETAIL_TEXT = "#cccccc";

// ---------------------------------------------------------------------------
// Tile
// ---------------------------------------------------------------------------

/** Ivory tile face, and the dimmer face of a tile that is not free. */
export const MAHJONG_TILE_FACE = "#f5f0e8";
export const MAHJONG_TILE_FACE_LOCKED = "#d0c8b8";

/** Tile outline: resting, and selected (gold). The gold also colours the
 *  shuffle button and the flying-pair frame. */
export const MAHJONG_BORDER_NORMAL = "#8b7355";
export const MAHJONG_BORDER_SELECTED = "#ffd700";

/** The tile's right and bottom edges — the wooden thickness. */
export const MAHJONG_SIDE_R = "#a89070";
export const MAHJONG_SIDE_B = "#987860";

/** Drop shadow under a tile. */
export const MAHJONG_TILE_SHADOW = "rgba(0,0,0,0.35)";

/** Placeholder tint shown over a face while its bitmap is still loading. */
export const MAHJONG_FACE_LOADING = "#00cc44";

/** Suit-colour placeholder for a face whose bitmap is not cached yet. */
export const MAHJONG_SUIT_COLOR: Readonly<Record<string, string>> = {
  characters: "#cc0000",
  circles: "#006633",
  bamboos: "#003322",
  winds: "#334455",
  dragons: "#880011",
  flowers: "#aa2299",
  seasons: "#0044aa",
};

/** Placeholder for a suit missing from `MAHJONG_SUIT_COLOR`. */
export const MAHJONG_SUIT_FALLBACK = "#888888";

// ---------------------------------------------------------------------------
// Flying pair — "colours that match the canvas tile rendering"
// ---------------------------------------------------------------------------

export const MAHJONG_FP_FACE = MAHJONG_TILE_FACE;
export const MAHJONG_FP_BORDER = MAHJONG_BORDER_SELECTED;
export const MAHJONG_FP_SIDE_R = MAHJONG_SIDE_R;
export const MAHJONG_FP_SIDE_B = MAHJONG_SIDE_B;

/** Shuffle button in the HUD — the same gold as a selected tile. */
export const MAHJONG_SHUFFLE_COLOR = MAHJONG_BORDER_SELECTED;
