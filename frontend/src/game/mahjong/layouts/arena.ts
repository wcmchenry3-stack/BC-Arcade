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

import type { Layout, Slot } from "../types";
import { rect } from "./build";

/** 12×8 rectangle minus the 8×6 interior (cols 4–18, rows 1–6), row-major. */
function ringLayer(layer: number): Slot[] {
  return rect(layer, 0, 22, 0, 7).filter(
    (s) => !(s.col >= 4 && s.col <= 18 && s.row >= 1 && s.row <= 6)
  );
}

export const ARENA_LAYOUT: Layout = [...ringLayer(0), ...ringLayer(1), ...ringLayer(2)];
