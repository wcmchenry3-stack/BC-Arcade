/**
 * sort-win-flow.spec.ts — GH #1255
 *
 * Win flow: inject a near-solved state, complete the last pour, verify the
 * win modal, score submission to POST /sort/score, rank display, next-level
 * unlock, and the Next Level / Back to Levels actions.
 *
 * Near-solved layout (injected via localStorage):
 *   Bottle 1 (idx 0): ["blue","blue","blue","blue"]  solved
 *   Bottle 2 (idx 1): ["red","red","red"]             needs 1 more red
 *   Bottle 3 (idx 2): ["red"]                         1 red to pour
 *   Bottle 4 (idx 3): []                              empty
 *
 * Winning move: pour Bottle 3 → Bottle 2 (1 red fills the last slot).
 */

import { test, expect, type Page } from "@playwright/test";
import { mockSortApi, injectSortProgress } from "./helpers/sort";

const NEAR_SOLVED = {
  unlockedLevel: 1,
  currentLevelId: 1,
  currentState: {
    bottles: [
      ["blue", "blue", "blue", "blue"],
      ["red", "red", "red"],
      ["red"],
      [],
    ],
    moveCount: 5,
    undosUsed: 0,
    isComplete: false,
    selectedBottleIndex: null,
  },
};

async function loadNearSolvedLevel(page: Page): Promise<void> {
  await mockSortApi(page);
  await injectSortProgress(page, NEAR_SOLVED);
  await page.getByRole("button", { name: "Play Sort Puzzle" }).click();
  await page.getByText("Choose a Level").waitFor({ timeout: 10_000 });
  await page.getByRole("button", { name: "Continue Level 1" }).click();
  await expect(page.getByLabel("Sort Puzzle board")).toBeVisible({ timeout: 5_000 });
}

async function makeWinningPour(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Bottle 3, 1 of 4 filled" }).click();
  await expect(
    page.getByRole("button", {
      name: "Bottle 3 selected — tap another bottle to pour",
    }),
  ).toBeVisible({ timeout: 3_000 });
  await page.getByRole("button", { name: "Bottle 2, 3 of 4 filled" }).click();
  await expect(page.getByText("Solved!")).toBeVisible({ timeout: 5_000 });
}

test.describe("Sort Puzzle — win flow", () => {
  test("completing the last pour shows the win modal", async ({ page }) => {
    await loadNearSolvedLevel(page);
    await makeWinningPour(page);
  });

  test("win modal shows move and undo stats", async ({ page }) => {
    await loadNearSolvedLevel(page);
    await makeWinningPour(page);

    // moveCount was 5 + 1 winning pour = 6
    await expect(page.getByText(/Moves:\s*6/)).toBeVisible({ timeout: 3_000 });
    await expect(page.getByText(/Undos used:\s*0/)).toBeVisible({ timeout: 3_000 });
  });

  test("score is submitted to POST /sort/score with player name", async ({ page }) => {
    await loadNearSolvedLevel(page);
    await makeWinningPour(page);

    // Override the score route (registered after mockSortApi so LIFO gives it priority)
    let submittedBody: Record<string, unknown> | null = null;
    await page.route("**/sort/score", async (route) => {
      if (route.request().method() === "POST") {
        const raw = route.request().postData() ?? "{}";
        submittedBody = JSON.parse(raw) as Record<string, unknown>;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ player_name: "Alice", level_reached: 1, rank: 3 }),
      });
    });

    await page.getByPlaceholder("Your name").fill("Alice");
    await page.getByRole("button", { name: "Submit Score" }).click();

    await expect(page.getByText(/Rank #3/)).toBeVisible({ timeout: 5_000 });
    expect(submittedBody).not.toBeNull();
    expect(submittedBody).toMatchObject({ player_name: "Alice", level_reached: 1 });
  });

  test("Next Level button appears after score submission when a next level exists", async ({
    page,
  }) => {
    await loadNearSolvedLevel(page);
    await makeWinningPour(page);

    await page.getByPlaceholder("Your name").fill("Tester");
    await page.getByRole("button", { name: "Submit Score" }).click();
    await expect(page.getByRole("button", { name: "Next Level" })).toBeVisible({
      timeout: 5_000,
    });
  });

  test("Back to Levels returns to level select with next level unlocked", async ({ page }) => {
    await loadNearSolvedLevel(page);
    await makeWinningPour(page);

    await page.getByPlaceholder("Your name").fill("Tester");
    await page.getByRole("button", { name: "Submit Score" }).click();
    await expect(page.getByRole("button", { name: "Next Level" })).toBeVisible({
      timeout: 5_000,
    });

    await page.getByRole("button", { name: "Back to Levels" }).click();

    // After score submission unlockedLevel advanced to 2
    await expect(
      page.getByRole("button", { name: "Level 2" }),
    ).not.toBeDisabled({ timeout: 5_000 });
  });
});
