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

/** Ivory tile face, and the slightly warmer face of a tile that is not free. A light shade:
 *  #3612's darker face and 20% tint read as faded, washed-out tiles on iOS (#3684), so the
 *  owner picked this lighter look; free tiles still stand out, and the art stays clear. */
export const MAHJONG_TILE_FACE = "#f5f0e8";
export const MAHJONG_TILE_FACE_LOCKED = "#f1eadd";
/** A faint warm shade over a locked tile's face and art (#3612, lightened in #3684). */
export const MAHJONG_LOCK_TINT = "rgba(40,30,15,0.08)";

/** Tile outline: resting, and selected (gold). The gold also colours the
 *  shuffle button and the flying-pair frame. */
export const MAHJONG_BORDER_NORMAL = "#8b7355";
export const MAHJONG_BORDER_SELECTED = "#ffd700";

/** The tile's right and bottom edges: bone (the back), with an ivory band next to the face
 *  (#3612, "classic" depth). */
export const MAHJONG_SIDE_R = "#c8b48a";
export const MAHJONG_SIDE_B = "#a98f66";
export const MAHJONG_SIDE_IVORY = "#ece3cf";

/** The soft shadow a tile casts onto the layer below (#3612). */
export const MAHJONG_TILE_SHADOW = "rgba(0,0,0,0.38)";
/** Web: the near-invisible fill that casts the tile shadow (the canvas draws a shadow only under a fill). */
export const MAHJONG_SHADOW_CASTER = "rgba(0,0,0,0.01)";
/** #3613: the locked tiles' brief dim at a deadlock (its opacity animates). */
export const MAHJONG_DEADLOCK_DIM = "rgba(20,14,6,0.45)";
/** #3613: match-burst and win-cascade sparks. */
export const MAHJONG_SPARK = "#ffd76a";

/** The mini-map (#3612): its panel, the tiles on it, and the frame of the view on screen. */
export const MAHJONG_MINIMAP_BG = "rgba(10,20,10,0.72)";
export const MAHJONG_MINIMAP_TILE = "#e8dfcc";
export const MAHJONG_MINIMAP_WINDOW = "#ffd700";

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

/** @alias */
export const MAHJONG_FP_FACE = MAHJONG_TILE_FACE;
/** @alias */
export const MAHJONG_FP_BORDER = MAHJONG_BORDER_SELECTED;
/** @alias */
export const MAHJONG_FP_SIDE_R = MAHJONG_SIDE_R;
/** @alias */
export const MAHJONG_FP_SIDE_B = MAHJONG_SIDE_B;

/**
 * Shuffle button in the HUD — the same gold as a selected tile.
 * @alias
 */
export const MAHJONG_SHUFFLE_COLOR = MAHJONG_BORDER_SELECTED;
