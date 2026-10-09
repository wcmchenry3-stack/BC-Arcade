/**
 * Anchor layout — 144 slots.
 *
 * Nautical anchor silhouette: ring at top, vertical shaft, wide stock crossbar,
 * and curved flukes at the bottom.
 *
 * Layer breakdown:
 *   Layer 0 —  80 tiles: full anchor silhouette — ring block (cols 2–16, rows 0–4),
 *                         shaft (cols 8–12, rows 5–8), stock/crossbar (cols 0–20, rows 9–10),
 *                         fluke tips (cols 8–12, rows 11–12)
 *   Layer 1 —  44 tiles: anchor outline — ring top row + left/right ring edges (sides only,
 *                         hollow interior) + ring bottom crossbar + shaft body + outer stock
 *                         ends + fluke tips
 *   Layer 2 —  16 tiles: inner ring arc (cols 4–14, rows 1–2) + shaft arm details (rows 5–6)
 *   Layer 3 —   4 tiles: ring center / keystone (cols 8–10, rows 1–2)
 *   Total: 80 + 44 + 16 + 4 = 144
 */

import type { Layout } from "../types";
import { cols, grid, rect, row, rows } from "./build";

export const ANCHOR_LAYOUT: Layout = [
  // Layer 0
  ...rect(0, 2, 16, 0, 4),
  ...rect(0, 8, 12, 5, 8),
  ...rect(0, 0, 20, 9, 10),
  ...rect(0, 8, 12, 11, 12),
  // Layer 1
  ...row(1, 0, cols(2, 16)),
  ...grid(1, [2, 16], rows(1, 3)),
  ...row(1, 4, cols(2, 16)),
  ...rect(1, 8, 12, 5, 8),
  ...grid(1, [...cols(0, 2), ...cols(18, 20)], rows(9, 10)),
  ...row(1, 11, [8, 12]),
  // Layer 2
  ...rect(2, 4, 14, 1, 2),
  ...grid(2, [8, 12], rows(5, 6)),
  // Layer 3
  ...rect(3, 8, 10, 1, 2),
];
