/**
 * starswarm-leaderboard.spec.ts — GH #1147
 *
 * Checks the result card is absent in initial play state. The app no longer
 * reads GET /starswarm/leaderboard (the board opens through the shared
 * LeaderboardScreen since #2633) or posts to POST /starswarm/score (#2626):
 * the game-over flow, including the run's rank, is covered by
 * starswarm-game-over.spec.ts.
 *
 * All backend calls are intercepted — no running backend needed.
 */

import { test, expect } from "@playwright/test";
import { mockStarswarmApi, gotoStarswarm } from "./helpers/starswarm";

test.describe("Star Swarm — leaderboard", () => {
  test.beforeEach(async ({ page }) => {
    await mockStarswarmApi(page);
  });

  test("the result card is absent in initial play state", async ({ page }) => {
    await gotoStarswarm(page);
    await expect(
      page.getByRole("img", { name: /Star Swarm game/i }),
    ).toBeVisible({ timeout: 10_000 });

    await expect(page.getByTestId("starswarm-result")).not.toBeVisible({ timeout: 2_000 });
  });
});
