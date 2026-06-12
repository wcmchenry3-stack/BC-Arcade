/**
 * freecell-leaderboard.spec.ts — GH #2035
 *
 * Leaderboard integration: inject a completed game (all 52 cards in
 * foundations, isComplete = true), intercept POST /freecell/score, enter a
 * name, submit, and verify the rank confirmation.
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
  test("POST /freecell/score intercepted and rank confirmation shown after submit", async ({
    page,
  }) => {
    let capturedBody: Record<string, unknown> | null = null;

    await page.route(`${API_BASE}/freecell/**`, async (route) => {
      if (route.request().method() === "POST") {
        capturedBody = JSON.parse(route.request().postData() ?? "{}");
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ player_id: "Tester", move_count: 52, rank: 1 }),
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

    await page.getByLabel("Your name").fill("Tester");

    const submitBtn = page.getByRole("button", { name: "Submit Score" });
    await expect(submitBtn).toBeEnabled({ timeout: 2_000 });
    await submitBtn.click();

    await expect(page.getByText("Saved! #1")).toBeVisible({ timeout: 5_000 });

    expect(capturedBody).not.toBeNull();
    expect(capturedBody!["player_id"]).toBe("Tester");
    expect(capturedBody!["move_count"]).toBe(52);
  });

  test("Submit Score button disabled when name field is empty", async ({
    page,
  }) => {
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

    await expect(
      page.getByRole("button", { name: "Submit Score" }),
    ).toBeDisabled({ timeout: 2_000 });
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
