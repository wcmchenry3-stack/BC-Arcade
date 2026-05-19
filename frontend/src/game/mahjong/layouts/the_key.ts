/**
 * The Key layout — 144 slots.
 *
 * Key silhouette: hollow ring bow at top (filled perimeter, empty interior),
 * long narrow shaft, a wide shoulder, and teeth projecting from the bottom.
 *
 * Layer breakdown:
 *   Layer 0 —  80 tiles: hollow bow ring (perimeter of cols 2–18, rows 0–3) +
 *                         shaft (cols 8–12, rows 4–9) + shoulder rows 10–11 +
 *                         teeth rows 12–13 (cols 4–12) + tooth base row 14 (cols 4–18) +
 *                         tooth tip row 15 (cols 8–14)
 *   Layer 1 —  44 tiles: bow interior fill (cols 4–16, rows 1–2) +
 *                         shaft (cols 8–12, rows 4–9) + short teeth (cols 4–8, rows 12–13) +
 *                         tooth base accent (cols 6–12, row 14) + tooth tip (cols 8–10, row 15)
 *   Layer 2 —  16 tiles: bow interior accent (cols 6–12, rows 1–2) +
 *                         shaft side details (cols 10–12, rows 5–6) +
 *                         tooth accent (cols 6–8, row 12) + tooth accent (cols 8–10, row 14)
 *   Layer 3 —   4 tiles: bow center (cols 8–10, rows 1–2)
 *   Total: 80 + 44 + 16 + 4 = 144
 */

import type { Layout } from "../types";

