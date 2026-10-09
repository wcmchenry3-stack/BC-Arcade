/**
 * Gate layout — 144 slots.
 *
 * Fortified gateway: two tall pillars flanking an arched opening, with a cobblestone ground.
 *
 * Layer breakdown:
 *   Layer 0 —  76 tiles: pillar bases (cols 0–4 and 18–22, rows 2–4), arch foundation row
 *                         (row 5, partial), full-width cobblestone ground (rows 6–9)
 *   Layer 1 —  44 tiles: pillar walls rise (cols 0–4 and 18–22, rows 2–7) + full archway span
 *                         (row 5, full width) + arch crown connector (cols 0–4, 10–12, 18–22,
 *                         row 4). Arch tiles at cols 10–12 row 4 and cols 6,16 row 5 have no
 *                         layer-0 base — intentional: the arch spans empty air over the gateway.
 *   Layer 2 —  16 tiles: upper pillar sections (cols 0–4 and 18–22, rows 2–3) +
 *                         arch keystone (cols 8–14, row 4)
 *   Layer 3 —   8 tiles: tallest pillar corner caps (cols 0–2 and 20–22, rows 2–3)
 *   Total: 76 + 44 + 16 + 8 = 144
 */

import type { Layout } from "../types";
import { cols, grid, rect, row, rows } from "./build";

export const GATE_LAYOUT: Layout = [
  // Layer 0
  ...grid(0, [...cols(0, 4), ...cols(18, 22)], rows(2, 4)),
  ...row(0, 5, [...cols(0, 4), ...cols(8, 14), ...cols(18, 22)]),
  ...rect(0, 0, 22, 6, 9),
  // Layer 1
  ...grid(1, [...cols(0, 4), ...cols(18, 22)], rows(2, 3)),
  ...row(1, 4, [...cols(0, 4), ...cols(10, 12), ...cols(18, 22)]),
  ...row(1, 5, cols(0, 22)),
  ...grid(1, [...cols(0, 4), ...cols(18, 22)], rows(6, 7)),
  // Layer 2
  ...grid(2, [...cols(0, 4), ...cols(18, 22)], rows(2, 3)),
  ...row(2, 4, cols(8, 14)),
  // Layer 3
  ...grid(3, [...cols(0, 2), ...cols(20, 22)], rows(2, 3)),
];
