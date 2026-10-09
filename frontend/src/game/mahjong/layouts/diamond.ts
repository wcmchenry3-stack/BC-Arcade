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
import { cols, rect, row } from "./build";

export const DIAMOND_LAYOUT: Layout = [
  // Layer 0
  ...row(0, 0, cols(8, 14)),
  ...row(0, 1, cols(6, 16)),
  ...row(0, 2, cols(4, 18)),
  ...row(0, 3, cols(2, 20)),
  ...rect(0, 0, 22, 4, 5),
  ...row(0, 6, cols(2, 20)),
  ...row(0, 7, cols(4, 18)),
  ...row(0, 8, cols(6, 16)),
  ...row(0, 9, cols(8, 14)),
  // Layer 1
  ...row(1, 1, cols(10, 12)),
  ...row(1, 2, cols(8, 14)),
  ...row(1, 3, cols(6, 16)),
  ...rect(1, 4, 18, 4, 5),
  ...row(1, 6, cols(6, 16)),
  ...row(1, 7, cols(8, 14)),
  ...row(1, 8, cols(10, 12)),
  // Layer 2
  ...row(2, 2, cols(10, 12)),
  ...rect(2, 8, 14, 3, 5),
  ...row(2, 6, cols(10, 12)),
  // Layer 3
  ...rect(3, 10, 12, 3, 6),
];
