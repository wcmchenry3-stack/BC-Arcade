/**
 * sort-level-select.spec.ts — GH #1255
 *
 * Level-select grid: locked/unlocked states, continue button, and
 * tapping an unlocked level transitions to the play view.
 */

import { test, expect } from "@playwright/test";
import { mockSortApi, gotoSort, injectSortProgress } from "./helpers/sort";

test.describe("Sort Puzzle — level select", () => {
  test("locked levels are disabled and labelled as locked", async ({ page }) => {
    await mockSortApi(page);
    await gotoSort(page);
    const lockedBtn = page.getByRole("button", { name: "Level 2, locked" });
    await expect(lockedBtn).toBeVisible({ timeout: 5_000 });
    await expect(lockedBtn).toBeDisabled();
  });

  test("tapping an unlocked level starts gameplay", async ({ page }) => {
    await mockSortApi(page);
    await gotoSort(page);
    await page.getByRole("button", { name: "Level 1" }).click();
    await expect(page.getByLabel("Sort Puzzle board")).toBeVisible({ timeout: 5_000 });
  });

  test("level 1 is always unlocked on a fresh install", async ({ page }) => {
    await mockSortApi(page);
    await gotoSort(page);
    await expect(
      page.getByRole("button", { name: "Level 1" }),
    ).not.toBeDisabled({ timeout: 5_000 });
  });

  test("continue button appears when a level is in progress", async ({ page }) => {
    await mockSortApi(page);
    await injectSortProgress(page, {
      unlockedLevel: 1,
      currentLevelId: 1,
      currentState: {
        bottles: [["red"], ["blue"], [], []],
        moveCount: 2,
        undosUsed: 0,
        isComplete: false,
        selectedBottleIndex: null,
      },
    });
    await page.getByRole("button", { name: "Play Sort Puzzle" }).click();
    await page.getByText("Choose a Level").waitFor({ timeout: 10_000 });
    await expect(
      page.getByRole("button", { name: "Continue Level 1" }),
    ).toBeVisible({ timeout: 5_000 });
  });

  test("previously unlocked level shown as accessible after progress injection", async ({
    page,
  }) => {
    await mockSortApi(page);
    await injectSortProgress(page, {
      unlockedLevel: 2,
      currentLevelId: null,
      currentState: null,
    });
    await page.getByRole("button", { name: "Play Sort Puzzle" }).click();
    await page.getByText("Choose a Level").waitFor({ timeout: 10_000 });
    await expect(
      page.getByRole("button", { name: "Level 2" }),
    ).not.toBeDisabled({ timeout: 5_000 });
  });
});
