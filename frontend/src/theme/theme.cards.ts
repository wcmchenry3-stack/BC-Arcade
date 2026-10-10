/**
 * Playing-card constants that no theme token covers (#2989).
 *
 * The UI ink on a card (face fill, black-suit ink, red suit) is `cardFace` / `cardInk` /
 * `cardRedSuit` in ThemeContext. What is here is fixed by design in both light and dark mode:
 * the shadow and dim scrim under any card, the selection glow, and the Neon deck's own art
 * palette (always dark, ignores the theme).
 *
 * Matches the design-tokens policy skip pattern `theme\.[^./]+\.[jt]sx?$`.
 */

/**
 * Red suit (hearts / diamonds) ink on the white card face, both themes (#3101). The card face is
 * always white, so this must be dark enough for WCAG AA text there (5.0:1), unlike `errorDark`.
 */
export const CARD_RED_SUIT = "#d32f2f";

/** Drop shadow under a card and under a card being dragged. */
export const CARD_SHADOW = "#000";

/** Dark scrim over a disabled card; it leaves the card itself opaque. */
export const CARD_DISABLED_SCRIM = "rgba(0,0,0,0.5)";

/** Selection glow of a lifted card outside the Neon deck (Neon uses `accentBright`). */
export const CARD_SELECT_GLOW = "#ffffff";

/** Neon deck: always dark, ignores ThemeContext light/dark mode. */
export const NEON_DECK = {
  face: "#0f172a",
  back: "#070d1a",
  border: "#334155",
  blackSuit: "#e2e8f0",
  redSuit: "#f43f5e",
  rank: "#f1f5f9",
  backGrid: "#06b6d4",
} as const;
