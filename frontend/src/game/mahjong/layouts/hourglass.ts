/**
 * Hourglass layout — 144 slots.
 *
 * Hourglass silhouette: wide top and bottom bands connected by a narrow
 * waist in the middle, symmetric top-to-bottom.
 *
 * Layer breakdown:
 *   Layer 0 —  80 tiles: outer silhouette — full top (cols 0–22, row 0) tapering
 *                         inward to waist (cols 8–14, rows 4–5) then expanding back
 *                         to full bottom (cols 0–22, row 9)
 *   Layer 1 —  44 tiles: inner surface — top taper (rows 0–2) + waist column group
 *                         (cols 8–12, rows 3–6) + bottom taper (row 7)
 *   Layer 2 —  16 tiles: top and bottom accent bands (cols 4–18, rows 0 and 9)
 *   Layer 3 —   4 tiles: waist center (cols 10–12, rows 4–5)
 *   Total: 80 + 44 + 16 + 4 = 144
 */

import type { Layout } from "../types";
import { cols, rect, row } from "./build";

export const HOURGLASS_LAYOUT: Layout = [
  // Layer 0
  ...row(0, 0, cols(0, 22)),
  ...row(0, 1, cols(2, 20)),
  ...row(0, 2, cols(4, 18)),
  ...row(0, 3, cols(6, 16)),
  ...rect(0, 8, 14, 4, 5),
  ...row(0, 6, cols(6, 16)),
  ...row(0, 7, cols(4, 18)),
  ...row(0, 8, cols(2, 20)),
  ...row(0, 9, cols(0, 22)),
  // Layer 1
  ...row(1, 0, cols(2, 20)),
  ...row(1, 1, cols(4, 18)),
  ...row(1, 2, cols(6, 16)),
  ...rect(1, 8, 12, 3, 6),
  ...row(1, 7, cols(4, 18)),
  // Layer 2
  ...row(2, 0, cols(4, 18)),
  ...row(2, 9, cols(4, 18)),
  // Layer 3
  ...rect(3, 10, 12, 4, 5),
];
