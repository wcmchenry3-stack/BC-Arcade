/**
 * Star Swarm engine tests: hit-test geometry.
 *
 * One file per planned `engine/` module (#2988): this file follows `engine/geometry.ts`. Split out
 * of the former monolithic `engine.test.ts` (#2955) with describe blocks moved whole; shared
 * fixtures live in `helpers/engineFixtures.ts`.
 */
import { collideCircleAABB, PLAYER_HURT_RADIUS, seedRng, _resetIds } from "../engine";

beforeEach(() => {
  seedRng(42);
  _resetIds();
});

// ---------------------------------------------------------------------------
// collideCircleAABB (#976) — player hurt radius
// ---------------------------------------------------------------------------

describe("collideCircleAABB (#976)", () => {
  it("detects overlap when circle center is inside AABB", () => {
    expect(collideCircleAABB(50, 50, PLAYER_HURT_RADIUS, 50, 50, 20, 20)).toBe(true);
  });

  it("detects overlap when circle touches AABB edge", () => {
    // Circle at x=30 with radius 7, AABB centered at x=40 width=10 (left edge at 35)
    // Distance from center to nearest point: 35-30=5, within radius 7
    expect(collideCircleAABB(30, 50, 7, 40, 50, 10, 10)).toBe(true);
  });

  it("returns false for clear miss with gap beyond radius", () => {
    // Circle at x=10 r=5, AABB centered at x=30 width=10 (left edge at 25)
    // Nearest point: x=25, gap=25-10=15 > 5
    expect(collideCircleAABB(10, 50, 5, 30, 50, 10, 10)).toBe(false);
  });

  it("returns false when circle is well outside the AABB", () => {
    // Circle at (0,0) r=6, AABB centered at (10,10) width=2 height=2 (left edge at 9)
    // Nearest point: (9,9), distance=sqrt(162)≈12.7 > 6
    expect(collideCircleAABB(0, 0, 6, 10, 10, 2, 2)).toBe(false);
  });

  it("PLAYER_HURT_RADIUS is smaller than the old half-width hitbox", () => {
    // Original half-width was player.width/2 = 17; new radius is 7
    expect(PLAYER_HURT_RADIUS).toBeLessThan(17);
    expect(PLAYER_HURT_RADIUS).toBeGreaterThan(0);
  });
});
