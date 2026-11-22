/**
 * Pure physics-feel measurements over a list of piece snapshots (#2893).
 *
 *  - packingDensity: total piece area / area of the bin under the pile top (the highest top
 *    edge). 1 would be a solid block; circles cannot pass about 0.9, a loose pile is lower.
 *  - touchingGaps: for every pair whose PHYSICS circles touch (centre distance within
 *    TOUCH_TOL_PX of the radii sum), the VISIBLE gap = centre distance - drawn radii sum.
 *    Negative = the drawn pieces overlap. Drawn = physics radius (#3697 kept them one size), so
 *    this is the contact slop: Box2D rests pieces about 0.15 px into each other.
 */
import type { PieceSnapshot } from "../engine";
import type { SimConstants } from "./config";

/** Pieces whose circles are within this many px of touching count as touching neighbours. */
export const TOUCH_TOL_PX = 3;

export function packingDensity(pieces: readonly PieceSnapshot[], c: SimConstants): number | null {
  if (pieces.length === 0) return null;
  let area = 0;
  let pileTop = Infinity;
  for (const p of pieces) {
    const r = c.drawnRadius(p.tier);
    area += Math.PI * r * r;
    pileTop = Math.min(pileTop, p.y - r);
  }
  const floorTop = c.worldHeight - c.floorThickness;
  const width = c.worldWidth - 2 * c.wallThickness;
  const binArea = width * (floorTop - Math.max(pileTop, 0));
  return binArea > 0 ? area / binArea : null;
}

/** A piece as the measures read it: `scale` is the engine's grow-in (absent = full size). */
type FeelPiece = Pick<PieceSnapshot, "tier" | "x" | "y"> & { scale?: number };

export function touchingGaps(pieces: readonly FeelPiece[], c: SimConstants): number[] {
  const gaps: number[] = [];
  for (let i = 0; i < pieces.length; i++) {
    const a = pieces[i]!;
    for (let j = i + 1; j < pieces.length; j++) {
      const b = pieces[j]!;
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      // A piece growing in (#3697) is measured at its current size (`scale`, 1 when absent).
      const sa = a.scale ?? 1;
      const sb = b.scale ?? 1;
      const physGap = dist - (c.physicsRadius(a.tier) * sa + c.physicsRadius(b.tier) * sb);
      if (physGap <= TOUCH_TOL_PX) {
        gaps.push(dist - (c.drawnRadius(a.tier) * sa + c.drawnRadius(b.tier) * sb));
      }
    }
  }
  return gaps;
}
