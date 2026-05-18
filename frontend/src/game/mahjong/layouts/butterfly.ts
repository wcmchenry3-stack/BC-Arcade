/**
 * Butterfly layout — 144 slots.
 *
 * Two symmetric wings flanking a central body, viewed from above.
 *
 * Layer breakdown:
 *   Layer 0 —  92 tiles: left wing (42) + right wing mirror (42) + body col 14 rows 0-7 (8)
 *   Layer 1 —  36 tiles: inner wings rows 2-5 (32) + body col 14 rows 2-5 (4)
 *   Layer 2 —  16 tiles: wing peaks + body peak
 *   Total: 92 + 36 + 16 = 144
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

const LEFT_WING: Record<number, number[]> = {
  0: rng(6, 8),
  1: rng(4, 10),
  2: rng(2, 12),
  3: rng(0, 12),
  4: rng(0, 12),
  5: rng(0, 12),
  6: rng(2, 10),
  7: rng(4, 8),
  8: [6],
};

function wingSlots(layer: number, mirror = false) {
  const out: { col: number; row: number; layer: number }[] = [];
  for (const [row, cols] of Object.entries(LEFT_WING)) {
    for (const col of cols) {
      out.push(slot(mirror ? 28 - col : col, Number(row), layer));
    }
  }
  return out;
}

export const BUTTERFLY_LAYOUT: Layout = [
  // Layer 0 — wings + body base
  ...wingSlots(0),
  ...wingSlots(0, true),
  ...[0, 1, 2, 3, 4, 5, 6, 7].map((r) => slot(14, r, 0)),
  // Layer 1 — inner wings + body mid
  ...[2, 3, 4, 5].flatMap((r) => [
    ...rng(4, 10).map((c) => slot(c, r, 1)),
    ...[18, 20, 22, 24].map((c) => slot(c, r, 1)),
    slot(14, r, 1),
  ]),
  // Layer 2 — peaks
  ...[3, 4].flatMap((r) => [
    slot(6, r, 2),
    slot(8, r, 2),
    slot(20, r, 2),
    slot(22, r, 2),
    slot(10, r, 2),
    slot(18, r, 2),
  ]),
  ...[2, 3, 4, 5].map((r) => slot(14, r, 2)),
];

if (BUTTERFLY_LAYOUT.length !== 144) {
  throw new Error(`BUTTERFLY_LAYOUT has ${BUTTERFLY_LAYOUT.length} slots, expected 144`);
}
