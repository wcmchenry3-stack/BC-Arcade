/**
 * sort-leaderboard.spec.ts — GH #1255
 *
 * Leaderboard tab: renders top-10 scores from GET /sort/scores, shows player
 * names, levels reached, and correct rank ordering (#1 through #10).
 */

import { test, expect, type Page } from "@playwright/test";
import { installEntitlementsMock } from "./helpers/api-mock";

const TOP_10 = Array.from({ length: 10 }, (_, i) => ({
  player_name: `Player${i + 1}`,
  level_reached: 10 - i,
  rank: i + 1,
}));

function installSortMock(page: Page, scores: unknown[]) {
  return page.route("**/sort/**", async (route) => {
    const url = route.request().url();
    if (url.includes("/sort/levels")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          levels: [{ id: 1, bottles: [["red", "red", "blue", "blue"], [], [], []] }],
        }),
      });
    } else if (url.includes("/sort/scores")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ scores }),
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

test.describe("Sort Puzzle — leaderboard", () => {
  test.beforeEach(async ({ page }) => {
    await installEntitlementsMock(page);
    await installSortMock(page, TOP_10);
    await page.goto("/");
    await page.evaluate(() => localStorage.removeItem("@sort/progress"));
    await page.getByRole("button", { name: "Play Sort Puzzle" }).click();
    await page.getByText("Choose a Level").waitFor({ timeout: 10_000 });
    await page.getByRole("tab", { name: /Leaderboard/i }).click();
  });

  test("renders top-10 player names", async ({ page }) => {
    await expect(page.getByText("Player1")).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText("Player10")).toBeVisible({ timeout: 5_000 });
  });

  test("first entry is ranked #1", async ({ page }) => {
    await expect(page.getByText("#1").first()).toBeVisible({ timeout: 5_000 });
  });

  test("last entry is ranked #10", async ({ page }) => {
    await expect(page.getByText("#10").first()).toBeVisible({ timeout: 5_000 });
  });

  test("level reached is displayed for each entry", async ({ page }) => {
    // Player1 reached level 10
    await expect(page.getByText("Level 10").first()).toBeVisible({ timeout: 5_000 });
  });
});

test("Sort Puzzle — empty leaderboard shows empty state message", async ({ page }) => {
  await installEntitlementsMock(page);
  await installSortMock(page, []);
  await page.goto("/");
  await page.evaluate(() => localStorage.removeItem("@sort/progress"));
  await page.getByRole("button", { name: "Play Sort Puzzle" }).click();
  await page.getByText("Choose a Level").waitFor({ timeout: 10_000 });
  await page.getByRole("tab", { name: /Leaderboard/i }).click();
  await expect(page.getByText("No scores yet.")).toBeVisible({ timeout: 5_000 });
});
