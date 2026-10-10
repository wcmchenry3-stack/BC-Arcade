/**
 * Square layout — 144 slots.
 *
 * Flat wide rectangle — broad footprint, 2 layers.
 * The second layer is inset by one column on each side.
 *
 * Layer breakdown:
 *   Layer 0 — 80 tiles: rows 1–8, cols 4–22 (10 cols × 8 rows)
 *   Layer 1 — 64 tiles: rows 1–8, cols 6–20  (8 cols × 8 rows)
 *   Total: 80 + 64 = 144
 */

import type { Layout } from "../types";
import { cols, grid } from "./build";

const ROWS = [1, 2, 3, 4, 5, 6, 7, 8];

export const SQUARE_LAYOUT: Layout = [...grid(0, cols(4, 22), ROWS), ...grid(1, cols(6, 20), ROWS)];
