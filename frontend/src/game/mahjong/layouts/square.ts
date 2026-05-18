/**
 * Square layout — 144 slots.
 *
 * Flat wide rectangle — broad footprint, 2 layers.
 * The second layer is inset by one column on each side.
 *
 * Layer breakdown:
 *   Layer 0 — 80 tiles: rows 1–8, cols 4–22 (10 cols × 8 rows)
 *   Layer 1 — 64 tiles: rows 1–8, cols 6–20  (8 cols × 8 rows)
 *   Total: 80 + 64 = 144
 */

import type { Layout } from "../types";

function range(start: number, stopInclusive: number, step: number): number[] {
  const out: number[] = [];
  for (let v = start; v <= stopInclusive; v += step) out.push(v);
  return out;
}

function slots(
  layer: number,
  cols: number[],
  rows: number[]
): { col: number; row: number; layer: number }[] {
  const out: { col: number; row: number; layer: number }[] = [];
  for (const row of rows) {
    for (const col of cols) {
      out.push({ col, row, layer });
    }
  }
  return out;
}

const ROWS = [1, 2, 3, 4, 5, 6, 7, 8];

export const SQUARE_LAYOUT: Layout = [
  ...slots(0, range(4, 22, 2), ROWS),
  ...slots(1, range(6, 20, 2), ROWS),
];

if (SQUARE_LAYOUT.length !== 144) {
  throw new Error(`SQUARE_LAYOUT has ${SQUARE_LAYOUT.length} slots, expected 144`);
}
