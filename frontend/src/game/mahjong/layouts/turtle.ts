/**
 * Turtle layout — 144 slots (#891).
 *
 * Coordinate system: tiles are 2 grid units wide, 1 unit tall.
 * Adjacent tiles in the same row step by col±2. Stacked tiles share the same
 * (col, row) and differ only in layer.
 *
 * Traditional orientation: head protrudes left, tail protrudes right.
 *
 * Layer breakdown:
 *   Layer 0 — 64 tiles: body (rows 1–6, cols 4–18), head (rows 3–4, cols 0–2),
 *              tail (rows 3–4, cols 20–22), top/bottom feet (row 0/7, cols 4,6,16,18)
 *   Layer 1 — 36 tiles: body (rows 2–5, cols 4–18), head (rows 3–4, col 2),
 *              tail (rows 3–4, col 20)
 *   Layer 2 — 24 tiles: centre (rows 2–5, cols 6–16)
 *   Layer 3 — 12 tiles: centre (rows 3–4, cols 6–16)
 *   Layer 4 —  8 tiles: peak (rows 3–4, cols 8–14)
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
  ...slots(0, range(4, 18, 2), range(1, 6, 1)),
  // Head (left protrusion)
  ...slots(0, [0, 2], [3, 4]),
  // Tail (right protrusion)
  ...slots(0, [20, 22], [3, 4]),
  // Top feet
  ...slots(0, [4, 6, 16, 18], [0]),
  // Bottom feet
  ...slots(0, [4, 6, 16, 18], [7]),

  // --- Layer 1 ---
  // Body
  ...slots(1, range(4, 18, 2), range(2, 5, 1)),
  // Head
  ...slots(1, [2], [3, 4]),
  // Tail
  ...slots(1, [20], [3, 4]),

  // --- Layer 2 ---
  ...slots(2, range(6, 16, 2), range(2, 5, 1)),

  // --- Layer 3 ---
  ...slots(3, range(6, 16, 2), [3, 4]),

  // --- Layer 4 ---
  ...slots(4, range(8, 14, 2), [3, 4]),
];

if (TURTLE_LAYOUT.length !== 144) {
  throw new Error(`TURTLE_LAYOUT has ${TURTLE_LAYOUT.length} slots, expected 144`);
}
