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

  test("locked levels show progression gate", async ({ page }) => {
    const lockedBtn = page.getByRole("button", { name: "Level 2, locked" });
    await expect(lockedBtn).toBeVisible({ timeout: 5_000 });
    await expect(lockedBtn).toBeDisabled();
  });
});
