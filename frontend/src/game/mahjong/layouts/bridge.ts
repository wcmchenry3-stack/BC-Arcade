/**
 * Bridge layout — 144 slots.
 *
 * Arch bridge: two tall pier columns on each side with a wide lower span between them.
 *
 * Layer breakdown:
 *   Layer 0 —  72 tiles: full bridge deck span (12-col × 6-row rectangle, cols 0–22, rows 4–9)
 *   Layer 1 —  40 tiles: pier columns (cols 0–4 and 18–22, rows 1–6) + central roadway surface
 *                         (cols 8–14, row 4). Pier tiles at rows 1–3 have no layer-0 base —
 *                         intentional: those sections of the piers rise above the deck level.
 *   Layer 2 —  24 tiles: pier outer faces continue higher (cols 0–4 and 18–22, rows 1–4)
 *   Layer 3 —   8 tiles: pier cap tops (cols 0–2 and 20–22, rows 1–2)
 *   Total: 72 + 40 + 24 + 8 = 144
 */

import type { Layout } from "../types";
import { cols, grid, rect, row, rows } from "./build";

export const BRIDGE_LAYOUT: Layout = [
  // Layer 0
  ...rect(0, 0, 22, 4, 9),
  // Layer 1
  ...grid(1, [...cols(0, 4), ...cols(18, 22)], rows(1, 3)),
  ...row(1, 4, [...cols(0, 4), ...cols(8, 14), ...cols(18, 22)]),
  ...grid(1, [...cols(0, 4), ...cols(18, 22)], rows(5, 6)),
  // Layer 2
  ...grid(2, [...cols(0, 4), ...cols(18, 22)], rows(1, 4)),
  // Layer 3
  ...grid(3, [...cols(0, 2), ...cols(20, 22)], rows(1, 2)),
];
