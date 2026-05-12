/**
 * sort-smoke.spec.ts — GH #1255
 *
 * Smoke tests: navigation from Home to Sort Puzzle, level-select visibility,
 * locked-level premium gate, and the home-screen premium gate when not entitled.
 */

import { test, expect } from "@playwright/test";
import { mockSortApi, gotoSort } from "./helpers/sort";

test.describe("Sort Puzzle — smoke tests", () => {
  test.beforeEach(async ({ page }) => {
    await mockSortApi(page);
    await gotoSort(page);
  });

  test("navigates from Home to Sort Puzzle level-select screen", async ({ page }) => {
    await expect(page.getByText("Sort Puzzle").first()).toBeVisible();
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

  test("locked levels show premium gate", async ({ page }) => {
    const lockedBtn = page.getByRole("button", { name: "Level 2, locked" });
    await expect(lockedBtn).toBeVisible({ timeout: 5_000 });
    await expect(lockedBtn).toBeDisabled();
  });
});

test("Sort Puzzle card shows premium gate on home screen when not entitled", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: /Sort Puzzle — Coming soon/ }),
  ).toBeVisible({ timeout: 10_000 });
});
