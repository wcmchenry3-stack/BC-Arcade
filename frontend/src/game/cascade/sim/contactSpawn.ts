/**
 * 1 px-contact spawn helper for merge tests (#1302, #1296, #1418).
 *
 * Pieces are laid on the floor side by side, centred on `x`, overlapped by `overlapPx`; pass the
 * result to `engine.restore(pieces, 0)`. Two same-tier pieces created deeply overlapped could be
 * pushed apart by the solver before a contact event fired, so the merge never happened; a 1 px
 * overlap produces the contact on the first step.
 *
 * #3697: planck's circles are true circles, so the overlap is exactly `overlapPx`. (Matter drew a
 * circle as a polygon of at most 25 sides, and the helper used to add a facet allowance of up to
 * r * (1 - cos(pi / sides)) for it.)
 */
import { DEFAULT_CONSTANTS, type SimConstants } from "./config";

export interface PlacedPiece {
  tier: number;
  x: number;
  y: number;
}

export function contactPair(
  tier: number,
  x: number,
  overlapPx = 1,
  constants: SimConstants = DEFAULT_CONSTANTS
): [PlacedPiece, PlacedPiece] {
  const r = constants.physicsRadius(tier);
  const y = constants.worldHeight - constants.floorThickness - r;
  const half = (2 * r - overlapPx) / 2;
  return [
    { tier, x: x - half, y },
    { tier, x: x + half, y },
  ];
}
