/**
 * starswarm-leaderboard.spec.ts — GH #1147
 *
 * Legacy leaderboard read: intercept GET /starswarm/leaderboard (the retired
 * Ranks tab read it until #2634) and check the result card is absent in
 * initial play state. The app no longer posts runs to POST /starswarm/score (#2626): the
 * game-over flow, including the run's rank, is covered by
 * starswarm-game-over.spec.ts.
 *
 * All backend calls are intercepted — no running backend needed.
 */

import { test, expect } from "@playwright/test";
import { mockStarswarmApi, gotoStarswarm } from "./helpers/starswarm";

const API_BASE = "http://localhost:8000";

const MOCK_LEADERBOARD = {
  scores: [
    {
      player_id: "alice",
      score: 1500,
      wave_reached: 5,
      difficulty_tier: "LieutenantJG",
      timestamp: "2024-01-01T00:00:00",
      rank: 1,
    },
    {
      player_id: "bob",
      score: 1000,
      wave_reached: 3,
      difficulty_tier: "LieutenantJG",
      timestamp: "2024-01-02T00:00:00",
      rank: 2,
    },
  ],
};

test.describe("Star Swarm — leaderboard", () => {
  test.beforeEach(async ({ page }) => {
    await mockStarswarmApi(page);
  });

  test("leaderboard GET endpoint is intercepted", async ({ page }) => {
    const leaderboardUrls: string[] = [];

    await page.route(`${API_BASE}/starswarm/leaderboard`, async (route) => {
      leaderboardUrls.push(route.request().url());
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(MOCK_LEADERBOARD),
      });
    });

    await gotoStarswarm(page);
    await expect(
      page.getByRole("img", { name: /Star Swarm game/i }),
    ).toBeVisible({ timeout: 10_000 });

    for (const url of leaderboardUrls) {
      expect(url).toContain("/starswarm/leaderboard");
    }
  });

  test("the result card is absent in initial play state", async ({ page }) => {
    await gotoStarswarm(page);
    await expect(
      page.getByRole("img", { name: /Star Swarm game/i }),
    ).toBeVisible({ timeout: 10_000 });

    await expect(page.getByTestId("starswarm-result")).not.toBeVisible({ timeout: 2_000 });
  });
});
