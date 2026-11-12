/**
 * #2960: the board's per-tier drawing table, built on the JS thread whenever the fruit set or the
 * theme changes and handed to the UI-thread renderer (`drawFrame.ts`). Every size comes from the
 * one tier ladder (`tiers.ts`, #3695): a piece is drawn at exactly its collider radius, and a
 * baked sprite is drawn into a square of half-size radius x bakedClipR so its visible fruit is
 * that radius.
 */
import type { CascadeLidPalette } from "../../../theme/theme.cascade";
import { PIECE_DEFS } from "../pieceDefs";
import { spriteHalfSize, tierRadius } from "../tiers";
import type { BoardStyle } from "./drawFrame";

/** The active fruit set's per-tier art scale (`FruitDefinition.bakedClipR`). */
export interface TierArt {
  readonly bakedClipR?: number;
}

export function buildBoardStyle(
  fruitDefs: readonly (TierArt | undefined)[],
  palette: CascadeLidPalette
): BoardStyle {
  const radius: number[] = [];
  const spriteHalf: number[] = [];
  const spriteScale: number[] = [];
  const color: string[] = [];
  for (const def of PIECE_DEFS) {
    const clip = fruitDefs[def.tier]?.bakedClipR;
    radius[def.tier] = tierRadius(def.tier);
    spriteHalf[def.tier] = spriteHalfSize(def.tier, clip);
    spriteScale[def.tier] = clip ?? 1;
    color[def.tier] = def.color;
  }
  return { radius, spriteHalf, spriteScale, color, palette };
}
