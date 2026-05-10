/**
 * Shared design-token constants that live outside ThemeContext so they
 * can be imported into screens/components without pulling the full theme.
 *
 * Matches the design-tokens policy skip pattern `theme\.[^./]+\.[jt]sx?$`,
 * which lets us keep raw color literals here instead of inlining them in
 * screen files.
 */

/** Semi-transparent black backdrop behind modal cards. */
export const MODAL_SCRIM = "rgba(0,0,0,0.5)";

/** Yacht celebration badge — gold, matching the original badge colour. */
export const BADGE_YACHT_BG = "rgba(255,215,0,0.95)";

/** Joker celebration badge — purple, for the joker variant. */
export const BADGE_JOKER_BG = "rgba(138,43,226,0.95)";

/** Dev-panel accent colour (orange). */
export const DEV_ACCENT = "rgba(255,128,0,1)";

/** Dev-panel accent colour at reduced opacity — for buttons/badges. */
export const DEV_ACCENT_DIM = "rgba(255,128,0,0.85)";

/** Dev-panel accent border. */
export const DEV_ACCENT_BORDER = "rgba(255,128,0,0.5)";

/** Semi-transparent black backdrop for the dev-panel modal. */
export const DEV_OVERLAY_BG = "rgba(0,0,0,0.7)";

/** Subtle white surface for dev-panel secondary buttons. */
export const DEV_SURFACE_SUBTLE = "rgba(255,255,255,0.08)";

/** Slightly more opaque white surface for dev-panel step buttons. */
export const DEV_SURFACE_DIM = "rgba(255,255,255,0.1)";

/** Mahjong tile face when selected — soft yellow highlight. */
export const MAHJONG_TILE_FACE_SELECTED = "#fff8c0";

/** Mahjong selected tile glow — subtle gold background. */
export const MAHJONG_GLOW_BG = "rgba(255,215,0,0.35)";

/** Mahjong selected tile glow — stronger gold shadow effect. */
export const MAHJONG_GLOW_SHADOW = "rgba(255,215,0,0.7)";

/** Mahjong hint tile glow — subtle blue background for matching free tiles. */
export const MAHJONG_HINT_GLOW_BG = "rgba(93,188,210,0.35)";

/** Mahjong hint tile glow — stronger blue shadow effect (web canvas). */
export const MAHJONG_HINT_GLOW_SHADOW = "rgba(93,188,210,0.7)";
