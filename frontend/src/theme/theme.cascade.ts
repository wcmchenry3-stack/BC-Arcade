/**
 * Cascade palette (#2989 pattern, #3693): the colours Cascade draws with that are not theme
 * tokens, in one place.
 *
 * Today that is only the placeholder piece colours. They are drawn as plain circles by the
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
