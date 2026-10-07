/**
 * Castle layout — 144 slots.
 *
 * Fortress silhouette with corner towers, perimeter walls, and an interior courtyard.
 *
 * Layer breakdown (top-down; higher layer = more elevated):
 *   Layer 0 —  80 tiles: full castle floor plan (10-col × 8-row rectangle, cols 0–18, rows 0–7)
 *   Layer 1 —  40 tiles: perimeter walls rise — full top row (row 1), left/right tower sides
 *                         (cols 0–2 and 16–18), and full bottom row (row 6); interior courtyard
 *                         (rows 2–5, cols 4–14) remains at ground level only
 *   Layer 2 —  16 tiles: battlement crests on top and bottom wall rows + upper tower sections
 *   Layer 3 —   8 tiles: tallest corner tower caps (cols 0–2 and 16–18, rows 2–3)
 *   Total: 80 + 40 + 16 + 8 = 144
 */

import type { Layout } from "../types";
import { cols, grid, rect, row, rows } from "./build";

export const CASTLE_LAYOUT: Layout = [
  // Layer 0
  ...rect(0, 0, 18, 0, 7),
  // Layer 1
  ...row(1, 1, cols(0, 18)),
  ...row(1, 2, [...cols(0, 6), ...cols(12, 18)]),
  ...grid(1, [...cols(0, 2), ...cols(16, 18)], rows(3, 5)),
  ...row(1, 6, cols(0, 18)),
  // Layer 2
  ...row(2, 1, cols(4, 10)),
  ...grid(2, [...cols(0, 2), ...cols(16, 18)], rows(2, 3)),
  ...row(2, 6, cols(4, 10)),
  // Layer 3
  ...grid(3, [...cols(0, 2), ...cols(16, 18)], rows(2, 3)),
];
