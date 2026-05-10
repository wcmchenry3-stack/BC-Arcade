/**
 * Turtle layout — 144 slots (#891, rotated portrait #1416).
 *
 * Coordinate system: tiles are 2 grid units wide, 1 unit tall.
 * Adjacent tiles in the same row step by col±2. Stacked tiles share the same
 * (col, row) and differ only in layer.
 *
 * Portrait orientation: head at top, tail at bottom, feet left/right.
 * Derived from the classic landscape layout via 90° CCW rotation:
 *   new_col = old_row × 2,  new_row = (22 − old_col) / 2
 *
 * Layer breakdown:
 *   Layer 0 — 64 tiles: body (rows 2–9, cols 2–12), head (rows 0–1, cols 6,8),
 *              tail (rows 10–11, cols 6,8), left/right feet (cols 0,14, rows 2,3,8,9)
 *   Layer 1 — 36 tiles: body (rows 2–9, cols 4–10), head (row 1, cols 6,8),
 *              tail (row 10, cols 6,8)
 *   Layer 2 — 24 tiles: centre (rows 3–8, cols 4–10)
 *   Layer 3 — 12 tiles: centre (rows 3–8, cols 6,8)
 *   Layer 4 —  8 tiles: peak (rows 4–7, cols 6,8)
 *   Total: 64 + 36 + 24 + 12 + 8 = 144
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

export const TURTLE_LAYOUT: Layout = [
  // --- Layer 0 ---
  // Body
  ...slots(0, range(2, 12, 2), range(2, 9, 1)),
  // Head (top protrusion)
  ...slots(0, [6, 8], [0, 1]),
  // Tail (bottom protrusion)
  ...slots(0, [6, 8], [10, 11]),
  // Left feet
  ...slots(0, [0], [2, 3, 8, 9]),
  // Right feet
  ...slots(0, [14], [2, 3, 8, 9]),

  // --- Layer 1 ---
  // Body
  ...slots(1, range(4, 10, 2), range(2, 9, 1)),
  // Head
  ...slots(1, [6, 8], [1]),
  // Tail
  ...slots(1, [6, 8], [10]),

  // --- Layer 2 ---
  ...slots(2, range(4, 10, 2), range(3, 8, 1)),

  // --- Layer 3 ---
  ...slots(3, [6, 8], range(3, 8, 1)),

  // --- Layer 4 ---
  ...slots(4, [6, 8], range(4, 7, 1)),
];

if (TURTLE_LAYOUT.length !== 144) {
  throw new Error(`TURTLE_LAYOUT has ${TURTLE_LAYOUT.length} slots, expected 144`);
}
