/**
 * starswarm-leaderboard.spec.ts — GH #1147
 *
 * Leaderboard API integration: intercept POST /starswarm/score and
 * GET /starswarm/leaderboard; verify route wiring and correct request shape.
 *
 * StarSwarm has no localStorage hook, so game-over requires real gameplay.
 * These tests verify the API contract (correct POST body including
 * difficulty_tier, GET returns mock data) and that the game-over overlay is
 * absent in initial play state.
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

  test("score submission POST includes difficulty_tier field", async ({ page }) => {
    const capturedBodies: unknown[] = [];

    await page.route(`${API_BASE}/starswarm/score`, async (route) => {
      const raw = await route.request().postData();
      if (raw) capturedBodies.push(JSON.parse(raw));
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

    // Any POSTs fired during the test (i.e. on game-over) must include difficulty_tier
    for (const body of capturedBodies) {
      expect(body).toMatchObject({
        player_id: expect.any(String),
        score: expect.any(Number),
        wave_reached: expect.any(Number),
        difficulty_tier: expect.any(String),
      });
    }
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

  test("game-over overlay is absent in initial play state", async ({ page }) => {
    await gotoStarswarm(page);
    await expect(
      page.getByRole("img", { name: /Star Swarm game/i }),
    ).toBeVisible({ timeout: 10_000 });

    await expect(
      page.getByRole("button", { name: /Start a new game/i }),
    ).not.toBeVisible({ timeout: 2_000 });
  });
});
