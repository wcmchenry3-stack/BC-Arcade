/**
 * sort-persistence.spec.ts — GH #1255
 *
 * Persistence: in-progress game state (move count) survives navigate-away-
 * and-back; unlockedLevel survives a full page reload.
 */

import { test, expect } from "@playwright/test";
import { mockSortApi, gotoSort, injectSortProgress } from "./helpers/sort";

test("Sort Puzzle — in-progress state survives navigate away and back", async ({ page }) => {
  await mockSortApi(page);
  await gotoSort(page);

  // Start Level 1
  await page.getByRole("button", { name: "Level 1" }).click();
  await expect(page.getByLabel("Sort Puzzle board")).toBeVisible({ timeout: 5_000 });

  // Make one pour: Bottle 1 (top=blue) → Bottle 3 (empty)
  await page.getByRole("button", { name: "Bottle 1, 4 of 4 filled" }).click();
  await page.getByRole("button", { name: "Bottle 3, empty" }).click();
  await expect(page.getByText(/Moves:\s*1/)).toBeVisible({ timeout: 3_000 });

  // Navigate away to home
  await page.goto("/");
  await page.getByRole("button", { name: "Play Sort Puzzle" }).waitFor({ timeout: 10_000 });

  // Return to Sort
  await page.getByRole("button", { name: "Play Sort Puzzle" }).click();
  await page.getByText("Choose a Level").waitFor({ timeout: 10_000 });

  // The continue button should appear since game was saved
  await expect(
    page.getByRole("button", { name: "Continue Level 1" }),
  ).toBeVisible({ timeout: 5_000 });

  await page.getByRole("button", { name: "Continue Level 1" }).click();
  await expect(page.getByLabel("Sort Puzzle board")).toBeVisible({ timeout: 5_000 });

  // Move count should still be 1
  await expect(page.getByText(/Moves:\s*1/)).toBeVisible({ timeout: 3_000 });
});

test("Sort Puzzle — unlockedLevel survives page reload", async ({ page }) => {
  await mockSortApi(page);
  await injectSortProgress(page, {
    unlockedLevel: 2,
    currentLevelId: null,
    currentState: null,
  });

  // Navigate to sort; Level 2 should be unlocked
  await page.getByRole("button", { name: "Play Sort Puzzle" }).click();
  await page.getByText("Choose a Level").waitFor({ timeout: 10_000 });
  await expect(
    page.getByRole("button", { name: "Level 2" }),
  ).not.toBeDisabled({ timeout: 5_000 });

  // Reload the page
  await page.reload();
  await page.getByRole("button", { name: "Play Sort Puzzle" }).waitFor({ timeout: 10_000 });

  // Navigate back to sort — Level 2 should still be unlocked
  await page.getByRole("button", { name: "Play Sort Puzzle" }).click();
  await page.getByText("Choose a Level").waitFor({ timeout: 10_000 });
  await expect(
    page.getByRole("button", { name: "Level 2" }),
  ).not.toBeDisabled({ timeout: 5_000 });
});
