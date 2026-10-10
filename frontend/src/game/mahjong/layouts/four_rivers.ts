/**
 * Four Rivers layout — 144 slots.
 *
 * Four parallel vertical rivers running top-to-bottom, mostly single-layer
 * with a small layer-1 highlight at each river's midpoint.
 *
 * Layer breakdown:
 *   Layer 0 — 128 tiles: 4 rivers × 2 cols × 16 rows
 *     River 1: cols  4,  6 — rows 0–15
 *     River 2: cols 10, 12 — rows 0–15
 *     River 3: cols 16, 18 — rows 0–15
 *     River 4: cols 22, 24 — rows 0–15
 *   Layer 1 —  16 tiles: left col of each river × 4 centre rows (6–9)
 *     River 1: col  4 — rows 6–9
 *     River 2: col 10 — rows 6–9
 *     River 3: col 16 — rows 6–9
 *     River 4: col 22 — rows 6–9
 *   Total: 128 + 16 = 144
 */

import type { Layout } from "../types";
import { grid, rows } from "./build";

export const FOUR_RIVERS_LAYOUT: Layout = [
  // Layer 0 — river bodies
  ...grid(0, [4, 6], rows(0, 15)),
  ...grid(0, [10, 12], rows(0, 15)),
  ...grid(0, [16, 18], rows(0, 15)),
  ...grid(0, [22, 24], rows(0, 15)),
  // Layer 1 — midpoint highlights
  ...grid(1, [4], rows(6, 9)),
  ...grid(1, [10], rows(6, 9)),
  ...grid(1, [16], rows(6, 9)),
  ...grid(1, [22], rows(6, 9)),
];
