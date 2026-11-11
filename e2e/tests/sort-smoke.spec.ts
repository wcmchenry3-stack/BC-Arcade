/**
 * sort-smoke.spec.ts — GH #1255
 *
 * Smoke tests: navigation from Home to Sort Puzzle, level-select visibility,
 * and locked-level progression gate (Sort is free — see mahjong-smoke.spec.ts
 * for the home-screen premium-gate coverage, swapped tiers 2026-09-24).
 */

import { test, expect } from "@playwright/test";
import { mockSortApi, gotoSort } from "./helpers/sort";

test.describe("Sort Puzzle — smoke tests", () => {
  test.beforeEach(async ({ page }) => {
    await mockSortApi(page);
    await gotoSort(page);
  });

  test("navigates from Home to Sort Puzzle level-select screen", async ({ page }) => {
    // The Home card underneath the stack also reads "Sort Puzzle" (hidden).
    await expect(
      page.getByText("Sort Puzzle", { exact: true }).filter({ visible: true }).first(),
    ).toBeVisible();
    await expect(page.getByText("Choose a Level")).toBeVisible();
  });

  test("level-select screen shows level grid on fresh install", async ({ page }) => {
    await expect(
      page.getByRole("button", { name: "Level 1" }),
    ).toBeVisible({ timeout: 5_000 });
  });

  test("level 1 is unlocked on a fresh install", async ({ page }) => {
    await expect(
      page.getByRole("button", { name: "Level 1" }),
    ).not.toBeDisabled({ timeout: 5_000 });
  });

  test("plays the levels shipped in the app, with no level request (#2761)", async ({
    page,
  }) => {
    const levelRequests: string[] = [];
    page.on("request", (req) => {
      if (req.url().includes("/sort/levels")) levelRequests.push(req.url());
    });
    await page.goto("/");
    await page.getByRole("button", { name: "Play Sort Puzzle" }).click();
    await page.getByText("Choose a Level").waitFor({ timeout: 10_000 });
    await page.getByRole("button", { name: "Level 1" }).click();
    await expect(page.getByLabel("Sort Puzzle board")).toBeVisible({ timeout: 5_000 });
    // The grid holds the whole catalog: 120 levels.
    await page.getByRole("button", { name: "Back to levels" }).click();
    await expect(page.getByRole("button", { name: "Level 120, locked" })).toBeAttached();
    expect(levelRequests).toEqual([]);
  });

  test("locked levels show progression gate", async ({ page }) => {
    const lockedBtn = page.getByRole("button", { name: "Level 2, locked" });
    await expect(lockedBtn).toBeVisible({ timeout: 5_000 });
    await expect(lockedBtn).toBeDisabled();
  });
});
