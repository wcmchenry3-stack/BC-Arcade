/**
 * Cat layout — 144 slots.
 *
 * Cat silhouette viewed from above: two pointed ears, a round head, and a body with paws.
 *
 * Layer breakdown:
 *   Layer 0 —  96 tiles: ears (12) + head rows 2-6 (40) + body rows 7-12 (36) + paws (8)
 *   Layer 1 —  34 tiles: head inner rows 3-5 (18) + body inner rows 8-11 (16)
 *   Layer 2 —  14 tiles: face rows 4-5 (6) + body peak rows 9-10 (8)
 *   Total: 96 + 34 + 14 = 144
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

export const CAT_LAYOUT: Layout = [
  // Layer 0 — silhouette
  // Ears (left then right, per row)
  ...[0, 1].flatMap((r) => [
    ...[8, 10, 12].map((c) => slot(c, r, 0)),
    ...[18, 20, 22].map((c) => slot(c, r, 0)),
  ]),
  // Head
  ...[2, 3, 4, 5, 6].flatMap((r) => rng(8, 22).map((c) => slot(c, r, 0))),
  // Body
  ...[7, 8, 9, 10, 11, 12].flatMap((r) => rng(10, 20).map((c) => slot(c, r, 0))),
  // Paws
  ...[13, 14].flatMap((r) => [slot(10, r, 0), slot(12, r, 0), slot(18, r, 0), slot(20, r, 0)]),
  // Layer 1 — inner head + body
  ...[3, 4, 5].flatMap((r) => rng(10, 20).map((c) => slot(c, r, 1))),
  ...[8, 9, 10, 11].flatMap((r) => rng(12, 18).map((c) => slot(c, r, 1))),
  // Layer 2 — face + body peak
  ...[4, 5].flatMap((r) => [slot(12, r, 2), slot(14, r, 2), slot(16, r, 2)]),
  ...[9, 10].flatMap((r) => rng(12, 18).map((c) => slot(c, r, 2))),
];

if (CAT_LAYOUT.length !== 144) {
  throw new Error(`CAT_LAYOUT has ${CAT_LAYOUT.length} slots, expected 144`);
}
