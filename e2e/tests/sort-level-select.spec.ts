/**
 * sort-level-select.spec.ts — GH #1255
 *
 * Level-select grid: locked/unlocked states, continue button, and
 * tapping an unlocked level transitions to the play view.
 */

import { test, expect } from "@playwright/test";
import { mockSortApi, gotoSort, injectSortProgress, resumeSortFromLobby } from "./helpers/sort";

test.describe("Sort Puzzle — level select", () => {
  test("locked levels are disabled and labelled as locked", async ({ page }) => {
    await mockSortApi(page);
    await gotoSort(page);
    const lockedBtn = page.getByRole("button", { name: "Level 2, locked", exact: true });
    await expect(lockedBtn).toBeVisible({ timeout: 5_000 });
    await expect(lockedBtn).toBeDisabled();
  });

  test("tapping an unlocked level starts gameplay", async ({ page }) => {
    await mockSortApi(page);
    await gotoSort(page);
    await page.getByRole("button", { name: "Level 1", exact: true }).click();
    await expect(page.getByLabel("Sort Puzzle board")).toBeVisible({ timeout: 5_000 });
  });

  test("level 1 is always unlocked on a fresh install", async ({ page }) => {
    await mockSortApi(page);
    await gotoSort(page);
    await expect(
      page.getByRole("button", { name: "Level 1", exact: true }),
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
    // The lobby tile resumes the saved level directly (#4008); back out of it to the level grid,
    // which still offers Continue for the same board.
    await resumeSortFromLobby(page);
    await page.getByRole("button", { name: "Back to levels" }).click();
    await page.getByText("Choose a Level").waitFor({ timeout: 10_000 });
    await expect(
      page.getByRole("button", { name: "Continue Level 1" }),
    ).toBeVisible({ timeout: 5_000 });
  });

  test("the lobby Resume tile opens the saved level, not the level grid", async ({ page }) => {
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
    await resumeSortFromLobby(page);
    await expect(page.getByText(/Moves:\s*2/)).toBeVisible({ timeout: 3_000 });
  });

  test("the lobby tile says Play, and opens the level grid, with no board saved", async ({
    page,
  }) => {
    await mockSortApi(page);
    await injectSortProgress(page, {
      unlockedLevel: 2,
      currentLevelId: null,
      currentState: null,
    });
    await expect(page.getByTestId("game-btn-sort")).toContainText("Play");
    await expect(page.getByTestId("game-btn-sort")).not.toContainText("Resume");
    await page.getByRole("button", { name: "Play Sort Puzzle" }).click();
    await page.getByText("Choose a Level").waitFor({ timeout: 10_000 });
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
      page.getByRole("button", { name: "Level 2", exact: true }),
    ).not.toBeDisabled({ timeout: 5_000 });
  });
});
