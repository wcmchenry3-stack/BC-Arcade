/**
 * sort-leaderboard.spec.ts — GH #1255, #2625, #2633
 *
 * Opening a game's leaderboard: Sort's ⋯ menu → Leaderboard opens the shared
 * leaderboard screen (#2633; Sort's inline Leaderboard tab is gone), which
 * renders the generic board (GET /games/leaderboard/sort): the server's
 * ranks, player names and the level each reached, under a "Level" column.
 * Native coverage is #2643.
 */

import { test, expect, type Page } from "@playwright/test";
import { installEntitlementsMock } from "./helpers/api-mock";
import { mockSortBoard } from "./helpers/sort";

const TOP_10 = Array.from({ length: 10 }, (_, i) => ({
  rank: i + 1,
  player_name: `Player${i + 1}`,
  value: 10 - i,
  completed_at: "2026-09-01T00:00:00Z",
  is_me: false,
}));

async function installSortMock(page: Page, entries: unknown[]) {
  await mockSortBoard(page, entries);
  await page.route("**/sort/**", async (route) => {
    const url = route.request().url();
    if (url.includes("/sort/levels")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          levels: [
            { id: 1, bottles: [["red", "red", "blue", "blue"], [], [], []] },
          ],
        }),
      });
    } else {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({}),
      });
    }
  });
}

async function openLeaderboard(page: Page) {
  await page.goto("/");
  await page.evaluate(() => localStorage.removeItem("@sort/progress"));
  await page.getByRole("button", { name: "Play Sort Puzzle" }).click();
  await page.getByText("Choose a Level").waitFor({ timeout: 10_000 });
  await page.getByRole("button", { name: "More options" }).click();
  await page.getByRole("menuitem", { name: "Leaderboard" }).click();
  await page.getByText("Sort Puzzle Leaderboard").waitFor({ timeout: 10_000 });
}

test.describe("Sort Puzzle — leaderboard screen", () => {
  test.beforeEach(async ({ page }) => {
    await installEntitlementsMock(page);
    await installSortMock(page, TOP_10);
    await openLeaderboard(page);
  });

  test("has no inline Leaderboard tab any more", async ({ page }) => {
    await expect(page.getByRole("tab", { name: /Leaderboard/i })).toHaveCount(0);
  });

  test("renders top-10 player names", async ({ page }) => {
    // exact: "Player1" is otherwise also a substring of "Player10".
    await expect(page.getByText("Player1", { exact: true })).toBeVisible({
      timeout: 5_000,
    });
    await expect(page.getByText("Player10")).toBeVisible({ timeout: 5_000 });
  });

  test("each row announces its rank, name and level", async ({ page }) => {
    await expect(
      page.getByLabel(/^Rank 1, Player1, Level 10, /),
    ).toBeVisible({ timeout: 5_000 });
    await expect(
      page.getByLabel(/^Rank 10, Player10, Level 1, /),
    ).toBeVisible({ timeout: 5_000 });
  });

  test("Back returns to the level select", async ({ page }) => {
    await page.getByRole("button", { name: "Back to Sort Puzzle" }).click();
    await expect(page.getByText("Choose a Level")).toBeVisible({
      timeout: 5_000,
    });
  });
});

test("Sort Puzzle — empty leaderboard shows empty state message", async ({
  page,
}) => {
  await installEntitlementsMock(page);
  await installSortMock(page, []);
  await openLeaderboard(page);
  await expect(
    page.getByText(
      "No one is on this board yet. Finish a game to claim the top spot.",
    ),
  ).toBeVisible({ timeout: 5_000 });
});
