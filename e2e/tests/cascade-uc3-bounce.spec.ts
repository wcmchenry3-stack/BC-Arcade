/**
 * cascade-uc3-bounce.spec.ts
 *
 * UC3 acceptance: per-tier density and restitution produce heterogeneous
 * bounce behaviour. Tier-0 (smallest, highest restitution) bounces visibly;
 * tier-10 (largest, lowest restitution) settles within a frame or two.
 *
 * Approach: drop each fruit, let it reach the floor, then sample y-position
 * twice 300 ms apart. A still-bouncing body has a large y-delta; a settled
 * body has a near-zero y-delta.
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
const WALL_THICKNESS = 16;

// Tier radii — must match RADII in fruitSets.ts
const TIER_0_RADIUS = 18;
const TIER_10_RADIUS = 168;

// Rest y for each tier when sitting on the floor
const TIER_0_REST_Y = 700 - WALL_THICKNESS - TIER_0_RADIUS; // 666
const TIER_10_REST_Y = 700 - WALL_THICKNESS - TIER_10_RADIUS; // 516

test.describe("Cascade UC3 — heterogeneous bounce, per-tier density", () => {
  test.beforeEach(async ({ page }) => {
    await mockLeaderboard(page);
    await gotoCascade(page);
  });

  test("tier-0 (smallest, restitution=0.5) bounces visibly after floor contact", async ({
    page,
  }) => {
    // Drop tier-0 at centre — small fruit, no risk of merge with anything
    await spawnTierAt(page, 0, WORLD_W / 2);

    // Let it fall and hit the floor (floor contact ~930 ms from y≈50)
    await fastForward(page, 1200);

    const before = await getState(page);
    const f1 = before.fruits.find((f) => f.tier === 0);
    expect(f1).toBeDefined();
    if (!f1) return;

    // Fruit must be near the floor at this point
    expect(f1.y).toBeGreaterThan(TIER_0_REST_Y - 120);

    // Advance 300 ms — a bouncing body with restitution=0.5 will be many pixels
    // above its previous y (it bounced upward after the floor contact)
    await fastForward(page, 300);

    const after = await getState(page);
    const f2 = after.fruits.find((f) => f.tier === 0);
    expect(f2).toBeDefined();
    if (!f2) return;

    // The fruit was bouncing — its y changed by more than 5 px between snapshots
    const yDelta = Math.abs(f2.y - f1.y);
    expect(yDelta).toBeGreaterThan(5);
  });

  test("tier-10 (largest, restitution=0.05) settles quickly — y barely changes after landing", async ({
    page,
  }) => {
    // Tier-10 radius=168 fits the bin: centre at x=200, walls at 16 and 384
    await spawnTierAt(page, 10, WORLD_W / 2);

    // Let it fall and hit the floor (floor contact ~900 ms from y≈50, for tier-10 rest_y=516)
    await fastForward(page, 1200);

    const mid = await getState(page);
    const f1 = mid.fruits.find((f) => f.tier === 10);
    expect(f1).toBeDefined();
    if (!f1) return;

    // Fruit must be near the floor
    expect(f1.y).toBeGreaterThan(TIER_10_REST_Y - 120);

    // Advance 300 ms — with restitution=0.05 the bounce is < 1 px; body should be settled
    await fastForward(page, 300);

    const after = await getState(page);
    const f2 = after.fruits.find((f) => f.tier === 10);
    expect(f2).toBeDefined();
    if (!f2) return;

    // Settled: y delta over 300 ms must be less than 5 px
    const yDelta = Math.abs(f2.y - f1.y);
    expect(yDelta).toBeLessThan(5);
  });

  test("tier-0 bounces more times than tier-10 before settling", async ({
    page,
  }) => {
    // Drop tier-0 and tier-10 side by side, both from the same height.
    // Sample y-positions at two windows (1200–1500 ms and 1500–1800 ms after drop).
    // tier-0 (restitution=0.5) is still bouncing in both windows → two large deltas.
    // tier-10 (restitution=0.05) settles before 1200 ms → near-zero deltas in both.
    await spawnTierAt(page, 0, 100);
    await spawnTierAt(page, 10, 300);

    await fastForward(page, 1200);
    const snap1 = await getState(page);

    await fastForward(page, 300);
    const snap2 = await getState(page);

    await fastForward(page, 300);
    const snap3 = await getState(page);

    const tier0a = snap1.fruits.find((f) => f.tier === 0);
    const tier0b = snap2.fruits.find((f) => f.tier === 0);
    const tier0c = snap3.fruits.find((f) => f.tier === 0);
    const tier10a = snap1.fruits.find((f) => f.tier === 10);
    const tier10b = snap2.fruits.find((f) => f.tier === 10);
    const tier10c = snap3.fruits.find((f) => f.tier === 10);

    expect(tier0a).toBeDefined();
    expect(tier0b).toBeDefined();
    expect(tier0c).toBeDefined();
    expect(tier10a).toBeDefined();
    expect(tier10b).toBeDefined();
    expect(tier10c).toBeDefined();
    if (!tier0a || !tier0b || !tier0c || !tier10a || !tier10b || !tier10c)
      return;

    const tier0Delta1 = Math.abs(tier0b.y - tier0a.y);
    const tier0Delta2 = Math.abs(tier0c.y - tier0b.y);
    const tier10Delta1 = Math.abs(tier10b.y - tier10a.y);
    const tier10Delta2 = Math.abs(tier10c.y - tier10b.y);

    // tier-0 must still be moving visibly in at least one window (bouncing)
    expect(Math.max(tier0Delta1, tier0Delta2)).toBeGreaterThan(5);
    // tier-10 must be settled in both windows
    expect(tier10Delta1).toBeLessThan(5);
    expect(tier10Delta2).toBeLessThan(5);
  });
});
