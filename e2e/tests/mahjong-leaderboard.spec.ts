/**
 * mahjong-leaderboard.spec.ts — GH #1146
 *
 * Leaderboard integration: inject a completed game (all 72 pairs removed,
 * isComplete = true), intercept POST /mahjong/score, and verify the win modal
 * appears, accepts a name, and shows the submission confirmation.
 *
 * All backend calls are intercepted — no running backend needed.
 */

import { test, expect } from "@playwright/test";
import { injectMahjongState, mockMahjongApi } from "./helpers/mahjong";

const API_BASE = "http://localhost:8000";

const WIN_STATE = {
  _v: 1,
  tiles: [],
  pairsRemoved: 72,
  score: 1220,
  shufflesLeft: 0,
  selected: null,
  undoStack: [],
  isComplete: true,
  isDeadlocked: false,
  startedAt: null,
  accumulatedMs: 120_000,
  dealId: "ff00",
};

test.describe("Mahjong — leaderboard", () => {
  test("win modal appears and POST /mahjong/score is intercepted for a completed game", async ({
    page,
  }) => {
    await page.route(`${API_BASE}/mahjong/**`, async (route) => {
      if (route.request().method() === "POST") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ player_name: "Tester", score: 1220, rank: 1 }),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ scores: [] }),
        });
      }
    });

    await injectMahjongState(page, WIN_STATE);
    await page.getByRole("button", { name: "Play Mahjong Solitaire" }).click();
    await page
      .getByRole("heading", { name: "Mahjong Solitaire", exact: true })
      .waitFor({ timeout: 10_000 });

    // Win modal appears because isComplete = true.
    await expect(page.getByRole("heading", { name: "YOU WIN!" })).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText("Score: 1220").first()).toBeVisible({ timeout: 2_000 });

    // Set up POST intercept before triggering submission.
    const scorePostRequest = page.waitForRequest(
      (req) => req.url().includes("/mahjong/score") && req.method() === "POST",
      { timeout: 10_000 },
    );

    // Enter a name and submit.
    await page.getByLabel("Enter your name").fill("Tester");
    await page.getByRole("button", { name: "Submit Score" }).click();

    // Confirmation text appears and POST was made.
    await expect(page.getByText(/Score saved/).first()).toBeVisible({ timeout: 5_000 });
    await scorePostRequest;
  });

  test("NEW GAME dismisses the win modal and starts a fresh game", async ({ page }) => {
    await mockMahjongApi(page);
    await injectMahjongState(page, WIN_STATE);

    await page.getByRole("button", { name: "Play Mahjong Solitaire" }).click();
    await page
      .getByRole("heading", { name: "Mahjong Solitaire", exact: true })
      .waitFor({ timeout: 10_000 });

    await expect(page.getByRole("heading", { name: "YOU WIN!" })).toBeVisible({ timeout: 5_000 });

    await page.getByRole("button", { name: "Start a new game" }).click();

    // Win modal dismissed; PAIRS counter resets to 0.
    await expect(page.getByRole("heading", { name: "YOU WIN!" })).not.toBeVisible({ timeout: 3_000 });
    await expect(page.getByText(/^PAIRS\s+0\/72/).first()).toBeVisible({ timeout: 5_000 });
  });
});
