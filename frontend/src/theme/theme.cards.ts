/**
 * Playing-card constants that no theme token covers (#2989).
 *
 * The UI ink on a card (face fill, black-suit ink, red suit) is `cardFace` / `cardInk` /
 * `cardRedSuit` in ThemeContext. What is here is fixed by design in both light and dark mode:
 * the shadow and dim scrim under any card, the selection glow, the Neon deck's own art
 * palette (always dark, ignores the theme) and `BC_DECK_ART`, the fixed art of the Arcade,
 * Parlor and Synthwave decks (#3577).
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
  border: "#334155",
  blackSuit: "#e2e8f0",
  redSuit: "#f43f5e",
  rank: "#f1f5f9",
  /** The back (#3740): a cyan margin and lattice on a navy field. */
  backRim: "#22d3ee",
  backField: "#0b1b3a",
  backLine: "#22d3ee",
  backAccent: "#22d3ee",
} as const;

/**
 * Arcade, Parlor and Synthwave decks (#3577): original in-house art drawn in SVG. Arcade and
 * Parlor take face, ink, red-suit and edge colours from the theme props like Classic; the
 * colours here are the art that is fixed in both themes (court palettes, panels, backs).
 * Synthwave keeps its own dark face in both themes (its outer edge still takes the `border`
 * prop, so highlight and hint borders work). Court palettes are [main, accent, gold].
 */
export const BC_DECK_ART = {
  /** Skin, Parlor's pale beard and the white suit mark on a court figure's chest. */
  skin: "#f1d2b6",
  beard: "#e8e1d0",
  chestMark: "#ffffff",
  arcade: {
    courtBlack: ["#16161c", "#1bc5d4", "#e2b33c"],
    courtRed: ["#c8312b", "#a34fc4", "#e2b33c"],
    panelBlack: "#e6f6f8",
    panelRed: "#fbe9e6",
    backFill: "#19191f",
    backCore: "#0e0e13",
    backCyan: "#8ff5ff",
    backViolet: "#d674ff",
  },
  parlor: {
    courtBlack: ["#1d2b5c", "#c8312b", "#e2b33c"],
    courtRed: ["#c8312b", "#1d2b5c", "#e2b33c"],
    panel: "#fbf3df",
    backPaper: "#fbf3df",
    backNavy: "#1d2b5c",
    backGold: "#e2b33c",
  },
  synthwave: {
    face: "#14141b",
    black: "#8ff5ff",
    red: "#ff5fa2",
    backNight: "#0e0e13",
    backSky: "#2a1240",
    backSun: "#d674ff",
    backGrid: "#8ff5ff",
  },
} as const;
