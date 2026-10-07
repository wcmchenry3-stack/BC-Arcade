/**
 * Maze layout - 144 slots.
 *
 * Rectangular corridors and walls creating bottleneck chokepoints.  The outer
 * border is fully walled; interior walls define two large open corridors
 * (rows 3 and 9) that span the width, with vertical wall segments creating
 * rooms and tight passages.
 *
 * Layer breakdown:
 *   Layer 0 -  80 tiles: all maze wall positions, rows 0-11
 *   Layer 1 -  44 tiles: outer border walls (top, bottom, left, right)
 *   Layer 2 -  16 tiles: internal H-wall rows 4 and 8 (plus col-8 rows 5-6 and col-18 rows 1-2)
 *   Layer 3 -   4 tiles: wall-junction corners at rows 4 and 8
 *   Total: 80 + 44 + 16 + 4 = 144
 */

import type { Layout } from "../types";
import { cols, grid, row, rows, slot } from "./build";

/** Irregular (col, row) cells, emitted in the listed order. */
function cells(layer: number, pairs: readonly (readonly [number, number])[]) {
  return pairs.map(([c, r]) => slot(c, r, layer));
}

export const MAZE_LAYOUT: Layout = [
  // Layer 0
  ...row(0, 0, cols(0, 22)),
  ...row(0, 1, [0, 6, 18, 22]),
  ...row(0, 2, [0, 4, ...cols(6, 22, 4)]),
  ...row(0, 3, [0, 22]),
  ...row(0, 4, [...cols(0, 4), ...cols(8, 10), 14, 20, 22]),
  ...row(0, 5, [...cols(0, 8, 4), 22]),
  ...row(0, 6, [...cols(0, 8, 4), ...cols(14, 18), 22]),
  ...row(0, 7, [0, 4, 12, 22]),
  ...row(0, 8, [0, 4, ...cols(6, 8), 12, 16, 18, 22]),
  ...row(0, 9, [0, 22]),
  ...row(0, 10, [...cols(0, 8), ...cols(12, 16), ...cols(20, 22)]),
  ...row(0, 11, cols(0, 22)),
  // Layer 1 — left wall, then top/bottom borders column by column, then right wall
  ...grid(1, [0], rows(0, 11)),
  ...cols(2, 20).flatMap((c) => [slot(c, 0, 1), slot(c, 11, 1)]),
  ...grid(1, [22], rows(0, 11)),
  // Layer 2 — H-walls on rows 4 and 8 (interleaved), then the two vertical stubs
  ...cells(2, [
    [2, 4],
    [4, 4],
    [4, 8],
    [6, 8],
    [8, 4],
    [8, 8],
    [10, 4],
    [12, 8],
    [14, 4],
    [16, 8],
    [18, 8],
    [20, 4],
  ]),
  ...grid(2, [8], rows(5, 6)),
  ...grid(2, [18], rows(1, 2)),
  // Layer 3
  ...row(3, 4, [2, 20]),
  ...row(3, 8, [4, 18]),
];
