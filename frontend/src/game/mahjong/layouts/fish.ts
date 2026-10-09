/**
 * Fish layout — 144 slots.
 *
 * Horizontally oriented oval body with a tail fin on the left,
 * layered "scales" rising toward the centre.
 *
 * Layer breakdown:
 *   Layer 0 —  96 tiles: oval body (84) + tail fin cols 0,2 rows 3-8 (12)
 *   Layer 1 —  36 tiles: scale band rows 3-8, cols 8-18 (6×6)
 *   Layer 2 —  12 tiles: inner scales rows 4-7, cols 12-16 (4×3)
 *   Total: 96 + 36 + 12 = 144
 */

import type { Layout } from "../types";
import { cols, grid, slot } from "./build";

const BODY_ROWS: Record<number, number[]> = {
  2: cols(8, 20),
  3: cols(6, 24),
  4: cols(4, 26),
  5: cols(4, 28),
  6: cols(4, 28),
  7: cols(4, 26),
  8: cols(6, 24),
  9: cols(8, 20),
};

export const FISH_LAYOUT: Layout = [
  // Layer 0 — body oval
  ...Object.entries(BODY_ROWS).flatMap(([row, cols]) =>
    cols.map((col) => slot(col, Number(row), 0))
  ),
  // Layer 0 — tail fin
  ...grid(0, [0, 2], [3, 4, 5, 6, 7, 8]),
  // Layer 1 — scales
  ...grid(1, cols(8, 18), [3, 4, 5, 6, 7, 8]),
  // Layer 2 — inner scales
  ...grid(2, cols(12, 16), [4, 5, 6, 7]),
];
