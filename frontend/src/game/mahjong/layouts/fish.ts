/**
 * Fish layout — 144 slots.
 *
 * Horizontally oriented oval body with a tail fin on the left,
 * layered "scales" rising toward the centre.
 *
 * Layer breakdown:
 *   Layer 0 —  96 tiles: oval body (84) + tail fin cols 0,2 rows 3-8 (12)
 *   Layer 1 —  36 tiles: scale band rows 3-8, cols 8-18 (6×6)
 *   Layer 2 —  12 tiles: inner scales rows 4-7, cols 12-16 (4×3)
 *   Total: 96 + 36 + 12 = 144
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

const BODY_ROWS: Record<number, number[]> = {
  2: rng(8, 20),
  3: rng(6, 24),
  4: rng(4, 26),
  5: rng(4, 28),
  6: rng(4, 28),
  7: rng(4, 26),
  8: rng(6, 24),
  9: rng(8, 20),
};

export const FISH_LAYOUT: Layout = [
  // Layer 0 — body oval
  ...Object.entries(BODY_ROWS).flatMap(([row, cols]) =>
    cols.map((col) => slot(col, Number(row), 0))
  ),
  // Layer 0 — tail fin
  ...[3, 4, 5, 6, 7, 8].flatMap((r) => [slot(0, r, 0), slot(2, r, 0)]),
  // Layer 1 — scales
  ...[3, 4, 5, 6, 7, 8].flatMap((r) => rng(8, 18).map((c) => slot(c, r, 1))),
  // Layer 2 — inner scales
  ...[4, 5, 6, 7].flatMap((r) => rng(12, 16).map((c) => slot(c, r, 2))),
];

if (FISH_LAYOUT.length !== 144) {
  throw new Error(`FISH_LAYOUT has ${FISH_LAYOUT.length} slots, expected 144`);
}
