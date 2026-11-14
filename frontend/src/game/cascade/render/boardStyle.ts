/**
 * #2960: the board's per-tier drawing table, built on the JS thread whenever the theme changes
 * and handed to the UI-thread renderer (`drawFrame.ts`). Every size comes from the one tier
 * ladder (`tiers.ts`, #3695): a piece is drawn at exactly its collider radius (the code-drawn art,
 * #3698, is drawn at that radius too, `art/sprites.ts`).
 */
import type { CascadeLidPalette } from "../../../theme/theme.cascade";
import { PIECE_DEFS } from "../pieceDefs";
import { tierRadius } from "../tiers";
import type { BoardStyle } from "./drawFrame";

export function buildBoardStyle(palette: CascadeLidPalette): BoardStyle {
  const radius: number[] = [];
  const color: string[] = [];
  for (const def of PIECE_DEFS) {
    radius[def.tier] = tierRadius(def.tier);
    color[def.tier] = def.color;
  }
  return { radius, color, palette };
}
