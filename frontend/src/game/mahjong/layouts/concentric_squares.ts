/**
 * Concentric Squares layout - 144 slots.
 *
 * Four nested filled rectangles create a "squares within squares" silhouette.
 * Each inner rectangle shares grid positions with all outer rectangles at lower
 * layers, so inner tiles are stacked deepest and must be uncovered from the
 * outside in.
 *
 * Layer breakdown:
 *   Layer 0 -  80 tiles: outer rectangle, cols 2-20, rows 2-9
 *   Layer 1 -  40 tiles: second rectangle, cols 4-18, rows 3-7
 *   Layer 2 -  16 tiles: third rectangle, cols 8-14, rows 4-7
 *   Layer 3 -   8 tiles: innermost core, cols 8-14, rows 5-6
 *   Total: 80 + 40 + 16 + 8 = 144
 */

import type { Layout } from "../types";

export const CONCENTRIC_SQUARES_LAYOUT: Layout = [
  // Layer 0 - 80 tiles: outer rectangle, cols 2-20 x rows 2-9
  // Row 2, cols 2-20 (10 tiles)
  { col: 2, row: 2, layer: 0 },
  { col: 4, row: 2, layer: 0 },
  { col: 6, row: 2, layer: 0 },
  { col: 8, row: 2, layer: 0 },
  { col: 10, row: 2, layer: 0 },
  { col: 12, row: 2, layer: 0 },
  { col: 14, row: 2, layer: 0 },
  { col: 16, row: 2, layer: 0 },
  { col: 18, row: 2, layer: 0 },
  { col: 20, row: 2, layer: 0 },
  // Row 3, cols 2-20 (10 tiles)
  { col: 2, row: 3, layer: 0 },
  { col: 4, row: 3, layer: 0 },
  { col: 6, row: 3, layer: 0 },
  { col: 8, row: 3, layer: 0 },
  { col: 10, row: 3, layer: 0 },
  { col: 12, row: 3, layer: 0 },
  { col: 14, row: 3, layer: 0 },
  { col: 16, row: 3, layer: 0 },
  { col: 18, row: 3, layer: 0 },
  { col: 20, row: 3, layer: 0 },
  // Row 4, cols 2-20 (10 tiles)
  { col: 2, row: 4, layer: 0 },
  { col: 4, row: 4, layer: 0 },
  { col: 6, row: 4, layer: 0 },
  { col: 8, row: 4, layer: 0 },
  { col: 10, row: 4, layer: 0 },
  { col: 12, row: 4, layer: 0 },
  { col: 14, row: 4, layer: 0 },
  { col: 16, row: 4, layer: 0 },
  { col: 18, row: 4, layer: 0 },
  { col: 20, row: 4, layer: 0 },
  // Row 5, cols 2-20 (10 tiles)
  { col: 2, row: 5, layer: 0 },
  { col: 4, row: 5, layer: 0 },
  { col: 6, row: 5, layer: 0 },
  { col: 8, row: 5, layer: 0 },
  { col: 10, row: 5, layer: 0 },
  { col: 12, row: 5, layer: 0 },
  { col: 14, row: 5, layer: 0 },
  { col: 16, row: 5, layer: 0 },
  { col: 18, row: 5, layer: 0 },
  { col: 20, row: 5, layer: 0 },
  // Row 6, cols 2-20 (10 tiles)
  { col: 2, row: 6, layer: 0 },
  { col: 4, row: 6, layer: 0 },
  { col: 6, row: 6, layer: 0 },
  { col: 8, row: 6, layer: 0 },
  { col: 10, row: 6, layer: 0 },
  { col: 12, row: 6, layer: 0 },
  { col: 14, row: 6, layer: 0 },
  { col: 16, row: 6, layer: 0 },
  { col: 18, row: 6, layer: 0 },
  { col: 20, row: 6, layer: 0 },
  // Row 7, cols 2-20 (10 tiles)
  { col: 2, row: 7, layer: 0 },
  { col: 4, row: 7, layer: 0 },
  { col: 6, row: 7, layer: 0 },
  { col: 8, row: 7, layer: 0 },
  { col: 10, row: 7, layer: 0 },
  { col: 12, row: 7, layer: 0 },
  { col: 14, row: 7, layer: 0 },
  { col: 16, row: 7, layer: 0 },
  { col: 18, row: 7, layer: 0 },
  { col: 20, row: 7, layer: 0 },
  // Row 8, cols 2-20 (10 tiles)
  { col: 2, row: 8, layer: 0 },
  { col: 4, row: 8, layer: 0 },
  { col: 6, row: 8, layer: 0 },
  { col: 8, row: 8, layer: 0 },
  { col: 10, row: 8, layer: 0 },
  { col: 12, row: 8, layer: 0 },
  { col: 14, row: 8, layer: 0 },
  { col: 16, row: 8, layer: 0 },
  { col: 18, row: 8, layer: 0 },
  { col: 20, row: 8, layer: 0 },
  // Row 9, cols 2-20 (10 tiles)
  { col: 2, row: 9, layer: 0 },
  { col: 4, row: 9, layer: 0 },
  { col: 6, row: 9, layer: 0 },
  { col: 8, row: 9, layer: 0 },
  { col: 10, row: 9, layer: 0 },
  { col: 12, row: 9, layer: 0 },
  { col: 14, row: 9, layer: 0 },
  { col: 16, row: 9, layer: 0 },
  { col: 18, row: 9, layer: 0 },
  { col: 20, row: 9, layer: 0 },
  // Layer 1 - 40 tiles: second rectangle, cols 4-18 x rows 3-7
  // Row 3, cols 4-18 (8 tiles)
  { col: 4, row: 3, layer: 1 },
  { col: 6, row: 3, layer: 1 },
  { col: 8, row: 3, layer: 1 },
  { col: 10, row: 3, layer: 1 },
  { col: 12, row: 3, layer: 1 },
  { col: 14, row: 3, layer: 1 },
  { col: 16, row: 3, layer: 1 },
  { col: 18, row: 3, layer: 1 },
  // Row 4, cols 4-18 (8 tiles)
  { col: 4, row: 4, layer: 1 },
  { col: 6, row: 4, layer: 1 },
  { col: 8, row: 4, layer: 1 },
  { col: 10, row: 4, layer: 1 },
  { col: 12, row: 4, layer: 1 },
  { col: 14, row: 4, layer: 1 },
  { col: 16, row: 4, layer: 1 },
  { col: 18, row: 4, layer: 1 },
  // Row 5, cols 4-18 (8 tiles)
  { col: 4, row: 5, layer: 1 },
  { col: 6, row: 5, layer: 1 },
  { col: 8, row: 5, layer: 1 },
  { col: 10, row: 5, layer: 1 },
  { col: 12, row: 5, layer: 1 },
  { col: 14, row: 5, layer: 1 },
  { col: 16, row: 5, layer: 1 },
  { col: 18, row: 5, layer: 1 },
  // Row 6, cols 4-18 (8 tiles)
  { col: 4, row: 6, layer: 1 },
  { col: 6, row: 6, layer: 1 },
  { col: 8, row: 6, layer: 1 },
  { col: 10, row: 6, layer: 1 },
  { col: 12, row: 6, layer: 1 },
  { col: 14, row: 6, layer: 1 },
  { col: 16, row: 6, layer: 1 },
  { col: 18, row: 6, layer: 1 },
  // Row 7, cols 4-18 (8 tiles)
  { col: 4, row: 7, layer: 1 },
  { col: 6, row: 7, layer: 1 },
  { col: 8, row: 7, layer: 1 },
  { col: 10, row: 7, layer: 1 },
  { col: 12, row: 7, layer: 1 },
  { col: 14, row: 7, layer: 1 },
  { col: 16, row: 7, layer: 1 },
  { col: 18, row: 7, layer: 1 },
  // Layer 2 - 16 tiles: third rectangle, cols 8-14 x rows 4-7
  // Row 4, cols 8-14 (4 tiles)
  { col: 8, row: 4, layer: 2 },
  { col: 10, row: 4, layer: 2 },
  { col: 12, row: 4, layer: 2 },
  { col: 14, row: 4, layer: 2 },
  // Row 5, cols 8-14 (4 tiles)
  { col: 8, row: 5, layer: 2 },
  { col: 10, row: 5, layer: 2 },
  { col: 12, row: 5, layer: 2 },
  { col: 14, row: 5, layer: 2 },
  // Row 6, cols 8-14 (4 tiles)
  { col: 8, row: 6, layer: 2 },
  { col: 10, row: 6, layer: 2 },
  { col: 12, row: 6, layer: 2 },
  { col: 14, row: 6, layer: 2 },
  // Row 7, cols 8-14 (4 tiles)
  { col: 8, row: 7, layer: 2 },
  { col: 10, row: 7, layer: 2 },
  { col: 12, row: 7, layer: 2 },
  { col: 14, row: 7, layer: 2 },
  // Layer 3 - 8 tiles: innermost core, cols 8-14 x rows 5-6
  // Row 5, cols 8-14 (4 tiles)
  { col: 8, row: 5, layer: 3 },
  { col: 10, row: 5, layer: 3 },
  { col: 12, row: 5, layer: 3 },
  { col: 14, row: 5, layer: 3 },
  // Row 6, cols 8-14 (4 tiles)
  { col: 8, row: 6, layer: 3 },
  { col: 10, row: 6, layer: 3 },
  { col: 12, row: 6, layer: 3 },
  { col: 14, row: 6, layer: 3 },
];

if (CONCENTRIC_SQUARES_LAYOUT.length !== 144) {
  throw new Error(
    `CONCENTRIC_SQUARES_LAYOUT has ${CONCENTRIC_SQUARES_LAYOUT.length} slots, expected 144`
  );
}
