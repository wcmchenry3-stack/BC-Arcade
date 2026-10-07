/**
 * Snowflake layout — 144 slots.
 *
 * 6-fold radial symmetry (approximate on rectangular grid):
 * central hex-ish core with 6 arms (up/down + 4 diagonal) plus horizontal extensions.
 *
 * Layer breakdown:
 *   Layer 0 — 100 tiles: center (28) + up/down arms (24) + 4 diagonal arms (32) + horizontal (16)
 *   Layer 1 —  36 tiles: center raised (20) + arm inner tips (12) + horiz inner symmetric (4)
 *   Layer 2 —   8 tiles: core peak rows 5-6, cols 12-18
 *   Total: 100 + 36 + 8 = 144
 */

import type { Layout } from "../types";
import { cols, grid, slot } from "./build";

export const SNOWFLAKE_LAYOUT: Layout = [
  // Layer 0 — center
  ...grid(0, cols(8, 20), [4, 5, 6, 7]),
  // Up arm: cols 12,14,16 rows 0-3
  ...grid(0, [12, 14, 16], [0, 1, 2, 3]),
  // Down arm: cols 12,14,16 rows 8-11
  ...grid(0, [12, 14, 16], [8, 9, 10, 11]),
  // Upper-right diagonal
  ...(
    [
      [22, 3],
      [24, 2],
      [26, 1],
      [28, 0],
      [20, 3],
      [22, 2],
      [24, 1],
      [26, 0],
    ] as [number, number][]
  ).map(([c, r]) => slot(c, r, 0)),
  // Lower-right diagonal
  ...(
    [
      [22, 8],
      [24, 9],
      [26, 10],
      [28, 11],
      [20, 8],
      [22, 9],
      [24, 10],
      [26, 11],
    ] as [number, number][]
  ).map(([c, r]) => slot(c, r, 0)),
  // Upper-left diagonal
  ...(
    [
      [6, 3],
      [4, 2],
      [2, 1],
      [0, 0],
      [8, 3],
      [6, 2],
      [4, 1],
      [2, 0],
    ] as [number, number][]
  ).map(([c, r]) => slot(c, r, 0)),
  // Lower-left diagonal
  ...(
    [
      [6, 8],
      [4, 9],
      [2, 10],
      [0, 11],
      [8, 8],
      [6, 9],
      [4, 10],
      [2, 11],
    ] as [number, number][]
  ).map(([c, r]) => slot(c, r, 0)),
  // Horizontal extensions
  ...[5, 6].flatMap((r) => [
    ...cols(22, 28).map((c) => slot(c, r, 0)),
    ...cols(0, 6).map((c) => slot(c, r, 0)),
  ]),
  // Layer 1 — center raised + arm tips
  ...grid(1, cols(10, 18), [4, 5, 6, 7]),
  ...grid(1, [12, 14, 16], [2, 3]),
  ...grid(1, [12, 14, 16], [8, 9]),
  // Symmetric: col 22 right mirrors col 6 left (28 − 22 = 6)
  ...grid(1, [22, 6], [5, 6]),
  // Layer 2 — core peak
  ...grid(2, cols(12, 18), [5, 6]),
];
