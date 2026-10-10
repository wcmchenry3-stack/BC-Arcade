/**
 * Double Pyramid layout — 144 slots.
 *
 * Two pyramids side by side sharing a common wide base, each stepping inward
 * at higher layers to form twin peaks.
 *
 * Layer breakdown:
 *   Layer 0 —  72 tiles: shared base rectangle (15-col × 4-row, cols 0–28, rows 5–8) +
 *                         lower step row (cols 2–24, row 9)
 *   Layer 1 —  48 tiles: two pyramid mid-sections — left (cols 2–12, rows 5–8) and
 *                         right (cols 16–26, rows 5–8); col 14 gap is the valley between peaks
 *   Layer 2 —  16 tiles: two pyramid inner steps — left (cols 4–10) and right (cols 18–24),
 *                         rows 5–6
 *   Layer 3 —   8 tiles: two pyramid peaks — left (cols 6–8) and right (cols 20–22), rows 5–6
 *   Total: 72 + 48 + 16 + 8 = 144
 */

import type { Layout } from "../types";
import { cols, grid, rect, row, rows } from "./build";

export const DOUBLE_PYRAMID_LAYOUT: Layout = [
  // Layer 0
  ...rect(0, 0, 28, 5, 8),
  ...row(0, 9, cols(2, 24)),
  // Layer 1
  ...grid(1, [...cols(2, 12), ...cols(16, 26)], rows(5, 8)),
  // Layer 2
  ...grid(2, [...cols(4, 10), ...cols(18, 24)], rows(5, 6)),
  // Layer 3
  ...grid(3, [...cols(6, 8), ...cols(20, 22)], rows(5, 6)),
];
