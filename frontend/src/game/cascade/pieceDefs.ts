import { CASCADE_PIECE_COLORS } from "../../theme/theme.cascade";
import { CAPSTONE_TIER, DROPPABLE_TIERS, TIERS } from "./tiers";

export type Vec2 = { x: number; y: number };

export type ShapeDef =
  { kind: "circle"; radius: number } | { kind: "convex"; vertices: Vec2[]; boundingRadius: number };

export interface PieceDef {
  tier: number;
  /**
   * Placeholder colour (`theme/theme.cascade.ts`): the plain circle drawn for a tier whose
   * sprite hasn't decoded yet (a brief fallback players can see), and the dev panel's swatch.
   * The intended look comes from the active fruit set's art; don't use this colour for
   * anything else player-facing.
   */
  color: string;
  scoreValue: number;
  /** planck.js density (from the ladder, `tiers.ts`). */
  density: number;
  shape: ShapeDef; // physics + collision shape — lives HERE, not in a separate file
  sprite?: SpriteRef;
}

export interface SpriteRef {
  assetKey: string; // key into the asset registry
  offsetX?: number; // sprite origin offset to align with physics centroid
  offsetY?: number;
  scale?: number;
}

/**
 * Engine piece definitions, derived from the one tier ladder (`tiers.ts`): radius, score,
 * density and the droppable flag are read from it, never restated here (#3695).
 */
export const PIECE_DEFS: PieceDef[] = TIERS.map((t) => ({
  tier: t.tier,
  color: CASCADE_PIECE_COLORS[t.tier]!,
  scoreValue: t.score,
  density: t.density,
  shape: { kind: "circle", radius: t.radius },
}));

/** The capstone tier: two pieces of this tier never merge. */
export const MAX_TIER = CAPSTONE_TIER;
export const DROPPABLE_PIECE_TIERS: readonly number[] = DROPPABLE_TIERS;
