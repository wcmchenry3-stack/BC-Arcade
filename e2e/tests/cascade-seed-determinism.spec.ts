/**
 * cascade-seed-determinism.spec.ts
 *
 * Verifies that seeding the Cascade spawn RNG via window.__cascade_setSeed
 * produces identical fruit positions across two independent physics runs.
 *
 * Requires a test build: EXPO_PUBLIC_TEST_HOOKS=1 npx expo export --platform web
 */

import { test, expect } from "./fixtures";
import {
  gotoCascade,
  setSeed,
  dropAt,
  fastForward,
  getState,
  mockLeaderboard,
} from "./helpers/cascade";

const SEED = 42;
const DROP_X = 200;
const SETTLE_MS = 3000;

test.describe("Cascade — seed determinism", () => {
  test.beforeEach(async ({ page }) => {
    await mockLeaderboard(page);
  });

  test("same seed produces identical fruit positions after fastForward", async ({ page }) => {
    // Run 1
    await gotoCascade(page);
    await setSeed(page, SEED);
    await dropAt(page, DROP_X);
    await fastForward(page, SETTLE_MS);
    const state1 = await getState(page);

    // Navigate away and back to reset the physics engine
    await page.goto("/");
    await gotoCascade(page);

    // Run 2 — same seed, same drop
    await setSeed(page, SEED);
    await dropAt(page, DROP_X);
    await fastForward(page, SETTLE_MS);
    const state2 = await getState(page);

    expect(state1.fruits.length).toBeGreaterThan(0);
    expect(state1.fruits.length).toBe(state2.fruits.length);

    for (let i = 0; i < state1.fruits.length; i++) {
      const f1 = state1.fruits[i]!;
      const f2 = state2.fruits[i]!;
      expect(Math.abs(f1.x - f2.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(f1.y - f2.y)).toBeLessThanOrEqual(1);
    }
  });

  test("same seed produces same next-fruit tier", async ({ page }) => {
    await gotoCascade(page);

    await setSeed(page, SEED);
    const s1 = await getState(page);

    await setSeed(page, SEED);
    const s2 = await getState(page);

    expect(s1.nextFruitTier).toBe(s2.nextFruitTier);
  });

  test("different seeds produce different fruit sequences", async ({ page }) => {
    await gotoCascade(page);

    await setSeed(page, 1);
    await dropAt(page, DROP_X);
    const afterSeed1 = await getState(page);

    await setSeed(page, 99999);
    await dropAt(page, DROP_X);
    const afterSeed2 = await getState(page);

    // nextFruitTier should differ for two distant seeds after one drop each
    // (LCG guarantees distinct outputs — flake probability is negligible)
    const bothTiers = [afterSeed1.nextFruitTier, afterSeed2.nextFruitTier];
    expect(bothTiers[0]).not.toBeUndefined();
    expect(bothTiers[1]).not.toBeUndefined();
    expect(afterSeed1.nextFruitTier).not.toBe(afterSeed2.nextFruitTier);
  });
});
