/**
 * Zig-Zag layout - 144 slots.
 *
 * An 8-tile-wide diagonal band that sweeps left-to-right across rows 0-4
 * and then returns right-to-left through rows 5-8, with a second rightward
 * pass beginning at row 9.
 *
 * Layer breakdown:
 *   Layer 0 -  80 tiles: full zig-zag band, rows 0-9
 *   Layer 1 -  44 tiles: rows 1-5 full band + row-6 inner 4 tiles
 *   Layer 2 -  16 tiles: rows 2-5 inner 4-wide strip
 *   Layer 3 -   4 tiles: apex tiles at rows 3-4
 *   Total: 80 + 44 + 16 + 4 = 144
 */

import type { Layout } from "../types";
import { cols, row } from "./build";

export const ZIG_ZAG_LAYOUT: Layout = [
  // Layer 0
  ...row(0, 0, cols(0, 14)),
  ...row(0, 1, cols(2, 16)),
  ...row(0, 2, cols(4, 18)),
  ...row(0, 3, cols(6, 20)),
  ...row(0, 4, cols(8, 22)),
  ...row(0, 5, cols(6, 20)),
  ...row(0, 6, cols(4, 18)),
  ...row(0, 7, cols(2, 16)),
  ...row(0, 8, cols(0, 14)),
  ...row(0, 9, cols(2, 16)),
  // Layer 1
  ...row(1, 1, cols(2, 16)),
  ...row(1, 2, cols(4, 18)),
  ...row(1, 3, cols(6, 20)),
  ...row(1, 4, cols(8, 22)),
  ...row(1, 5, cols(6, 20)),
  ...row(1, 6, cols(8, 14)),
  // Layer 2
  ...row(2, 2, cols(8, 14)),
  ...row(2, 3, cols(10, 16)),
  ...row(2, 4, cols(12, 18)),
  ...row(2, 5, cols(10, 16)),
  // Layer 3
  ...row(3, 3, cols(12, 14)),
  ...row(3, 4, cols(14, 16)),
];
