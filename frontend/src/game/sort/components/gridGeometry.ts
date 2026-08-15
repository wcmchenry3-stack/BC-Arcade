/**
 * Pure grid-shape math for the Bottle Sort board (extracted from SortBoard so
 * it has a single source of truth and can be unit-tested directly — see
 * gridGeometry.test.ts, in particular the #2297 regression coverage).
 */

export interface GridShape {
  readonly numCols: number;
  readonly numRows: number;
  /** Bottle count in the last (possibly partial) row — relevant because
   * `styles.grid` centers each wrapped row independently (flexWrap + centered
   * justifyContent), so a differently-sized last row shifts x-positions. */
  readonly lastRowCount: number;
}

/**
 * Single row for ≤4 bottles; 3 cols for 5–6; 4 cols for 7+.
 * Depends ONLY on bottle count — see gridGeometry.test.ts for why that
 * matters (SortBoard resets its cached layout positions whenever bottle
 * count changes; this function being a pure function of count alone is what
 * makes that reset key both correct and sufficient).
 */
export function computeGridShape(numBottles: number): GridShape {
  const numCols = numBottles <= 4 ? numBottles : numBottles <= 6 ? 3 : 4;
  const numRows = Math.ceil(numBottles / numCols);
  const lastRowCount = numBottles - numCols * (numRows - 1);
  return { numCols, numRows, lastRowCount };
}
