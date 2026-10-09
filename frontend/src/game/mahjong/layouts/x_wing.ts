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
import { cols, rect, row } from "./build";

export const X_WING_LAYOUT: Layout = [
  // Layers 0 and 1, row by row: each row emits its layer-0 band, then the
  // inner layer-1 band on top of it. Below the crossing (rows 5-9) the
  // right-hand arm is listed before the left.
  ...row(0, 0, [...cols(0, 6), ...cols(16, 22)]),
  ...row(1, 0, [...cols(2, 4), ...cols(18, 20)]),
  ...row(0, 1, [...cols(2, 8), ...cols(14, 20)]),
  ...row(1, 1, [...cols(4, 6), ...cols(16, 18)]),
  ...row(0, 2, cols(4, 18)),
  ...row(1, 2, [...cols(6, 8), ...cols(14, 16)]),
  ...row(0, 3, cols(6, 16)),
  ...row(1, 3, cols(8, 14)),
  ...row(0, 4, cols(8, 14)),
  ...row(1, 4, cols(10, 12)),
  ...row(0, 5, [...cols(10, 16), ...cols(6, 8)]),
  ...row(1, 5, [...cols(12, 14), ...cols(8, 10)]),
  ...row(0, 6, [...cols(12, 18), ...cols(4, 10)]),
  ...row(1, 6, [...cols(14, 16), ...cols(6, 8)]),
  ...row(0, 7, [...cols(14, 20), ...cols(2, 8)]),
  ...row(1, 7, [...cols(16, 18), ...cols(4, 6)]),
  ...row(0, 8, [...cols(16, 22), ...cols(0, 6)]),
  ...row(1, 8, [...cols(18, 20), ...cols(2, 4)]),
  ...row(0, 9, [...cols(16, 22), ...cols(0, 6)]),
  ...row(1, 9, [...cols(18, 20), ...cols(2, 4)]),
  // Layer 2
  ...rect(2, 8, 14, 2, 7),
  // Layer 3
  ...rect(3, 10, 12, 3, 7),
];
