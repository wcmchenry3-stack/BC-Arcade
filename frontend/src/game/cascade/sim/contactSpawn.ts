/**
 * 1 px-contact spawn helper for merge tests (#1302, #1296, #1418).
 *
 * Two same-tier pieces created deeply overlapped can be pushed apart by the solver before
 * `collisionStart` fires, so the merge silently never happens. Spawning them overlapped by
 * about 1 px reliably produces the contact event on the first step. Pieces are laid on the
 * floor side by side, centred on `x`; pass the result to `engine.restore(pieces, 0)`.
 *
 * Matter draws a circle as a polygon of at most 25 sides, so a big circle's flat facets sit up
 * to r * (1 - cos(pi / sides)) inside its nominal radius (0.7 px at r = 88): a plain 1 px
 * overlap of the nominal radii is no contact at all for the large tiers (it merged tiers 0-8
 * and silently failed for 9 and 10). The helper adds that facet allowance, so `overlapPx` is
 * the real overlap of the polygons in the worst orientation.
 */
import { DEFAULT_CONSTANTS, type SimConstants } from "./config";

export interface PlacedPiece {
  tier: number;
  x: number;
  y: number;
}

/** How far a Matter circle polygon of radius r can sit inside its nominal radius. */
function facetAllowance(r: number): number {
  const sides = Math.ceil(Math.max(10, Math.min(25, r)));
  return r * (1 - Math.cos(Math.PI / sides));
}

export function contactPair(
  tier: number,
  x: number,
  overlapPx = 1,
  constants: SimConstants = DEFAULT_CONSTANTS
): [PlacedPiece, PlacedPiece] {
  const r = constants.physicsRadius(tier);
  const y = constants.worldHeight - constants.floorThickness - r;
  const half = (2 * r - overlapPx - 2 * facetAllowance(r)) / 2;
  return [
    { tier, x: x - half, y },
    { tier, x: x + half, y },
  ];
}
