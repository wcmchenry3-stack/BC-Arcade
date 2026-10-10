/**
 * Heart layout — 144 slots.
 *
 * Heart silhouette: two rounded lobes at the top with a valley between them
 * (cols 10–12 empty at rows 0–1), merging into a body that tapers to a downward point.
 *
 * Layer breakdown:
 *   Layer 0 —  80 tiles: left lobe (cols 0–8, rows 0–1) + right lobe (cols 14–22, rows 0–1) +
 *                         full body (cols 0–22, rows 2–5) + taper row 6 + tip row 7
 *   Layer 1 —  44 tiles: lobe highlights (left cols 2–8, right cols 14–20, rows 0–1) +
 *                         center join row 2 + inner body rows 3–4 + lower accent row 5
 *   Layer 2 —  16 tiles: lobe accents (left cols 4–6, right cols 16–18, rows 0–1) +
 *                         body accent (cols 6–12, rows 3–4)
 *   Layer 3 —   4 tiles: left-lobe peak (cols 6–8, rows 0–1)
 *   Total: 80 + 44 + 16 + 4 = 144
 */

import type { Layout } from "../types";
import { cols, grid, rect, row, rows } from "./build";

export const HEART_LAYOUT: Layout = [
  // Layer 0
  ...grid(0, [...cols(0, 8), ...cols(14, 22)], rows(0, 1)),
  ...rect(0, 0, 22, 2, 5),
  ...row(0, 6, cols(2, 20)),
  ...row(0, 7, cols(10, 12)),
  // Layer 1
  ...grid(1, [...cols(2, 8), ...cols(14, 20)], rows(0, 1)),
  ...row(1, 2, cols(2, 20)),
  ...rect(1, 4, 14, 3, 4),
  ...row(1, 5, cols(6, 16)),
  // Layer 2
  ...grid(2, [...cols(4, 6), ...cols(16, 18)], rows(0, 1)),
  ...rect(2, 6, 12, 3, 4),
  // Layer 3
  ...rect(3, 6, 8, 0, 1),
];
