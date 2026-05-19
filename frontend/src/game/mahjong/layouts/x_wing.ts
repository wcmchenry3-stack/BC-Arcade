/**
 * X-Wing layout - 144 slots.
 *
 * Two crossing 4-wide diagonal bands forming an X shape.  The bands spread
 * from opposite corners and converge at the centre (row 4), creating a
 * stacked crossing zone.
 *
 * Layer breakdown:
 *   Layer 0 -  72 tiles: full X silhouette (both diagonal bands), rows 0-9
 *   Layer 1 -  38 tiles: inner 2-wide X, rows 0-9
 *   Layer 2 -  24 tiles: crossing zone cols 8-14, rows 2-7
 *   Layer 3 -  10 tiles: centre spine cols 10-12, rows 3-7
 *   Total: 72 + 38 + 24 + 10 = 144
 */

import type { Layout } from "../types";

export const X_WING_LAYOUT: Layout = [
  // Layers 0-1 interspersed by row (L0: full X, 72 tiles; L1: inner 2-wide X, 38 tiles)
  // Layer 0
  { col: 0, row: 0, layer: 0 },
  { col: 2, row: 0, layer: 0 },
  { col: 4, row: 0, layer: 0 },
  { col: 6, row: 0, layer: 0 },
  { col: 16, row: 0, layer: 0 },
  { col: 18, row: 0, layer: 0 },
  { col: 20, row: 0, layer: 0 },
  { col: 22, row: 0, layer: 0 },
  // Layer 1
  { col: 2, row: 0, layer: 1 },
  { col: 4, row: 0, layer: 1 },
  { col: 18, row: 0, layer: 1 },
  { col: 20, row: 0, layer: 1 },
  // Layer 0
  { col: 2, row: 1, layer: 0 },
  { col: 4, row: 1, layer: 0 },
  { col: 6, row: 1, layer: 0 },
  { col: 8, row: 1, layer: 0 },
  { col: 14, row: 1, layer: 0 },
  { col: 16, row: 1, layer: 0 },
  { col: 18, row: 1, layer: 0 },
  { col: 20, row: 1, layer: 0 },
  // Layer 1
  { col: 4, row: 1, layer: 1 },
  { col: 6, row: 1, layer: 1 },
  { col: 16, row: 1, layer: 1 },
  { col: 18, row: 1, layer: 1 },
  // Layer 0
  { col: 4, row: 2, layer: 0 },
  { col: 6, row: 2, layer: 0 },
  { col: 8, row: 2, layer: 0 },
  { col: 10, row: 2, layer: 0 },
  { col: 12, row: 2, layer: 0 },
  { col: 14, row: 2, layer: 0 },
  { col: 16, row: 2, layer: 0 },
  { col: 18, row: 2, layer: 0 },
  // Layer 1
  { col: 6, row: 2, layer: 1 },
  { col: 8, row: 2, layer: 1 },
  { col: 14, row: 2, layer: 1 },
  { col: 16, row: 2, layer: 1 },
  // Layer 0
  { col: 6, row: 3, layer: 0 },
  { col: 8, row: 3, layer: 0 },
  { col: 10, row: 3, layer: 0 },
  { col: 12, row: 3, layer: 0 },
  { col: 14, row: 3, layer: 0 },
  { col: 16, row: 3, layer: 0 },
  // Layer 1
  { col: 8, row: 3, layer: 1 },
  { col: 10, row: 3, layer: 1 },
  { col: 12, row: 3, layer: 1 },
  { col: 14, row: 3, layer: 1 },
  // Layer 0
  { col: 8, row: 4, layer: 0 },
  { col: 10, row: 4, layer: 0 },
  { col: 12, row: 4, layer: 0 },
  { col: 14, row: 4, layer: 0 },
  // Layer 1
  { col: 10, row: 4, layer: 1 },
  { col: 12, row: 4, layer: 1 },
  // Layer 0
  { col: 10, row: 5, layer: 0 },
  { col: 12, row: 5, layer: 0 },
  { col: 14, row: 5, layer: 0 },
  { col: 16, row: 5, layer: 0 },
  { col: 6, row: 5, layer: 0 },
  { col: 8, row: 5, layer: 0 },
  // Layer 1
  { col: 12, row: 5, layer: 1 },
  { col: 14, row: 5, layer: 1 },
  { col: 8, row: 5, layer: 1 },
  { col: 10, row: 5, layer: 1 },
  // Layer 0
  { col: 12, row: 6, layer: 0 },
  { col: 14, row: 6, layer: 0 },
  { col: 16, row: 6, layer: 0 },
  { col: 18, row: 6, layer: 0 },
  { col: 4, row: 6, layer: 0 },
  { col: 6, row: 6, layer: 0 },
  { col: 8, row: 6, layer: 0 },
  { col: 10, row: 6, layer: 0 },
  // Layer 1
  { col: 14, row: 6, layer: 1 },
  { col: 16, row: 6, layer: 1 },
  { col: 6, row: 6, layer: 1 },
  { col: 8, row: 6, layer: 1 },
  // Layer 0
  { col: 14, row: 7, layer: 0 },
  { col: 16, row: 7, layer: 0 },
  { col: 18, row: 7, layer: 0 },
  { col: 20, row: 7, layer: 0 },
  { col: 2, row: 7, layer: 0 },
  { col: 4, row: 7, layer: 0 },
  { col: 6, row: 7, layer: 0 },
  { col: 8, row: 7, layer: 0 },
  // Layer 1
  { col: 16, row: 7, layer: 1 },
  { col: 18, row: 7, layer: 1 },
  { col: 4, row: 7, layer: 1 },
  { col: 6, row: 7, layer: 1 },
  // Layer 0
  { col: 16, row: 8, layer: 0 },
  { col: 18, row: 8, layer: 0 },
  { col: 20, row: 8, layer: 0 },
  { col: 22, row: 8, layer: 0 },
  { col: 0, row: 8, layer: 0 },
  { col: 2, row: 8, layer: 0 },
  { col: 4, row: 8, layer: 0 },
  { col: 6, row: 8, layer: 0 },
  // Layer 1
  { col: 18, row: 8, layer: 1 },
  { col: 20, row: 8, layer: 1 },
  { col: 2, row: 8, layer: 1 },
  { col: 4, row: 8, layer: 1 },
  // Layer 0
  { col: 16, row: 9, layer: 0 },
  { col: 18, row: 9, layer: 0 },
  { col: 20, row: 9, layer: 0 },
  { col: 22, row: 9, layer: 0 },
  { col: 0, row: 9, layer: 0 },
  { col: 2, row: 9, layer: 0 },
  { col: 4, row: 9, layer: 0 },
  { col: 6, row: 9, layer: 0 },
  // Layer 1
  { col: 18, row: 9, layer: 1 },
  { col: 20, row: 9, layer: 1 },
  { col: 2, row: 9, layer: 1 },
  { col: 4, row: 9, layer: 1 },
  // Layer 2 - 24 tiles: centre stacking zone cols 8-14, rows 2-7 (4 cols x 6 rows)
  { col: 8, row: 2, layer: 2 },
  { col: 10, row: 2, layer: 2 },
  { col: 12, row: 2, layer: 2 },
  { col: 14, row: 2, layer: 2 },
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
  { col: 8, row: 6, layer: 2 },
  { col: 10, row: 6, layer: 2 },
  { col: 12, row: 6, layer: 2 },
  { col: 14, row: 6, layer: 2 },
  { col: 8, row: 7, layer: 2 },
  { col: 10, row: 7, layer: 2 },
  { col: 12, row: 7, layer: 2 },
  { col: 14, row: 7, layer: 2 },
  // Layer 3 - 10 tiles: centre spine cols 10-12, rows 3-7 (2 cols x 5 rows)
  { col: 10, row: 3, layer: 3 },
  { col: 12, row: 3, layer: 3 },
  { col: 10, row: 4, layer: 3 },
  { col: 12, row: 4, layer: 3 },
  { col: 10, row: 5, layer: 3 },
  { col: 12, row: 5, layer: 3 },
  { col: 10, row: 6, layer: 3 },
  { col: 12, row: 6, layer: 3 },
  { col: 10, row: 7, layer: 3 },
  { col: 12, row: 7, layer: 3 },
];
