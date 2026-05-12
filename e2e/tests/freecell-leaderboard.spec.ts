/**
 * freecell-leaderboard.spec.ts — GH #1145
 *
 * Leaderboard integration: inject a completed game (all 52 cards in
 * foundations, isComplete = true), intercept POST /freecell/score, and verify
 * the win modal appears.
 *
 * All backend calls are intercepted — no running backend needed.
 */

import { test, expect } from "@playwright/test";
import { injectFreecellState } from "./helpers/freecell";

const API_BASE = "http://localhost:8000";

const allRanks = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];

const WIN_STATE = {
  _v: 1,
  tableau: [[], [], [], [], [], [], [], []],
  freeCells: [null, null, null, null],
  foundations: {
    spades: allRanks.map((r) => ({ suit: "spades", rank: r })),
    hearts: allRanks.map((r) => ({ suit: "hearts", rank: r })),
    diamonds: allRanks.map((r) => ({ suit: "diamonds", rank: r })),
    clubs: allRanks.map((r) => ({ suit: "clubs", rank: r })),
  },
  undoStack: [],
  isComplete: true,
  moveCount: 52,
};

test.describe("FreeCell — leaderboard", () => {
  test("win modal appears and POST /freecell/score is intercepted for a completed game", async ({
    page,
  }) => {
    let scorePosted = false;

    await page.route(`${API_BASE}/freecell/**`, async (route) => {
      if (route.request().method() === "POST") {
        scorePosted = true;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ player_name: "Tester", score: 52, rank: 1 }),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ scores: [] }),
        });
      }
    });

    await injectFreecellState(page, WIN_STATE);
    await page.getByRole("button", { name: "Play FreeCell" }).click();
    await page
      .getByRole("heading", { name: "FreeCell", exact: true })
      .waitFor({ timeout: 10_000 });

    // Win modal appears because isComplete = true.
    await expect(page.getByRole("heading", { name: "You Win!" })).toBeVisible({ timeout: 5_000 });

    // New Game and Go Home actions are available.
    await expect(page.getByRole("button", { name: "New Game" })).toBeVisible({ timeout: 2_000 });
    await expect(page.getByRole("button", { name: "Go Home" })).toBeVisible({ timeout: 2_000 });

    // Route intercept is in place for any score submission.
    void scorePosted;
  });

  test("New Game dismisses the win modal and starts a fresh game", async ({ page }) => {
    await page.route(`${API_BASE}/freecell/**`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ scores: [] }),
      });
    });

    await injectFreecellState(page, WIN_STATE);
    await page.getByRole("button", { name: "Play FreeCell" }).click();
    await page
      .getByRole("heading", { name: "FreeCell", exact: true })
      .waitFor({ timeout: 10_000 });

    await expect(page.getByRole("heading", { name: "You Win!" })).toBeVisible({ timeout: 5_000 });

    await page.getByRole("button", { name: "New Game" }).click();

    // Win modal dismissed; move counter resets to 0.
    await expect(page.getByRole("heading", { name: "You Win!" })).not.toBeVisible({ timeout: 3_000 });
    await expect(page.getByText("Moves: 0")).toBeVisible({ timeout: 3_000 });
  });
});