export const THE_KEY_LAYOUT: Layout = [
  // Layer 0 — 80 tiles
  // Bow ring row 0, cols 2–18 (9 cols)
  { col: 2, row: 0, layer: 0 },
  { col: 4, row: 0, layer: 0 },
  { col: 6, row: 0, layer: 0 },
  { col: 8, row: 0, layer: 0 },
  { col: 10, row: 0, layer: 0 },
  { col: 12, row: 0, layer: 0 },
  { col: 14, row: 0, layer: 0 },
  { col: 16, row: 0, layer: 0 },
  { col: 18, row: 0, layer: 0 },
  // Bow ring row 1, cols 2 and 18 only
  { col: 2, row: 1, layer: 0 },
  { col: 18, row: 1, layer: 0 },
  // Bow ring row 2, cols 2 and 18 only
  { col: 2, row: 2, layer: 0 },
  { col: 18, row: 2, layer: 0 },
  // Bow ring row 3, cols 2–18 (9 cols)
  { col: 2, row: 3, layer: 0 },
  { col: 4, row: 3, layer: 0 },
  { col: 6, row: 3, layer: 0 },
  { col: 8, row: 3, layer: 0 },
  { col: 10, row: 3, layer: 0 },
  { col: 12, row: 3, layer: 0 },
  { col: 14, row: 3, layer: 0 },
  { col: 16, row: 3, layer: 0 },
  { col: 18, row: 3, layer: 0 },
  // Shaft rows 4–9, cols 8,10,12
  { col: 8, row: 4, layer: 0 },
  { col: 10, row: 4, layer: 0 },
  { col: 12, row: 4, layer: 0 },
  { col: 8, row: 5, layer: 0 },
  { col: 10, row: 5, layer: 0 },
  { col: 12, row: 5, layer: 0 },
  { col: 8, row: 6, layer: 0 },
  { col: 10, row: 6, layer: 0 },
  { col: 12, row: 6, layer: 0 },
  { col: 8, row: 7, layer: 0 },
  { col: 10, row: 7, layer: 0 },
  { col: 12, row: 7, layer: 0 },
  { col: 8, row: 8, layer: 0 },
  { col: 10, row: 8, layer: 0 },
  { col: 12, row: 8, layer: 0 },
  { col: 8, row: 9, layer: 0 },
  { col: 10, row: 9, layer: 0 },
  { col: 12, row: 9, layer: 0 },
  // Shoulder row 10, cols 2–20 (10 cols)
  { col: 2, row: 10, layer: 0 },
  { col: 4, row: 10, layer: 0 },
  { col: 6, row: 10, layer: 0 },
  { col: 8, row: 10, layer: 0 },
  { col: 10, row: 10, layer: 0 },
  { col: 12, row: 10, layer: 0 },
  { col: 14, row: 10, layer: 0 },
  { col: 16, row: 10, layer: 0 },
  { col: 18, row: 10, layer: 0 },
  { col: 20, row: 10, layer: 0 },
  // Shoulder row 11, cols 4–18 (8 cols)
  { col: 4, row: 11, layer: 0 },
  { col: 6, row: 11, layer: 0 },
  { col: 8, row: 11, layer: 0 },
  { col: 10, row: 11, layer: 0 },
  { col: 12, row: 11, layer: 0 },
  { col: 14, row: 11, layer: 0 },
  { col: 16, row: 11, layer: 0 },
  { col: 18, row: 11, layer: 0 },
  // Teeth rows 12–13, cols 4,6,8,10,12 (5 cols)
  { col: 4, row: 12, layer: 0 },
  { col: 6, row: 12, layer: 0 },
  { col: 8, row: 12, layer: 0 },
  { col: 10, row: 12, layer: 0 },
  { col: 12, row: 12, layer: 0 },
  { col: 4, row: 13, layer: 0 },
  { col: 6, row: 13, layer: 0 },
  { col: 8, row: 13, layer: 0 },
  { col: 10, row: 13, layer: 0 },
  { col: 12, row: 13, layer: 0 },
  // Tooth base row 14, cols 4,6,8,10,12,14,16,18 (8 cols)
  { col: 4, row: 14, layer: 0 },
  { col: 6, row: 14, layer: 0 },
  { col: 8, row: 14, layer: 0 },
  { col: 10, row: 14, layer: 0 },
  { col: 12, row: 14, layer: 0 },
  { col: 14, row: 14, layer: 0 },
  { col: 16, row: 14, layer: 0 },
  { col: 18, row: 14, layer: 0 },
  // Tooth tip row 15, cols 8,10,12,14 (4 cols)
  { col: 8, row: 15, layer: 0 },
  { col: 10, row: 15, layer: 0 },
  { col: 12, row: 15, layer: 0 },
  { col: 14, row: 15, layer: 0 },
  // Layer 1 — 44 tiles
  // Bow interior fill rows 1–2, cols 4,6,8,10,12,14,16 (7 cols)
  { col: 4, row: 1, layer: 1 },
  { col: 6, row: 1, layer: 1 },
  { col: 8, row: 1, layer: 1 },
  { col: 10, row: 1, layer: 1 },
  { col: 12, row: 1, layer: 1 },
  { col: 14, row: 1, layer: 1 },
  { col: 16, row: 1, layer: 1 },
  { col: 4, row: 2, layer: 1 },
  { col: 6, row: 2, layer: 1 },
  { col: 8, row: 2, layer: 1 },
  { col: 10, row: 2, layer: 1 },
  { col: 12, row: 2, layer: 1 },
  { col: 14, row: 2, layer: 1 },
  { col: 16, row: 2, layer: 1 },
  // Shaft rows 4–9, cols 8,10,12
  { col: 8, row: 4, layer: 1 },
  { col: 10, row: 4, layer: 1 },
  { col: 12, row: 4, layer: 1 },
  { col: 8, row: 5, layer: 1 },
  { col: 10, row: 5, layer: 1 },
  { col: 12, row: 5, layer: 1 },
  { col: 8, row: 6, layer: 1 },
  { col: 10, row: 6, layer: 1 },
  { col: 12, row: 6, layer: 1 },
  { col: 8, row: 7, layer: 1 },
  { col: 10, row: 7, layer: 1 },
  { col: 12, row: 7, layer: 1 },
  { col: 8, row: 8, layer: 1 },
  { col: 10, row: 8, layer: 1 },
  { col: 12, row: 8, layer: 1 },
  { col: 8, row: 9, layer: 1 },
  { col: 10, row: 9, layer: 1 },
  { col: 12, row: 9, layer: 1 },
  // Short teeth rows 12–13, cols 4,6,8 (3 cols)
  { col: 4, row: 12, layer: 1 },
  { col: 6, row: 12, layer: 1 },
  { col: 8, row: 12, layer: 1 },
  { col: 4, row: 13, layer: 1 },
  { col: 6, row: 13, layer: 1 },
  { col: 8, row: 13, layer: 1 },
  // Tooth base accent row 14, cols 6,8,10,12 (4 cols)
  { col: 6, row: 14, layer: 1 },
  { col: 8, row: 14, layer: 1 },
  { col: 10, row: 14, layer: 1 },
  { col: 12, row: 14, layer: 1 },
  // Tooth tip row 15, cols 8,10 (2 cols)
  { col: 8, row: 15, layer: 1 },
  { col: 10, row: 15, layer: 1 },
  // Layer 2 — 16 tiles
  // Bow interior accent rows 1–2, cols 6,8,10,12 (4 cols)
  { col: 6, row: 1, layer: 2 },
  { col: 8, row: 1, layer: 2 },
  { col: 10, row: 1, layer: 2 },
  { col: 12, row: 1, layer: 2 },
  { col: 6, row: 2, layer: 2 },
  { col: 8, row: 2, layer: 2 },
  { col: 10, row: 2, layer: 2 },
  { col: 12, row: 2, layer: 2 },
  // Shaft side rows 5–6, cols 10,12 (2 cols)
  { col: 10, row: 5, layer: 2 },
  { col: 12, row: 5, layer: 2 },
  { col: 10, row: 6, layer: 2 },
  { col: 12, row: 6, layer: 2 },
  // Tooth accent row 12, cols 6,8 (2 cols)
  { col: 6, row: 12, layer: 2 },
  { col: 8, row: 12, layer: 2 },
  // Tooth accent row 14, cols 8,10 (2 cols)
  { col: 8, row: 14, layer: 2 },
  { col: 10, row: 14, layer: 2 },
  // Layer 3 — 4 tiles
  // Bow center rows 1–2, cols 8,10
  { col: 8, row: 1, layer: 3 },
  { col: 10, row: 1, layer: 3 },
  { col: 8, row: 2, layer: 3 },
  { col: 10, row: 2, layer: 3 },
];

if (THE_KEY_LAYOUT.length !== 144) {
  throw new Error(`THE_KEY_LAYOUT has ${THE_KEY_LAYOUT.length} slots, expected 144`);
}
