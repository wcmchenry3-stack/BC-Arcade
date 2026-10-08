/**
 * Bounds for the player-adjustable table rules (`GameRules`) edited in the
 * BettingPanel's "Table Rules" section. Rules are client-side only — the
 * backend never receives or validates them — so these are the single source
 * of truth.
 */

/** Fewest decks in the shoe. */
export const DECK_COUNT_MIN = 1;
/** Most decks in the shoe. */
export const DECK_COUNT_MAX = 8;

/** Lowest shoe penetration (fraction dealt before a reshuffle). */
export const PENETRATION_MIN = 0.5;
/** Highest shoe penetration. */
export const PENETRATION_MAX = 0.9;
/** Penetration stepper increment. */
export const PENETRATION_STEP = 0.05;
