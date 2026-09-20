/**
 * Pure grid-shape math for the Bottle Sort board (extracted from SortBoard so
 * it has a single source of truth and can be unit-tested directly — see
 * gridGeometry.test.ts, in particular the #2297 and #2426 regression coverage).
 */

export interface GridShape {
  /** Longest row — i.e. max(rowCounts). Drives horizontal bottle sizing. */
  readonly numCols: number;
  readonly numRows: number;
  /** Bottle count for each row, read directly by SortBoard to group bottles
   * into explicit row containers (see #2426 — relying on flexWrap to infer
   * row breaks from a computed bottle width let actual on-device wrapping
   * diverge from this shape). Sizes differ by at most 1 across rows: the
   * remainder from an uneven division is spread one-per-row across the
   * first `numBottles % numRows` rows rather than dumped into the last row. */
  readonly rowCounts: readonly number[];
}

/**
 * Chooses a row count from the same per-row cap as before (single row for
 * ≤4 bottles; cap of 3 for 5–6; cap of 4 for 7+), then evenly spreads the
 * bottle count across that many rows instead of filling full rows first and
 * leaving whatever's left in a short final row.
 * Depends ONLY on bottle count — see gridGeometry.test.ts for why that
 * matters (SortBoard resets its cached layout positions whenever bottle
 * count changes; this function being a pure function of count alone is what
 * makes that reset key both correct and sufficient).
 */
export function computeGridShape(numBottles: number): GridShape {
  if (numBottles <= 0) return { numCols: 0, numRows: 0, rowCounts: [] };
  const maxColsCap = numBottles <= 4 ? numBottles : numBottles <= 6 ? 3 : 4;
  const numRows = Math.ceil(numBottles / maxColsCap);
  const base = Math.floor(numBottles / numRows);
  const remainder = numBottles % numRows;
  const rowCounts = Array.from({ length: numRows }, (_, i) => base + (i < remainder ? 1 : 0));
  const numCols = Math.max(...rowCounts);
  return { numCols, numRows, rowCounts };
}
