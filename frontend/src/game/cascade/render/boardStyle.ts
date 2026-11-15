/**
 * #2960: the board's per-tier drawing table, built on the JS thread whenever the theme changes
 * and handed to the UI-thread renderer (`drawFrame.ts`). Every size comes from the one tier
 * ladder (`tiers.ts`, #3695): a piece is drawn at its drawn radius, 1.5 % inside its collider
 * (#3904, `tierDrawnRadius`; the code-drawn art, #3698, is drawn at that radius too,
 * `art/sprites.ts`).
 */
import type { CascadeLidPalette } from "../../../theme/theme.cascade";
import { PIECE_DEFS } from "../pieceDefs";
import { tierDrawnRadius } from "../tiers";
import type { BoardStyle } from "./drawFrame";

export function buildBoardStyle(palette: CascadeLidPalette): BoardStyle {
  const radius: number[] = [];
  const color: string[] = [];
  for (const def of PIECE_DEFS) {
    radius[def.tier] = tierDrawnRadius(def.tier);
    color[def.tier] = def.color;
  }
  return { radius, color, palette };
}
