/**
 * The Key layout — 144 slots.
 *
 * Key silhouette: hollow ring bow at top (filled perimeter, empty interior),
 * long narrow shaft, a wide shoulder, and teeth projecting from the bottom.
 *
 * Layer breakdown:
 *   Layer 0 —  80 tiles: hollow bow ring (perimeter of cols 2–18, rows 0–3) +
 *                         shaft (cols 8–12, rows 4–9) + shoulder rows 10–11 +
 *                         teeth rows 12–13 (cols 4–12) + tooth base row 14 (cols 4–18) +
 *                         tooth tip row 15 (cols 8–14)
 *   Layer 1 —  44 tiles: bow interior fill (cols 4–16, rows 1–2) +
 *                         shaft (cols 8–12, rows 4–9) + short teeth (cols 4–8, rows 12–13) +
 *                         tooth base accent (cols 6–12, row 14) + tooth tip (cols 8–10, row 15)
 *   Layer 2 —  16 tiles: bow interior accent (cols 6–12, rows 1–2) +
 *                         shaft side details (cols 10–12, rows 5–6) +
 *                         tooth accent (cols 6–8, row 12) + tooth accent (cols 8–10, row 14)
 *   Layer 3 —   4 tiles: bow center (cols 8–10, rows 1–2)
 *   Total: 80 + 44 + 16 + 4 = 144
 */

import type { Layout } from "../types";
import { cols, grid, rect, row, rows } from "./build";

export const THE_KEY_LAYOUT: Layout = [
  // Layer 0
  ...row(0, 0, cols(2, 18)),
  ...grid(0, [2, 18], rows(1, 2)),
  ...row(0, 3, cols(2, 18)),
  ...rect(0, 8, 12, 4, 9),
  ...row(0, 10, cols(2, 20)),
  ...row(0, 11, cols(4, 18)),
  ...rect(0, 4, 12, 12, 13),
  ...row(0, 14, cols(4, 18)),
  ...row(0, 15, cols(8, 14)),
  // Layer 1
  ...rect(1, 4, 16, 1, 2),
  ...rect(1, 8, 12, 4, 9),
  ...rect(1, 4, 8, 12, 13),
  ...row(1, 14, cols(6, 12)),
  ...row(1, 15, cols(8, 10)),
  // Layer 2
  ...rect(2, 6, 12, 1, 2),
  ...rect(2, 10, 12, 5, 6),
  ...row(2, 12, cols(6, 8)),
  ...row(2, 14, cols(8, 10)),
  // Layer 3
  ...rect(3, 8, 10, 1, 2),
];
