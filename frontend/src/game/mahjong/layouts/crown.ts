/**
 * Crown layout — 144 slots.
 *
 * Royal crown silhouette: five symmetrically-spaced tooth points rising from
 * a rectangular body and a wide base band.
 *
 * Layer breakdown:
 *   Layer 0 —  80 tiles: 5 tooth points (cols 2/6/10/14/18, rows 0–3) + body band
 *                         (cols 0–22, rows 4–5) + base (cols 0–22, rows 6–8)
 *   Layer 1 —  44 tiles: tooth-tip highlights (cols 2/6/10/14/18, rows 0–1) +
 *                         inner body (cols 2–20, rows 4–5) + symmetric base taper
 *                         (cols 4–18 row 6, cols 6–16 row 7)
 *   Layer 2 —  16 tiles: between-teeth fill (cols 4/8/12/16, rows 0–1) +
 *                         center body (cols 6–12, rows 4–5)
 *   Layer 3 —   4 tiles: crown apex (cols 8–10, rows 4–5)
 *   Total: 80 + 44 + 16 + 4 = 144
 */

import type { Layout } from "../types";
import { cols, grid, rect, row, rows } from "./build";

export const CROWN_LAYOUT: Layout = [
  // Layer 0
  ...grid(0, cols(2, 18, 4), rows(0, 3)),
  ...rect(0, 0, 22, 4, 8),
  // Layer 1
  ...grid(1, cols(2, 18, 4), rows(0, 1)),
  ...rect(1, 2, 20, 4, 5),
  ...row(1, 6, cols(4, 18)),
  ...row(1, 7, cols(6, 16)),
  // Layer 2
  ...grid(2, cols(4, 16, 4), rows(0, 1)),
  ...rect(2, 6, 12, 4, 5),
  // Layer 3
  ...rect(3, 8, 10, 4, 5),
];
