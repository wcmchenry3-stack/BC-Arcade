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

function slot(col: number, row: number, layer: number) {
  return { col, row, layer };
}

function rng(start: number, stopInclusive: number, step = 2): number[] {
  const out: number[] = [];
  for (let v = start; v <= stopInclusive; v += step) out.push(v);
  return out;
}

export const SNOWFLAKE_LAYOUT: Layout = [
  // Layer 0 — center
  ...[4, 5, 6, 7].flatMap((r) => rng(8, 20).map((c) => slot(c, r, 0))),
  // Up arm: cols 12,14,16 rows 0-3
  ...[0, 1, 2, 3].flatMap((r) => [slot(12, r, 0), slot(14, r, 0), slot(16, r, 0)]),
  // Down arm: cols 12,14,16 rows 8-11
  ...[8, 9, 10, 11].flatMap((r) => [slot(12, r, 0), slot(14, r, 0), slot(16, r, 0)]),
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
    ...rng(22, 28).map((c) => slot(c, r, 0)),
    ...rng(0, 6).map((c) => slot(c, r, 0)),
  ]),
  // Layer 1 — center raised + arm tips
  ...[4, 5, 6, 7].flatMap((r) => rng(10, 18).map((c) => slot(c, r, 1))),
  ...[2, 3].flatMap((r) => [slot(12, r, 1), slot(14, r, 1), slot(16, r, 1)]),
  ...[8, 9].flatMap((r) => [slot(12, r, 1), slot(14, r, 1), slot(16, r, 1)]),
  // Symmetric: col 22 right mirrors col 6 left (28 − 22 = 6)
  ...[5, 6].flatMap((r) => [slot(22, r, 1), slot(6, r, 1)]),
  // Layer 2 — core peak
  ...[5, 6].flatMap((r) => rng(12, 18).map((c) => slot(c, r, 2))),
];

if (SNOWFLAKE_LAYOUT.length !== 144) {
  throw new Error(`SNOWFLAKE_LAYOUT has ${SNOWFLAKE_LAYOUT.length} slots, expected 144`);
}
