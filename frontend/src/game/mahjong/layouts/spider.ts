/**
 * Spider layout — 144 slots.
 *
 * Central body with 8 legs radiating outward (4 cardinal + 4 diagonal).
 *
 * Layer breakdown:
 *   Layer 0 — 106 tiles: body (42) + 8 legs 2-wide × 4-long each (64)
 *   Layer 1 —  32 tiles: inner body raised (20) + body-edge columns (12)
 *   Layer 2 —   6 tiles: body peak rows 6-7, cols 12-16
 *   Total: 106 + 32 + 6 = 144
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

export const SPIDER_LAYOUT: Layout = [
  // Layer 0 — body rows 4-9, cols 8-20
  ...[4, 5, 6, 7, 8, 9].flatMap((r) => rng(8, 20).map((c) => slot(c, r, 0))),
  // Horizontal legs
  ...[5, 6].flatMap((r) => [
    ...rng(0, 6).map((c) => slot(c, r, 0)),
    ...rng(22, 28).map((c) => slot(c, r, 0)),
  ]),
  // Vertical legs
  ...[0, 1, 2, 3].flatMap((r) => [slot(12, r, 0), slot(14, r, 0)]),
  ...[10, 11, 12, 13].flatMap((r) => [slot(12, r, 0), slot(14, r, 0)]),
  // Top-left diagonal
  ...(
    [
      [8, 3],
      [6, 2],
      [4, 1],
      [2, 0],
      [6, 3],
      [4, 2],
      [2, 1],
      [0, 0],
    ] as [number, number][]
  ).map(([c, r]) => slot(c, r, 0)),
  // Top-right diagonal
  ...(
    [
      [20, 3],
      [22, 2],
      [24, 1],
      [26, 0],
      [22, 3],
      [24, 2],
      [26, 1],
      [28, 0],
    ] as [number, number][]
  ).map(([c, r]) => slot(c, r, 0)),
  // Bottom-left diagonal
  ...(
    [
      [8, 10],
      [6, 11],
      [4, 12],
      [2, 13],
      [6, 10],
      [4, 11],
      [2, 12],
      [0, 13],
    ] as [number, number][]
  ).map(([c, r]) => slot(c, r, 0)),
  // Bottom-right diagonal
  ...(
    [
      [20, 10],
      [22, 11],
      [24, 12],
      [26, 13],
      [22, 10],
      [24, 11],
      [26, 12],
      [28, 13],
    ] as [number, number][]
  ).map(([c, r]) => slot(c, r, 0)),
  // Layer 1 — inner body + edge columns
  ...[5, 6, 7, 8].flatMap((r) => rng(10, 18).map((c) => slot(c, r, 1))),
  ...[4, 5, 6, 7, 8, 9].flatMap((r) => [slot(8, r, 1), slot(20, r, 1)]),
  // Layer 2 — body peak
  ...[6, 7].flatMap((r) => [slot(12, r, 2), slot(14, r, 2), slot(16, r, 2)]),
];

if (SPIDER_LAYOUT.length !== 144) {
  throw new Error(`SPIDER_LAYOUT has ${SPIDER_LAYOUT.length} slots, expected 144`);
}
