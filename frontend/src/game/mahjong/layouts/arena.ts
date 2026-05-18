/**
 * Arena layout — 144 slots.
 *
 * Ring shape with 2-tile-wide walls and hollow center; 3 stacked layers
 * form high coliseum-style walls around an empty interior.
 *
 * Layer breakdown (identical ring per layer):
 *   Top row (row 0)    — 12 tiles: full width, cols 0–22
 *   Side rows (1–6)    — 24 tiles: cols 0 & 2 (left wall) + cols 20 & 22 (right wall)
 *   Bottom row (row 7) — 12 tiles: full width, cols 0–22
 *   Per-layer total: 12 + 24 + 12 = 48 tiles
 *
 *   Layer 0 — 48 tiles
 *   Layer 1 — 48 tiles
 *   Layer 2 — 48 tiles
 *   Total: 48 × 3 = 144
 *
 * Interior void: rows 1–6, cols 4–18 (8 cols × 6 rows = 48 positions, all empty).
 */

import type { Layout } from "../types";

function range(start: number, stopInclusive: number, step: number): number[] {
  const out: number[] = [];
  for (let v = start; v <= stopInclusive; v += step) out.push(v);
  return out;
}

function ringLayer(layer: number): { col: number; row: number; layer: number }[] {
  const outerCols = range(0, 22, 2);
  const outerRows = [0, 1, 2, 3, 4, 5, 6, 7];
  const innerCols = new Set(range(4, 18, 2));
  const innerRows = new Set([1, 2, 3, 4, 5, 6]);
  const out: { col: number; row: number; layer: number }[] = [];
  for (const row of outerRows) {
    for (const col of outerCols) {
      if (!(innerCols.has(col) && innerRows.has(row))) {
        out.push({ col, row, layer });
      }
    }
  }
  return out;
}

export const ARENA_LAYOUT: Layout = [...ringLayer(0), ...ringLayer(1), ...ringLayer(2)];

if (ARENA_LAYOUT.length !== 144) {
  throw new Error(`ARENA_LAYOUT has ${ARENA_LAYOUT.length} slots, expected 144`);
}
