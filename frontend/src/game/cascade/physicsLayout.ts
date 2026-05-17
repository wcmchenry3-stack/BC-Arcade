export interface Vec2 {
  x: number;
  y: number;
}

// Hexagonal close-pack worst-case height factor (from circle-packing geometry).
export const PACKING_HEIGHT_FACTOR = 2 + Math.sqrt(3);

// Wall proportional to maxRadius — prevents fruit penetration at terminal velocity.
export const BIN_WALL_RATIO = 0.4;
// Inner bin: 4 max-diameter slots wide (enough for drop targeting without wall crowding).
export const BIN_INNER_DIAMETERS = 4;
// Height-to-width aspect ratio for Suika-style gameplay feel.
export const BIN_ASPECT_RATIO = 1.75;

/**
 * Derive bin outer dimensions and wall thickness from the largest fruit radius.
 * Inner width = 4 max diameters; height = 1.75× outer width.
 * S4 adopts these values to replace the hardcoded WORLD_W / WORLD_H / WALL_THICKNESS constants.
 */
export function calculateBinDimensions(maxRadius: number): {
  width: number;
  height: number;
  wallThickness: number;
} {
  const wallThickness = Math.max(4, Math.round(maxRadius * BIN_WALL_RATIO));
  const innerWidth = Math.round(maxRadius * 2 * BIN_INNER_DIAMETERS);
  const width = innerWidth + 2 * wallThickness;
  const height = Math.round(width * BIN_ASPECT_RATIO);
  return { width, height, wallThickness };
}

/**
 * Mass-weighted centroid of two merging bodies. Equal masses → exact midpoint.
 * Returns the midpoint when total mass is zero to avoid NaN.
 */
export function calculateMergeCentroid(
  posA: Vec2,
  massA: number,
  posB: Vec2,
  massB: number,
): Vec2 {
  const totalMass = massA + massB;
  if (totalMass <= 0) {
    return { x: (posA.x + posB.x) / 2, y: (posA.y + posB.y) / 2 };
  }
  return {
    x: (posA.x * massA + posB.x * massB) / totalMass,
    y: (posA.y * massA + posB.y * massB) / totalMass,
  };
}

/**
 * Radius of a fruit at the given tier: baseRadius × factor^tier.
 * Defaults to factor 1.25, matching RADII[n] = 18 × 1.25^n.
 */
export function calculateTierRadius(
  tier: number,
  baseRadius: number,
  factor = 1.25,
): number {
  return baseRadius * Math.pow(factor, tier);
}

/**
 * Minimum clearance margin between packed fruits.
 * Computed as 15% of the Level-1 diameter (36 px), not R_max — per physics spec.
 */
export function packingTheoremClearance(level1Diameter: number): number {
  return level1Diameter * 0.15;
}
