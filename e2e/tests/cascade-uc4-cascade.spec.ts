/**
 * cascade-uc4-cascade.spec.ts
 *
 * UC4 acceptance: cascade combo fires only when ≥3 merges chain from a single
 * drop, and gameOver is not emitted while a merge cooldown is active.
 *
 * Approach:
 *   (a) Spawn 3 pairs of identical-tier fruits close together; fast-forward to
 *       let them all merge; assert comboCount increments (combo event was fired).
 *   (b) Rapidly spawn multiple merging pairs near each other; verify gameOver
 *       stays false throughout the merge chain.
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

test.describe("Cascade UC4 — cascade combo and game-over suppression", () => {
  test.beforeEach(async ({ page }) => {
    await mockLeaderboard(page);
    await gotoCascade(page);
  });

  test("≥3 consecutive merges from one drop increments comboCount", async ({
    page,
  }) => {
    // Spawn 3 pairs of tier-0 fruits, each pair separated by 2px so they
    // immediately overlap and merge once physics ticks forward.
    // All 3 pairs are in a single "drop session" (no player drop between them).
    await spawnTierAt(page, 0, 100);
    await spawnTierAt(page, 0, 102);

    await spawnTierAt(page, 0, 200);
    await spawnTierAt(page, 0, 202);

    await spawnTierAt(page, 0, 300);
    await spawnTierAt(page, 0, 302);

    // Let all 3 pairs fall, merge, and any cascade settle (4 s)
    await fastForward(page, 4000);

    const state = await getState(page);
    // At least one cascadeCombo event must have fired
    expect(state.comboCount).toBeGreaterThan(0);
  });

  test("gameOver is not emitted while merge chains are resolving", async ({
    page,
  }) => {
    // Spawn several overlapping pairs that will merge in rapid succession.
    // The merge cooldown (GAME_OVER_MERGE_COOLDOWN_TICKS) must keep gameOver
    // suppressed throughout, leaving the game running after the cascade.
    await spawnTierAt(page, 0, WORLD_W / 4);
    await spawnTierAt(page, 0, WORLD_W / 4 + 2);

    await spawnTierAt(page, 0, WORLD_W / 2);
    await spawnTierAt(page, 0, WORLD_W / 2 + 2);

    await spawnTierAt(page, 0, (3 * WORLD_W) / 4);
    await spawnTierAt(page, 0, (3 * WORLD_W) / 4 + 2);

    // Advance far enough for merges to chain and settle, but not so far that
    // the GAME_OVER_GRACE_MS (3 s) expires for the merged fruit.
    await fastForward(page, 2000);

    const state = await getState(page);
    expect(state.gameOver).toBe(false);
  });
});
