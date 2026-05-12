/**
 * cascade-drop-physics.spec.ts
 *
 * Live-engine (Rapier WASM) regression coverage for the most basic physics
 * invariants. The motivating bug: a single sprite dropped at the centre of
 * the bin would shoot sideways and exit the play area. The unit tests in
 * dropPhysics.test.ts cover the matter.js engine; these run the actual Web
 * Rapier integrator the player sees.
 *
 * Each test uses the deterministic spawn/fastForward hooks and asserts on
 * fruit positions read from window.__cascade_getState().
 */
import { test, expect } from "@playwright/test";
import {
  gotoCascade,
  getState,
  fastForward,
  mockLeaderboard,
  spawnTierAt,
} from "./helpers/cascade";

// Canonical physics world — must match engine.shared.ts.
const WORLD_W = 400;
const WORLD_H = 700;
const WALL_THICKNESS = 16;

// Tier-0 (cherry) radius — matches RADII[0] in fruitSets.ts.
const TIER_0_RADIUS = 18;

// Inner playable rectangle.
const INNER_LEFT = WALL_THICKNESS;
const INNER_RIGHT = WORLD_W - WALL_THICKNESS;
const INNER_FLOOR = WORLD_H - WALL_THICKNESS;

test.describe("Cascade — drop physics invariants", () => {
  test.beforeEach(async ({ page }) => {
    await mockLeaderboard(page);
    await gotoCascade(page);
  });

  test("single tier-0 sprite stays inside the bin and reaches the floor", async ({
    page,
  }) => {
    await spawnTierAt(page, 0, WORLD_W / 2);
    await fastForward(page, 3000);

    const state = await getState(page);
    expect(state.fruitCount).toBe(1);
    const f = state.fruits[0];
    expect(f).toBeDefined();
    if (f === undefined) return;
    // Inside walls (centre + radius is within the playable area).
    expect(f.x - TIER_0_RADIUS).toBeGreaterThanOrEqual(INNER_LEFT - 1);
    expect(f.x + TIER_0_RADIUS).toBeLessThanOrEqual(INNER_RIGHT + 1);
    // Sitting on the floor (bottom edge ~= floor top).
    // Rapier allows up to ~5px contact penetration depending on body mass.
    expect(f.y + TIER_0_RADIUS).toBeGreaterThan(INNER_FLOOR - 5);
    expect(f.y + TIER_0_RADIUS).toBeLessThanOrEqual(INNER_FLOOR + 5);
  });

  test("single tier-0 sprite does not skid more than a quarter of the bin width", async ({
    page,
  }) => {
    // The "shoots across the bin" failure mode: drop at centre, sprite ends
    // up against a wall.
    const startX = WORLD_W / 2;
    await spawnTierAt(page, 0, startX);
    await fastForward(page, 3000);

    const state = await getState(page);
    const f = state.fruits[0];
    expect(f).toBeDefined();
    if (f === undefined) return;
    const playableHalf = (WORLD_W - 2 * WALL_THICKNESS) / 2;
    expect(Math.abs(f.x - startX)).toBeLessThan(playableHalf / 2);
  });

  test("single sprite never escapes — fruitCount stays at 1 across the whole drop", async ({
    page,
  }) => {
    // If physics fling the sprite out of the bin, the engine fires
    // onBoundaryEscape and removes it. Polling fruitCount = 1 across the
    // entire fall catches that.
    await spawnTierAt(page, 0, WORLD_W / 2);
    for (let i = 0; i < 20; i++) {
      await fastForward(page, 100);
      const state = await getState(page);
      expect(state.fruitCount).toBe(1);
    }
  });

  test("two non-touching sprites both stay in the bin and remain distinct", async ({
    page,
  }) => {
    // 200px apart ≫ 2 × tier-0 radius (36px) → guaranteed no contact, so no
    // merge. Both should land separately on the floor.
    await spawnTierAt(page, 0, 120);
    await spawnTierAt(page, 0, 320);
    await fastForward(page, 3000);

    const state = await getState(page);
    // No merge — both originals still on the floor as tier-0.
    expect(state.fruitCount).toBe(2);
    expect(state.score).toBe(0);
    for (const f of state.fruits) {
      expect(f.tier).toBe(0);
      expect(f.x - TIER_0_RADIUS).toBeGreaterThanOrEqual(INNER_LEFT - 1);
      expect(f.x + TIER_0_RADIUS).toBeLessThanOrEqual(INNER_RIGHT + 1);
      expect(f.y + TIER_0_RADIUS).toBeLessThanOrEqual(INNER_FLOOR + 5);
    }
  });

  test("small sprite dropped onto a settled larger sprite — both stay in the bin", async ({
    page,
  }) => {
    // tier-3 (radius 38) settles, then tier-0 drops on top. Different tiers,
    // so no merge fires and we're testing pure stacking-collision response.
    await spawnTierAt(page, 3, WORLD_W / 2);
    await fastForward(page, 1500);
    await spawnTierAt(page, 0, WORLD_W / 2);
    await fastForward(page, 3000);

    const state = await getState(page);
    expect(state.fruitCount).toBe(2);
    for (const f of state.fruits) {
      // tier-3 radius=38, tier-0 radius=18 — both must fit inside walls.
      const r = f.tier === 0 ? 18 : 38;
      expect(f.x - r).toBeGreaterThanOrEqual(INNER_LEFT - 1);
      expect(f.x + r).toBeLessThanOrEqual(INNER_RIGHT + 2);
      expect(f.y + r).toBeLessThanOrEqual(INNER_FLOOR + 5);
      // Top of every sprite must stay below the top of the bin.
      expect(f.y - r).toBeGreaterThan(0);
    }
  });

  test("large sprite dropped onto a settled smaller sprite — both stay in the bin", async ({
    page,
  }) => {
    await spawnTierAt(page, 0, WORLD_W / 2);
    await fastForward(page, 1500);
    await spawnTierAt(page, 5, WORLD_W / 2);
    await fastForward(page, 4000);

    const state = await getState(page);
    expect(state.fruitCount).toBe(2);
    for (const f of state.fruits) {
      // tier-0 radius=18, tier-5 radius=49.
      const r = f.tier === 0 ? 18 : 49;
      expect(f.x - r).toBeGreaterThanOrEqual(INNER_LEFT - 1);
      expect(f.x + r).toBeLessThanOrEqual(INNER_RIGHT + 1);
      expect(f.y + r).toBeLessThanOrEqual(INNER_FLOOR + 5);
      expect(f.y - r).toBeGreaterThan(0);
    }
  });

  test("small sprite dropped offset onto a larger sprite may skid but never escapes", async ({
    page,
  }) => {
    // Offset the small sprite so the contact is on the side of the bigger
    // one. Skid is fine, escape is not.
    await spawnTierAt(page, 6, WORLD_W / 2);
    await fastForward(page, 1500);
    // tier-6 radius=54 → drop offset by ~half the radius.
    await spawnTierAt(page, 0, WORLD_W / 2 + 27);
    await fastForward(page, 4000);

    const state = await getState(page);
    expect(state.fruitCount).toBe(2);
    for (const f of state.fruits) {
      const r = f.tier === 0 ? 18 : 54;
      expect(f.x - r).toBeGreaterThanOrEqual(INNER_LEFT - 1);
      expect(f.x + r).toBeLessThanOrEqual(INNER_RIGHT + 1);
      expect(f.y + r).toBeLessThanOrEqual(INNER_FLOOR + 5);
    }
  });
});
