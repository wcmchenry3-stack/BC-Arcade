/**
 * Diamond layout - 144 slots.
 *
 * Rhombus rotated 45 deg: widest at the middle rows (4-5), tapering to 4-tile
 * points at the top (row 0) and bottom (row 9).
 *
 * Layer breakdown:
 *   Layer 0 -  80 tiles: full diamond fill, rows 0-9
 *   Layer 1 -  40 tiles: inner diamond, rows 1-8
 *   Layer 2 -  16 tiles: core diamond, rows 2-6
 *   Layer 3 -   8 tiles: center column, rows 3-6
 *   Total: 80 + 40 + 16 + 8 = 144
 */

import type { Layout } from "../types";

export const DIAMOND_LAYOUT: Layout = [
  // Layer 0 - 80 tiles: full diamond fill, rows 0-9
  // Row 0, cols 8-14 (4 tiles)
  { col: 8, row: 0, layer: 0 },
  { col: 10, row: 0, layer: 0 },
  { col: 12, row: 0, layer: 0 },
  { col: 14, row: 0, layer: 0 },
  // Row 1, cols 6-16 (6 tiles)
  { col: 6, row: 1, layer: 0 },
  { col: 8, row: 1, layer: 0 },
  { col: 10, row: 1, layer: 0 },
  { col: 12, row: 1, layer: 0 },
  { col: 14, row: 1, layer: 0 },
  { col: 16, row: 1, layer: 0 },
  // Row 2, cols 4-18 (8 tiles)
  { col: 4, row: 2, layer: 0 },
  { col: 6, row: 2, layer: 0 },
  { col: 8, row: 2, layer: 0 },
  { col: 10, row: 2, layer: 0 },
  { col: 12, row: 2, layer: 0 },
  { col: 14, row: 2, layer: 0 },
  { col: 16, row: 2, layer: 0 },
  { col: 18, row: 2, layer: 0 },
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
  // Rows 4-5, cols 0-22 (12 tiles each — widest rows)
  { col: 0, row: 4, layer: 0 },
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
  { col: 22, row: 4, layer: 0 },
  { col: 0, row: 5, layer: 0 },
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
  { col: 22, row: 5, layer: 0 },
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
  // Row 7, cols 4-18 (8 tiles)
  { col: 4, row: 7, layer: 0 },
  { col: 6, row: 7, layer: 0 },
  { col: 8, row: 7, layer: 0 },
  { col: 10, row: 7, layer: 0 },
  { col: 12, row: 7, layer: 0 },
  { col: 14, row: 7, layer: 0 },
  { col: 16, row: 7, layer: 0 },
  { col: 18, row: 7, layer: 0 },
  // Row 8, cols 6-16 (6 tiles)
  { col: 6, row: 8, layer: 0 },
  { col: 8, row: 8, layer: 0 },
  { col: 10, row: 8, layer: 0 },
  { col: 12, row: 8, layer: 0 },
  { col: 14, row: 8, layer: 0 },
  { col: 16, row: 8, layer: 0 },
  // Row 9, cols 8-14 (4 tiles)
  { col: 8, row: 9, layer: 0 },
  { col: 10, row: 9, layer: 0 },
  { col: 12, row: 9, layer: 0 },
  { col: 14, row: 9, layer: 0 },
  // Layer 1 - 40 tiles: inner diamond, rows 1-8
  // Row 1, cols 10-12 (2 tiles)
  { col: 10, row: 1, layer: 1 },
  { col: 12, row: 1, layer: 1 },
  // Row 2, cols 8-14 (4 tiles)
  { col: 8, row: 2, layer: 1 },
  { col: 10, row: 2, layer: 1 },
  { col: 12, row: 2, layer: 1 },
  { col: 14, row: 2, layer: 1 },
  // Row 3, cols 6-16 (6 tiles)
  { col: 6, row: 3, layer: 1 },
  { col: 8, row: 3, layer: 1 },
  { col: 10, row: 3, layer: 1 },
  { col: 12, row: 3, layer: 1 },
  { col: 14, row: 3, layer: 1 },
  { col: 16, row: 3, layer: 1 },
  // Rows 4-5, cols 4-18 (8 tiles each)
  { col: 4, row: 4, layer: 1 },
  { col: 6, row: 4, layer: 1 },
  { col: 8, row: 4, layer: 1 },
  { col: 10, row: 4, layer: 1 },
  { col: 12, row: 4, layer: 1 },
  { col: 14, row: 4, layer: 1 },
  { col: 16, row: 4, layer: 1 },
  { col: 18, row: 4, layer: 1 },
  { col: 4, row: 5, layer: 1 },
  { col: 6, row: 5, layer: 1 },
  { col: 8, row: 5, layer: 1 },
  { col: 10, row: 5, layer: 1 },
  { col: 12, row: 5, layer: 1 },
  { col: 14, row: 5, layer: 1 },
  { col: 16, row: 5, layer: 1 },
  { col: 18, row: 5, layer: 1 },
  // Row 6, cols 6-16 (6 tiles)
  { col: 6, row: 6, layer: 1 },
  { col: 8, row: 6, layer: 1 },
  { col: 10, row: 6, layer: 1 },
  { col: 12, row: 6, layer: 1 },
  { col: 14, row: 6, layer: 1 },
  { col: 16, row: 6, layer: 1 },
  // Row 7, cols 8-14 (4 tiles)
  { col: 8, row: 7, layer: 1 },
  { col: 10, row: 7, layer: 1 },
  { col: 12, row: 7, layer: 1 },
  { col: 14, row: 7, layer: 1 },
  // Row 8, cols 10-12 (2 tiles)
  { col: 10, row: 8, layer: 1 },
  { col: 12, row: 8, layer: 1 },
  // Layer 2 - 16 tiles: core diamond, rows 2-6
  // Row 2, cols 10-12 (2 tiles)
  { col: 10, row: 2, layer: 2 },
  { col: 12, row: 2, layer: 2 },
  // Rows 3-5, cols 8-14 (4 tiles each)
  { col: 8, row: 3, layer: 2 },
  { col: 10, row: 3, layer: 2 },
  { col: 12, row: 3, layer: 2 },
  { col: 14, row: 3, layer: 2 },
  { col: 8, row: 4, layer: 2 },
  { col: 10, row: 4, layer: 2 },
  { col: 12, row: 4, layer: 2 },
  { col: 14, row: 4, layer: 2 },
  { col: 8, row: 5, layer: 2 },
  { col: 10, row: 5, layer: 2 },
  { col: 12, row: 5, layer: 2 },
  { col: 14, row: 5, layer: 2 },
  // Row 6, cols 10-12 (2 tiles)
  { col: 10, row: 6, layer: 2 },
  { col: 12, row: 6, layer: 2 },
  // Layer 3 - 8 tiles: center column, rows 3-6
  // Rows 3-6, cols 10-12 (2 tiles each)
  { col: 10, row: 3, layer: 3 },
  { col: 12, row: 3, layer: 3 },
  { col: 10, row: 4, layer: 3 },
  { col: 12, row: 4, layer: 3 },
  { col: 10, row: 5, layer: 3 },
  { col: 12, row: 5, layer: 3 },
  { col: 10, row: 6, layer: 3 },
  { col: 12, row: 6, layer: 3 },
];
