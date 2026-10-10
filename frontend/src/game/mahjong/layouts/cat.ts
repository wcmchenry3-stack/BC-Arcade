/**
 * Cat layout — 144 slots.
 *
 * Cat silhouette viewed from above: two pointed ears, a round head, and a body with paws.
 *
 * Layer breakdown:
 *   Layer 0 —  96 tiles: ears (12) + head rows 2-6 (40) + body rows 7-12 (36) + paws (8)
 *   Layer 1 —  34 tiles: head inner rows 3-5 (18) + body inner rows 8-11 (16)
 *   Layer 2 —  14 tiles: face rows 4-5 (6) + body peak rows 9-10 (8)
 *   Total: 96 + 34 + 14 = 144
 */

import type { Layout } from "../types";
import { cols, grid, slot } from "./build";

export const CAT_LAYOUT: Layout = [
  // Layer 0 — silhouette
  // Ears (left then right, per row)
  ...[0, 1].flatMap((r) => [
    ...[8, 10, 12].map((c) => slot(c, r, 0)),
    ...[18, 20, 22].map((c) => slot(c, r, 0)),
  ]),
  // Head
  ...grid(0, cols(8, 22), [2, 3, 4, 5, 6]),
  // Body
  ...grid(0, cols(10, 20), [7, 8, 9, 10, 11, 12]),
  // Paws
  ...grid(0, [10, 12, 18, 20], [13, 14]),
  // Layer 1 — inner head + body
  ...grid(1, cols(10, 20), [3, 4, 5]),
  ...grid(1, cols(12, 18), [8, 9, 10, 11]),
  // Layer 2 — face + body peak
  ...grid(2, [12, 14, 16], [4, 5]),
  ...grid(2, cols(12, 18), [9, 10]),
];
