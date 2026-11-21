/**
 * The Yacht scorecard's row height (#3968): derived from the height the screen gives the table
 * instead of a 390 x 844 assumption. Pure, so it is unit-tested without a layout.
 */

/** Row height (pt) before the table has been measured: 13 rows fit a 390 x 844 phone. */
export const DEFAULT_ROW_HEIGHT = 29;
/** Shortest row (pt): below it a row is no longer a comfortable tap, so the table scrolls instead. */
export const MIN_ROW_HEIGHT = 26;
/** Tallest row (pt): a tall phone gets a little air, not stretched rows. */
export const MAX_ROW_HEIGHT = 32;
/** The 13 score rows. */
export const SCORE_ROW_COUNT = 13;

/**
 * Everything in the card that is not a score row (pt): card border (2) and padding (8), the header
 * (22), the upper subtotal band with its margins (40), the total with its margin (42) and the 12
 * hairlines between rows (counted as 1 pt each, the safe side).
 */
export const FIXED_CHROME_HEIGHT = 126;

/**
 * The row height for a table `availableHeight` pt tall: the largest whole-point height at which
 * all 13 rows plus the fixed chrome fit, kept between `MIN_ROW_HEIGHT` and `MAX_ROW_HEIGHT`.
 * Not measured yet (`null`, 0, NaN) gives the default. When even the minimum does not fit, the
 * minimum is returned and the table scrolls.
 */
export function clampRowHeight(availableHeight: number | null | undefined): number {
  if (availableHeight == null || !Number.isFinite(availableHeight) || availableHeight <= 0) {
    return DEFAULT_ROW_HEIGHT;
  }
  const fit = Math.floor((availableHeight - FIXED_CHROME_HEIGHT) / SCORE_ROW_COUNT);
  return Math.min(MAX_ROW_HEIGHT, Math.max(MIN_ROW_HEIGHT, fit));
}
