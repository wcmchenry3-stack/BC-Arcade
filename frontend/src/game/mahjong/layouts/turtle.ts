/**
 * Turtle layout — 144 slots (#891).
 *
 * Coordinate system: tiles are 2 grid units wide, 1 unit tall.
 * Adjacent tiles in the same row step by col±2. Stacked tiles share the same
 * (col, row) and differ only in layer.
 *
 * Layer breakdown:
 *   Layer 0 — 64 tiles: body (rows 1–6, cols 4–18), head (rows 3–4, cols 20–22),
 *              tail (rows 3–4, cols 0–2), top/bottom feet (row 0/7, cols 4,6,16,18)
 *   Layer 1 — 36 tiles: body (rows 2–5, cols 4–18), head (rows 3–4, col 20),
 *              tail (rows 3–4, col 2)
 *   Layer 2 — 24 tiles: centre (rows 2–5, cols 6–16)
 *   Layer 3 — 12 tiles: centre (rows 3–4, cols 6–16)
 *   Layer 4 —  8 tiles: peak (rows 3–4, cols 8–14)
 *   Total: 64 + 36 + 24 + 12 + 8 = 144
 */

import type { Layout } from "../types";
import { cols, grid, rows } from "./build";

export const TURTLE_LAYOUT: Layout = [
  // --- Layer 0 ---
  // Body
  ...grid(0, cols(4, 18), rows(1, 6)),
  // Head (right protrusion)
  ...grid(0, [20, 22], [3, 4]),
  // Tail (left protrusion)
  ...grid(0, [0, 2], [3, 4]),
  // Top feet
  ...grid(0, [4, 6, 16, 18], [0]),
  // Bottom feet
  ...grid(0, [4, 6, 16, 18], [7]),

  // --- Layer 1 ---
  // Body
  ...grid(1, cols(4, 18), rows(2, 5)),
  // Head
  ...grid(1, [20], [3, 4]),
  // Tail
  ...grid(1, [2], [3, 4]),

  // --- Layer 2 ---
  ...grid(2, cols(6, 16), rows(2, 5)),

  // --- Layer 3 ---
  ...grid(3, cols(6, 16), [3, 4]),

  // --- Layer 4 ---
  ...grid(4, cols(8, 14), [3, 4]),
];
