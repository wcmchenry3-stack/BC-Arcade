/**
 * Shared design-token constants that live outside ThemeContext so they
 * can be imported into screens/components without pulling the full theme.
 *
 * Matches the design-tokens policy skip pattern `theme\.[^./]+\.[jt]sx?$`,
 * which lets us keep raw color literals here instead of inlining them in
 * screen files.
 */

/** Yacht celebration badge — gold, matching the original badge colour. */
export const BADGE_YACHT_BG = "rgba(255,215,0,0.95)";

/** Joker celebration badge — purple, for the joker variant. */
export const BADGE_JOKER_BG = "rgba(138,43,226,0.95)";

/** AppHeader logo tile backdrop — deep purple behind the transparent logo PNG
 *  in both themes. */
export const LOGO_TILE_BG = "#1a0a2e";

/** Native shadow colour for floating menus (AppHeader ⋯ dropdown). */
export const MENU_SHADOW_COLOR = "#000000";

/** Web drop shadow for the AppHeader ⋯ dropdown (the native shadow uses
 *  `MENU_SHADOW_COLOR`). */
export const MENU_SHADOW_CSS = "0 8px 24px rgba(0,0,0,0.5)";

/** Gold of the FreeCell foundation and Solitaire sparkles: bright in both themes.
 *  `colors.celebration` is darkened in light mode so it can be text; a sparkle
 *  fill must stay gold, so it does not use it. */
export const CELEBRATION_SPARKLE = "#ffd700";

/** Yacht celebration badge text — near-black on the gold / purple badge. */
export const BADGE_TEXT = "#1a1a1a";

/** Yacht scorecard row glow: upper section (cyan) and lower section (purple). */
export const SCORE_ROW_GLOW_UPPER = "rgba(143,245,255,0.45)";
export const SCORE_ROW_GLOW_LOWER = "rgba(214,116,255,0.45)";

/** Blackjack HUD warning amber — chips below 30% of the starting stack. */
export const BLACKJACK_CHIPS_LOW = "#ffb547";

/** 2048 board drop shadow: web `boxShadow`, and the native `shadowColor`. */
export const TWENTY48_BOARD_SHADOW_CSS = "0 8px 40px #00000099";
export const TWENTY48_BOARD_SHADOW_COLOR = "#000";

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

/** Dev-panel section headers ("── Section ──"). */
export const DEV_ACCENT_MUTED = "rgba(255,128,0,0.7)";

/** Dev-panel primary button at 90% (Daily Word's Reset Game). */
export const DEV_ACCENT_STRONG = "rgba(255,128,0,0.9)";

/** Softer accent border — Star Swarm's side panel edge. */
export const DEV_ACCENT_BORDER_SOFT = "rgba(255,128,0,0.4)";

/** Selected dev chip (Star Swarm's dev difficulty) — fill and border. */
export const DEV_ACCENT_SELECTED_BG = "rgba(255,128,0,0.3)";
export const DEV_ACCENT_SELECTED_BORDER = "rgba(255,128,0,0.8)";

/** Switched-on dev toggle fill (Mahjong's free-tile overlay). */
export const DEV_ACCENT_ACTIVE_BG = "rgba(255,128,0,0.2)";

/** Dev side panels drawn over a live game: Star Swarm (darker) and Mahjong. */
export const DEV_SIDEBAR_BG = "rgba(0,0,0,0.88)";
export const DEV_SIDEBAR_BG_LIGHT = "rgba(0,0,0,0.82)";

/** Faintest white dev surfaces — Daily Word's API log rows, Star Swarm's tier chips. */
export const DEV_SURFACE_FAINTEST = "rgba(255,255,255,0.05)";
export const DEV_SURFACE_FAINT = "rgba(255,255,255,0.07)";

/** Thin white border for unselected dev chips. */
export const DEV_SURFACE_BORDER = "rgba(255,255,255,0.15)";

/** Dev-panel secondary text on dark surfaces, from most to least prominent. */
export const DEV_TEXT_SECONDARY = "rgba(255,255,255,0.7)";
export const DEV_TEXT_DIM = "rgba(255,255,255,0.55)";
export const DEV_TEXT_FAINT = "rgba(255,255,255,0.5)";

/** Dev-panel caution text (Daily Word's rate-limit note). */
export const DEV_WARNING_TEXT = "rgba(255,200,0,0.7)";

/** Star Swarm dev power-up buttons — gold fill and border. */
export const DEV_GOLD_BG = "rgba(255,200,0,0.15)";
export const DEV_GOLD_BORDER = "rgba(255,200,0,0.4)";

/** Daily Word dev API log status badge — failed and succeeded calls. */
export const DEV_STATUS_ERROR_BG = "rgba(255,60,60,0.2)";
export const DEV_STATUS_OK_BG = "rgba(60,200,60,0.2)";
