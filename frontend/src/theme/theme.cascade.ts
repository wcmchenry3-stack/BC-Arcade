/**
 * Cascade palette (#2989 pattern, #3693): the colours Cascade draws with that are not theme
 * tokens, in one place.
 *
 * Two groups: the lid and danger-state colours (`CASCADE_LID_PALETTE`, #3694), and the
 * placeholder piece colours. The piece colours are drawn as plain circles by the
 * screen when a tier has no decoded sprite yet, and as the swatches in the dev panel, so they
 * are debug colours, not art: the shipped look is the active fruit set's sprites
 * (`theme/fruitSets.ts`). Do not use them for UI.
 *
 * Matches the design-tokens policy skip pattern `theme\.[^./]+\.[jt]sx?$`.
 */

/**
 * Debug-only placeholder colour per physics tier, indexed by `PIECE_DEFS` tier (0-9). Each is
 * distinct from its neighbours so stacked circles stay readable.
 */
export const CASCADE_PIECE_COLORS = [
  "#e63946", // 0 Cherry
  "#f4a261", // 1 Strawberry
  "#6a0572", // 2 Grape
  "#f77f00", // 3 Orange
  "#c1121f", // 4 Apple (distinct from Cherry)
  "#a7c957", // 5 Pear
  "#ffb347", // 6 Peach
  "#ffd166", // 7 Pineapple
  "#06d6a0", // 8 Melon
  "#2d6a4f", // 9 Watermelon
] as const;

/** The lid and danger-state colours for one theme (#3694). All `#rrggbb`: the screen mixes them. */
export interface CascadeLidPalette {
  /** The solid lid line across the bin when calm (the theme's muted text colour). */
  readonly lid: string;
  /** The spawner ring when safe, and the start of its drain (the theme's accent cyan). */
  readonly ringSafe: string;
  /** The ring at the end of its drain, the lid line in danger, the over-lid wash (error red). */
  readonly danger: string;
  /** The ring's empty track and the waiting ghost's dashed outline, drawn faint (text colour). */
  readonly ink: string;
}

/**
 * The lid, the spawner clock ring and the over-lid wash (#3694: proposal 3 with proposal 1's
 * solid lid line). Light and dark equal the theme's textMuted / accent / error / text tokens
 * (`ThemeContext.tsx`, checked in gamePalettes.test.ts), kept here as hex because the board
 * mixes them channel by channel as the danger rises.
 */
export const CASCADE_LID_PALETTE: Readonly<Record<"light" | "dark", CascadeLidPalette>> = {
  light: { lid: "#6b5e4a", ringSafe: "#1bc5d4", danger: "#d94a42", ink: "#1a1412" },
  dark: { lid: "#a0a0ac", ringSafe: "#8ff5ff", danger: "#ff716c", ink: "#e8e8f0" },
};
