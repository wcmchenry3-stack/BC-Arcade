/**
 * Pyramid layout — 144 slots.
 *
 * Stepped pyramid viewed from above: wide base tapering inward each layer
 * until a flat 4-column peak at layer 4.
 *
 * Layer breakdown:
 *   Layer 0 — 44 tiles: rows 2–5, cols 4–24 (11 cols × 4 rows)
 *   Layer 1 — 36 tiles: rows 2–5, cols 6–22 (9 cols × 4 rows)
 *   Layer 2 — 28 tiles: rows 2–5, cols 8–20 (7 cols × 4 rows)
 *   Layer 3 — 20 tiles: rows 2–5, cols 10–18 (5 cols × 4 rows)
 *   Layer 4 — 16 tiles: rows 2–5, cols 12–18 (4 cols × 4 rows)
 *   Total: 44 + 36 + 28 + 20 + 16 = 144
 */

import type { Layout } from "../types";
import { cols, grid } from "./build";

const ROWS = [2, 3, 4, 5];

export const PYRAMID_LAYOUT: Layout = [
  ...grid(0, cols(4, 24), ROWS),
  ...grid(1, cols(6, 22), ROWS),
  ...grid(2, cols(8, 20), ROWS),
  ...grid(3, cols(10, 18), ROWS),
  ...grid(4, cols(12, 18), ROWS),
];
