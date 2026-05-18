/**
 * Four Rivers layout — 144 slots.
 *
 * Four parallel vertical rivers running top-to-bottom, mostly single-layer
 * with a small layer-1 highlight at each river's midpoint.
 *
 * Layer breakdown:
 *   Layer 0 — 128 tiles: 4 rivers × 2 cols × 16 rows
 *     River 1: cols  4,  6 — rows 0–15
 *     River 2: cols 10, 12 — rows 0–15
 *     River 3: cols 16, 18 — rows 0–15
 *     River 4: cols 22, 24 — rows 0–15
 *   Layer 1 —  16 tiles: left col of each river × 4 centre rows (6–9)
 *     River 1: col  4 — rows 6–9
 *     River 2: col 10 — rows 6–9
 *     River 3: col 16 — rows 6–9
 *     River 4: col 22 — rows 6–9
 *   Total: 128 + 16 = 144
 */

import type { Layout } from "../types";

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

function seq(start: number, stopInclusive: number): number[] {
  const out: number[] = [];
  for (let v = start; v <= stopInclusive; v++) out.push(v);
  return out;
}

export const FOUR_RIVERS_LAYOUT: Layout = [
  // Layer 0 — river bodies
  ...slots(0, [4, 6], seq(0, 15)),
  ...slots(0, [10, 12], seq(0, 15)),
  ...slots(0, [16, 18], seq(0, 15)),
  ...slots(0, [22, 24], seq(0, 15)),
  // Layer 1 — midpoint highlights
  ...slots(1, [4], seq(6, 9)),
  ...slots(1, [10], seq(6, 9)),
  ...slots(1, [16], seq(6, 9)),
  ...slots(1, [22], seq(6, 9)),
];

if (FOUR_RIVERS_LAYOUT.length !== 144) {
  throw new Error(`FOUR_RIVERS_LAYOUT has ${FOUR_RIVERS_LAYOUT.length} slots, expected 144`);
}
