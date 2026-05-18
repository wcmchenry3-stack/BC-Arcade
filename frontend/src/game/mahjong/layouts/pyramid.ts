/**
 * Pyramid layout — 144 slots.
 *
 * Stepped pyramid viewed from above: wide base tapering inward each layer
 * until a flat 4-column peak at layer 4.
 *
 * Layer breakdown:
 *   Layer 0 — 44 tiles: rows 2–5, cols 4–24 (11 cols × 4 rows)
 *   Layer 1 — 36 tiles: rows 2–5, cols 6–22 (9 cols × 4 rows)
 *   Layer 2 — 28 tiles: rows 2–5, cols 8–20 (7 cols × 4 rows)
 *   Layer 3 — 20 tiles: rows 2–5, cols 10–18 (5 cols × 4 rows)
 *   Layer 4 — 16 tiles: rows 2–5, cols 12–18 (4 cols × 4 rows)
 *   Total: 44 + 36 + 28 + 20 + 16 = 144
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

const ROWS = [2, 3, 4, 5];

export const PYRAMID_LAYOUT: Layout = [
  ...slots(0, range(4, 24, 2), ROWS),
  ...slots(1, range(6, 22, 2), ROWS),
  ...slots(2, range(8, 20, 2), ROWS),
  ...slots(3, range(10, 18, 2), ROWS),
  ...slots(4, range(12, 18, 2), ROWS),
];

if (PYRAMID_LAYOUT.length !== 144) {
  throw new Error(`PYRAMID_LAYOUT has ${PYRAMID_LAYOUT.length} slots, expected 144`);
}
