/**
 * 1 px-contact spawn helper for merge tests (#1302, #1296, #1418).
 *
 * Two same-tier pieces created deeply overlapped can be pushed apart by the solver before
 * `collisionStart` fires, so the merge silently never happens. Spawning them overlapped by
 * about 1 px reliably produces the contact event on the first step. Pieces are laid on the
 * floor side by side, centred on `x`; pass the result to `engine.restore(pieces, 0)`.
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
