/**
 * starswarm-leaderboard.spec.ts — GH #1147
 *
 * Checks the result card is absent in initial play state. The board opens
 * through the shared LeaderboardScreen (#2633) and the run ranks as its games
 * row (#2626); the per-game GET /starswarm/leaderboard and POST
 * /starswarm/score were removed in #2644. The game-over flow, including the
 * run's rank, is covered by starswarm-game-over.spec.ts.
 *
 * No running backend is needed: the routes this spec depends on are
 * intercepted with page.route(), and any other call (such as SyncWorker's
 * game sync) fails, which the app handles like being offline.
 */

import { test, expect } from "@playwright/test";
import { gotoStarswarm } from "./helpers/starswarm";

test.describe("Star Swarm — leaderboard", () => {
  test("the result card is absent in initial play state", async ({ page }) => {
    await gotoStarswarm(page);
    await expect(
      page.getByRole("img", { name: /Star Swarm game/i }),
    ).toBeVisible({ timeout: 10_000 });

    await expect(page.getByTestId("starswarm-result")).not.toBeVisible({ timeout: 2_000 });
  });
});
