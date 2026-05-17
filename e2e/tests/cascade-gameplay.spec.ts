/**
 * cascade-gameplay.spec.ts — GH #198
 *
 * Merge + score behavior verified via the window test hooks.
 * Uses spawnTierAt() to drop specific-tier fruits deterministically,
 * and fastForward() to simulate physics without waiting for real time.
 *
 * Score formula: scoreForMerge(tier) = 2^(tier+1)  (tiers 0-9)
 *                                     = 256          (tier 10 — watermelon bonus)
 */

import { test, expect } from "@playwright/test";
import {
  gotoCascade,
  getState,
  fastForward,
  mockLeaderboard,
  spawnTierAt,
} from "./helpers/cascade";

test.describe("Cascade — merge and score behavior", () => {
  test.beforeEach(async ({ page }) => {
    await mockLeaderboard(page);
    await gotoCascade(page);
  });

  // ---------------------------------------------------------------------------
  // Single merge
  // ---------------------------------------------------------------------------

  test("two tier-0 fruits at same x merge → score = 2, fruitCount = 1", async ({
    page,
  }) => {
    // Tier-0 radius=18. Same x: fruit 1 settles at the floor, fruit 2 falls
    // onto it from above — guaranteed collision regardless of CI round-trip timing.
    // (The 1px-contact approach broke at GRAVITY_Y≥18 because the first fruit
    // falls ~9px before the second spawns, pushing them outside contact range.)
    await spawnTierAt(page, 0, 150);
    await spawnTierAt(page, 0, 150);
    await fastForward(page, 2000);

    const state = await getState(page);
    expect(state.score).toBe(2); // 2^(0+1)
    expect(state.fruitCount).toBe(1); // two inputs → one tier-1 output
  });

  test("two tier-1 fruits merge → score = 4", async ({ page }) => {
    // Tier-1 radius=25, sum-of-radii=50. Place 44px apart (6px overlap, ~12%)
    // so Rapier fires CollisionStart reliably — mirrors the watermelon test design.
    await spawnTierAt(page, 1, 145);
    await spawnTierAt(page, 1, 189);
    await fastForward(page, 2000);

    const state = await getState(page);
    expect(state.score).toBe(4); // 2^(1+1)
    expect(state.fruitCount).toBe(1);
  });

  // ---------------------------------------------------------------------------
  // Watermelon bonus
  // ---------------------------------------------------------------------------

  test("two tier-10 (watermelon) fruits merge → score = 256, no tier-11 spawned", async ({
    page,
  }) => {
    // Tier-10 radius=89; valid x range in a 400px canvas is [105, 295].
    // Place 156px apart (r1+r2=178) for ~12% initial overlap so Rapier
    // contact detection fires reliably without suppressing contact events.
    await spawnTierAt(page, 10, 122);
    await spawnTierAt(page, 10, 278);
    await fastForward(page, 2000);

    const state = await getState(page);
    expect(state.score).toBe(256); // watermelon bonus
    // Both watermelons removed, no tier-11 exists → fruitCount drops by 2
    expect(state.fruitCount).toBe(0);
    // No tier-11 in the engine state
    expect(state.fruits.some((f) => f.tier === 11)).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // No merge for different tiers
  // ---------------------------------------------------------------------------

  test("tier-0 + tier-1 at same x do NOT merge → score = 0, fruitCount = 2", async ({
    page,
  }) => {
    await spawnTierAt(page, 0, 150);
    await spawnTierAt(page, 1, 150);
    await fastForward(page, 2000);

    const state = await getState(page);
    expect(state.score).toBe(0);
    expect(state.fruitCount).toBe(2);
  });

  // ---------------------------------------------------------------------------
  // Cumulative score across sequential merges
  // ---------------------------------------------------------------------------

  test("sequential tier-0 merges accumulate score correctly", async ({
    page,
  }) => {
    // Merge 1: two tier-0 at same x → score += 2; fruit 2 falls onto settled fruit 1
    await spawnTierAt(page, 0, 110);
    await spawnTierAt(page, 0, 110);
    await fastForward(page, 2000);

    // Merge 2: two more tier-0 at same x → score += 2 (total = 4), right side
    await spawnTierAt(page, 0, 240);
    await spawnTierAt(page, 0, 240);
    await fastForward(page, 2000);

    const state = await getState(page);
    expect(state.score).toBe(4); // 2 + 2
  });

  test("mixed-tier merges accumulate score correctly", async ({ page }) => {
    // tier-0 merge (+2): same x, fruit 2 falls onto settled fruit 1
    await spawnTierAt(page, 0, 150);
    await spawnTierAt(page, 0, 150);
    await fastForward(page, 2000);

    // tier-2 merge (+8): 31px apart (radius=33, sum=66, 35px overlap ~53%).
    // Originally 8px, bumped to 17px for Rapier CI (#1418), now bumped to 35px
    // for Matter.js — RAF may tick between the two spawnTierAt calls, letting the
    // first fruit fall up to ~44px before the second spawns (≥44px breaks 17px
    // overlap). 35px overlap tolerates ~55px of free-fall. Start at x=235 to
    // clear the tier-1 body (at x=150, radius=25, rightmost edge ≈175).
    await spawnTierAt(page, 2, 235);
    await spawnTierAt(page, 2, 266);
    await fastForward(page, 2000);

    const state = await getState(page);
    expect(state.score).toBe(10); // 2 + 8
  });

  // ---------------------------------------------------------------------------
  // Score stays at 0 with no merges
  // ---------------------------------------------------------------------------

  test("fruits at well-separated x positions do not merge → score = 0", async ({
    page,
  }) => {
    // Drop tier-0 fruits far apart (radius=18, so >36px apart = no overlap)
    await spawnTierAt(page, 0, 50);
    await spawnTierAt(page, 0, 250);
    await fastForward(page, 2000);

    const state = await getState(page);
    expect(state.score).toBe(0);
    expect(state.fruitCount).toBe(2);
  });
});
