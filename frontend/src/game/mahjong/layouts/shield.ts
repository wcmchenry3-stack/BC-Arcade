/**
 * Shield layout — 144 slots.
 *
 * Heraldic shield silhouette: broad flat top tapering symmetrically
 * to a pointed bottom tip.
 *
 * Layer breakdown:
 *   Layer 0 —  80 tiles: full shield body — flat top (cols 0–22, rows 0–3),
 *                         tapering sides (rows 4–7), narrow tip (cols 10–12, rows 8–9)
 *   Layer 1 —  44 tiles: inner surface highlight — top band (cols 2–20, rows 0–2)
 *                         + taper rows 3–4
 *   Layer 2 —  16 tiles: upper face accent (cols 4–18, rows 0–1)
 *   Layer 3 —   4 tiles: top-center boss (cols 8–10, rows 0–1)
 *   Total: 80 + 44 + 16 + 4 = 144
 */

import type { Layout } from "../types";
import { cols, rect, row } from "./build";

export const SHIELD_LAYOUT: Layout = [
  // Layer 0
  ...rect(0, 0, 22, 0, 3),
  ...row(0, 4, cols(2, 20)),
  ...row(0, 5, cols(4, 18)),
  ...row(0, 6, cols(6, 16)),
  ...row(0, 7, cols(8, 14)),
  ...rect(0, 10, 12, 8, 9),
  // Layer 1
  ...rect(1, 2, 20, 0, 2),
  ...row(1, 3, cols(4, 18)),
  ...row(1, 4, cols(6, 16)),
  // Layer 2
  ...rect(2, 4, 18, 0, 1),
  // Layer 3
  ...rect(3, 8, 10, 0, 1),
];
