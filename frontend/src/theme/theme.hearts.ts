/**
 * Hearts event-animation colours that no shared token covers.
 *
 * These overlays are drawn over the felt in both light and dark mode and carry
 * their own contrast (a white card with indigo ink; gold stars on black), so
 * they do not follow the theme. The shared semantic red for "hearts broken" and
 * the queen of spades is `colors.error`, not a constant here.
 *
 * Matches the design-tokens policy skip pattern `theme\.[^./]+\.[jt]sx?$`.
 */

/** Queen of spades card in the "queen taken" animation: white face, indigo ink. */
export const HEARTS_QUEEN_CARD_FACE = "#ffffff";
export const HEARTS_QUEEN_INK = "#1e1b4b";
export const HEARTS_QUEEN_SHADOW = "#000000";

/** Moon shot celebration: black backdrop, amber stars, white caption. */
export const HEARTS_MOONSHOT_BACKDROP = "#000000";
export const HEARTS_MOONSHOT_STAR = "#fbbf24";
export const HEARTS_MOONSHOT_LABEL = "#ffffff";

/** Soft shadow under an opponent's fanned hand. */
export const HEARTS_HAND_SHADOW = "#000";
