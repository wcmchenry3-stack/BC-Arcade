/**
 * cascade-uc1-rest.spec.ts
 *
 * UC1 acceptance: fruits experience angular damping, come to rest after
 * settling, and bodies stop spinning. Uses seeded RNG for deterministic drops
 * and fastForward to advance the physics clock without waiting for real time.
 *
 * Requires a test build: EXPO_PUBLIC_TEST_HOOKS=1 npx expo export --platform web
 */
import { test, expect } from "./fixtures";
import {
  gotoCascade,
  getState,
  fastForward,
  mockLeaderboard,
  setSeed,
  spawnTierAt,
} from "./helpers/cascade";

const WORLD_W = 400;
const SETTLE_MS = 3000;
const SEED = 7;

test.describe("Cascade UC1 — freefall, resting contact, angular damping", () => {
  test.beforeEach(async ({ page }) => {
    await mockLeaderboard(page);
    await gotoCascade(page);
  });

  test("fruit comes to rest — position and angle are stable after settling", async ({
    page,
  }) => {
    await setSeed(page, SEED);
    await spawnTierAt(page, 0, WORLD_W / 2);

    // Let the fruit fall and fully settle
    await fastForward(page, SETTLE_MS);
    const before = await getState(page);
    expect(before.fruitCount).toBe(1);
    const f1 = before.fruits[0];
    expect(f1).toBeDefined();
    if (!f1) return;

    // Advance a further 1000ms — a resting body must not move or spin
    await fastForward(page, 1000);
    const after = await getState(page);
    const f2 = after.fruits[0];
    expect(f2).toBeDefined();
    if (!f2) return;

    // Position must not drift (body at rest, not still sliding)
    expect(Math.abs(f2.x - f1.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(f2.y - f1.y)).toBeLessThanOrEqual(1);

    // Angle must not change (body not spinning)
    const angleDelta = Math.abs(f2.angle - f1.angle);
    expect(angleDelta).toBeLessThan(0.05);
  });

  test("multiple fruits all come to rest after settling", async ({ page }) => {
    // spawnTierAt bypasses the queue so setSeed has no effect here.
    // Space drops ≥ 120px apart (> 2× tier-0 radius 18px) to prevent merges.
    await spawnTierAt(page, 0, 100);
    await spawnTierAt(page, 0, 220);
    await spawnTierAt(page, 0, 340);

    await fastForward(page, SETTLE_MS);
    const before = await getState(page);

    await fastForward(page, 1000);
    const after = await getState(page);

    // Same number of bodies before and after the extra settle window
    expect(after.fruitCount).toBe(before.fruitCount);

    // Each surviving body must be stationary
    for (const f2 of after.fruits) {
      const f1 = before.fruits.find((f) => f.id === f2.id);
      if (!f1) continue;
      expect(Math.abs(f2.x - f1.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(f2.y - f1.y)).toBeLessThanOrEqual(1);
      expect(Math.abs(f2.angle - f1.angle)).toBeLessThan(0.05);
    }
  });
});
