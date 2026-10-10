/**
 * Concentric Squares layout - 144 slots.
 *
 * Four nested filled rectangles create a "squares within squares" silhouette.
 * Each inner rectangle shares grid positions with all outer rectangles at lower
 * layers, so inner tiles are stacked deepest and must be uncovered from the
 * outside in.
 *
 * Layer breakdown:
 *   Layer 0 -  80 tiles: outer rectangle, cols 2-20, rows 2-9
 *   Layer 1 -  40 tiles: second rectangle, cols 4-18, rows 3-7
 *   Layer 2 -  16 tiles: third rectangle, cols 8-14, rows 4-7
 *   Layer 3 -   8 tiles: innermost core, cols 8-14, rows 5-6
 *   Total: 80 + 40 + 16 + 8 = 144
 */

import type { Layout } from "../types";
import { rect } from "./build";

export const CONCENTRIC_SQUARES_LAYOUT: Layout = [
  // Layer 0
  ...rect(0, 2, 20, 2, 9),
  // Layer 1
  ...rect(1, 4, 18, 3, 7),
  // Layer 2
  ...rect(2, 8, 14, 4, 7),
  // Layer 3
  ...rect(3, 8, 14, 5, 6),
];
