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
 * Debug-only placeholder colour per tier of the ladder (`game/cascade/tiers.ts`, tiers 0-11).
 * Each is distinct from its neighbours so stacked circles stay readable. Tier 11 (the capstone,
 * Pumpkin / Milky Way) is drawn with this colour until its art lands (#3698).
 */
export const CASCADE_PIECE_COLORS = [
  "#e63946", // 0 Cherry / Moon
  "#4361ee", // 1 Blueberry / Pluto
  "#f9c80e", // 2 Lemon / Mercury
  "#6a0572", // 3 Grape / Mars
  "#f77f00", // 4 Orange / Venus
  "#c1121f", // 5 Apple / Earth
  "#ffb347", // 6 Peach / Neptune
  "#6f4e37", // 7 Coconut / Uranus
  "#ff4d9d", // 8 Dragonfruit / Saturn
  "#ffd166", // 9 Pineapple / Jupiter
  "#2d6a4f", // 10 Watermelon / Sun
  "#e76f00", // 11 Pumpkin / Milky Way (capstone)
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
