/**
 * Pure physics-feel measurements over a list of piece snapshots (#2893).
 *
 *  - packingDensity: total piece area / area of the bin under the pile top (the highest top
 *    edge). 1 would be a solid block; circles cannot pass about 0.9, a loose pile is lower.
 *  - touchingGaps: for every pair whose PHYSICS circles touch (centre distance within
 *    TOUCH_TOL_PX of the radii sum), the VISIBLE gap = centre distance - drawn radii sum.
 *    Negative = the drawn pieces overlap. Today drawn = physics radius, so this is the contact
 *    slop; #3697 may change the drawn radius, and this is the number that shows it.
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

export function touchingGaps(pieces: readonly PieceSnapshot[], c: SimConstants): number[] {
  const gaps: number[] = [];
  for (let i = 0; i < pieces.length; i++) {
    const a = pieces[i]!;
    for (let j = i + 1; j < pieces.length; j++) {
      const b = pieces[j]!;
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const physGap = dist - (c.physicsRadius(a.tier) + c.physicsRadius(b.tier));
      if (physGap <= TOUCH_TOL_PX) {
        gaps.push(dist - (c.drawnRadius(a.tier) + c.drawnRadius(b.tier)));
      }
    }
  }
  return gaps;
}
