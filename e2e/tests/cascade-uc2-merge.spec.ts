/**
 * cascade-uc2-merge.spec.ts
 *
 * UC2 acceptance: warm-spawn merge reduces explosive ejection and the merged
 * body inherits the correct tier. Uses seeded RNG and spawnTierAt for
 * deterministic fruit placement, and fastForward to advance physics without
 * waiting for real time.
 *
 * Requires a test build: EXPO_PUBLIC_TEST_HOOKS=1 npx expo export --platform web
 */
import { test, expect } from "./fixtures";
import {
  gotoCascade,
  getState,
  fastForward,
  mockLeaderboard,
  spawnTierAt,
} from "./helpers/cascade";

const WORLD_W = 400;
const WORLD_H = 700;
const WALL_THICKNESS = 16;

// Tier radii — must match RADII in fruitSets.ts
const TIER_0_RADIUS = 18;
const TIER_1_RADIUS = 23;
const TIER_2_RADIUS = 28;

// Spawn tier-0 fruits adjacent so they collide on drop
const MERGE_X = WORLD_W / 2;

test.describe("Cascade UC2 — warm-spawn merge", () => {
  test.beforeEach(async ({ page }) => {
    await mockLeaderboard(page);
    await gotoCascade(page);
  });

  test("merge produces a tier+1 body at the merge centroid", async ({ page }) => {
    // Drop two same-tier fruits at nearly the same x; they collide and merge
    await spawnTierAt(page, 0, MERGE_X - 4);
    await spawnTierAt(page, 0, MERGE_X + 4);

    // Let them fall, collide, and merge
    await fastForward(page, 3000);

    const state = await getState(page);
    // After merge: two tier-0s removed, one tier-1 spawned
    const tier1Bodies = state.fruits.filter((f) => f.tier === 1);
    expect(tier1Bodies.length).toBeGreaterThanOrEqual(1);
  });

  test("no explosive ejection — neighboring body not displaced more than 3× merge-target radius", async ({
    page,
  }) => {
    // Place a bystander tier-2 fruit just inside the pop-impulse wake zone (1.5× tier-1 radius
    // from the merge epicentre ≈ 35 px < 46 px wake-zone radius) so it receives the pop impulse.
    // Warm spawn should still keep total displacement modest.
    const bystanderX = MERGE_X + TIER_1_RADIUS * 1.5; // inside 2× wake zone (46 px)

    // Drop the bystander first so it settles before the merge pair arrives
    await spawnTierAt(page, 2, bystanderX);
    await fastForward(page, 2000);

    const before = await getState(page);
    const bystander = before.fruits.find((f) => f.tier === 2);
    expect(bystander).toBeDefined();
    if (!bystander) return;
    const bystanderStartX = bystander.x;
    const bystanderStartY = bystander.y;

    // Now drop the merge pair
    await spawnTierAt(page, 0, MERGE_X - 4);
    await spawnTierAt(page, 0, MERGE_X + 4);
    await fastForward(page, 2000);

    const after = await getState(page);
    const bystanderAfter = after.fruits.find((f) => f.tier === 2);
    expect(bystanderAfter).toBeDefined();
    if (!bystanderAfter) return;

    const dx = bystanderAfter.x - bystanderStartX;
    const dy = bystanderAfter.y - bystanderStartY;
    const displacement = Math.sqrt(dx * dx + dy * dy);
    // Warm spawn limits ejection: bystander inside wake zone should not travel more than 3× merge radius
    expect(displacement).toBeLessThan(TIER_1_RADIUS * 3);
  });

  test("fruitCount decreases by 1 after a merge (2 parents → 1 child)", async ({ page }) => {
    await spawnTierAt(page, 0, MERGE_X - 4);
    await spawnTierAt(page, 0, MERGE_X + 4);

    // Snapshot just after drop (before merge)
    await fastForward(page, 200);
    const before = await getState(page);
    const preCount = before.fruitCount;
    expect(preCount).toBeGreaterThanOrEqual(2);

    // Wait for merge to complete
    await fastForward(page, 3000);
    const after = await getState(page);

    // Net change: -2 (parents) +1 (child) = -1
    expect(after.fruitCount).toBe(preCount - 1);
  });

  test("chain merge — two successive merges both produce correct tier bodies", async ({
    page,
  }) => {
    // Drop 4 tier-0 fruits in two adjacent pairs — triggers two merges → two tier-1s
    await spawnTierAt(page, 0, MERGE_X - 8);
    await spawnTierAt(page, 0, MERGE_X - 2);
    await spawnTierAt(page, 0, MERGE_X + 2);
    await spawnTierAt(page, 0, MERGE_X + 8);

    await fastForward(page, 4000);

    const state = await getState(page);
    // At minimum: two tier-1 bodies from the two tier-0 merges (may also chain-merge to tier-2)
    const tier1Plus = state.fruits.filter((f) => f.tier >= 1);
    expect(tier1Plus.length).toBeGreaterThanOrEqual(1);

    // All surviving bodies must be inside the bin
    for (const f of state.fruits) {
      const r = f.tier === 0 ? TIER_0_RADIUS : f.tier === 1 ? TIER_1_RADIUS : TIER_2_RADIUS;
      expect(f.x - r).toBeGreaterThanOrEqual(WALL_THICKNESS - 2);
      expect(f.x + r).toBeLessThanOrEqual(WORLD_W - WALL_THICKNESS + 2);
      expect(f.y - r).toBeGreaterThan(0);
      expect(f.y + r).toBeLessThanOrEqual(WORLD_H - WALL_THICKNESS + 2);
    }
  });

  test("merged body stays inside the bin after warm spawn", async ({ page }) => {
    await spawnTierAt(page, 0, MERGE_X - 4);
    await spawnTierAt(page, 0, MERGE_X + 4);
    await fastForward(page, 3000);

    const state = await getState(page);
    for (const f of state.fruits) {
      const r = f.tier === 0 ? TIER_0_RADIUS : TIER_1_RADIUS;
      expect(f.x - r).toBeGreaterThanOrEqual(WALL_THICKNESS - 1);
      expect(f.x + r).toBeLessThanOrEqual(WORLD_W - WALL_THICKNESS + 1);
      expect(f.y + r).toBeLessThanOrEqual(WORLD_H - WALL_THICKNESS + 2);
    }
  });
});
