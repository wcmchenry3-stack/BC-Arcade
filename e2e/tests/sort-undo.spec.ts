/**
 * sort-undo.spec.ts — GH #1255
 *
 * Undo: button presence, disabled when history is empty, enabled after a pour,
 * and reversal of the last pour when activated.
 */

import { test, expect } from "@playwright/test";
import { mockSortApi, gotoSort } from "./helpers/sort";

test.describe("Sort Puzzle — undo", () => {
  test.beforeEach(async ({ page }) => {
    await mockSortApi(page);
    await gotoSort(page);
    await page.getByRole("button", { name: "Level 1" }).click();
    await expect(page.getByLabel("Sort Puzzle board")).toBeVisible({ timeout: 5_000 });
  });

  test("undo button is present in the HUD", async ({ page }) => {
    await expect(page.getByRole("button", { name: "Undo" })).toBeVisible();
  });

  test("undo button is disabled on a fresh game (empty history)", async ({ page }) => {
    await expect(page.getByRole("button", { name: "Undo" })).toBeDisabled({ timeout: 3_000 });
  });

  test("undo button is enabled after a pour", async ({ page }) => {
    // Make one pour: Bottle 1 (top=blue) → Bottle 3 (empty)
    await page.getByRole("button", { name: "Bottle 1, 4 of 4 filled" }).click();
    await page.getByRole("button", { name: "Bottle 3, empty" }).click();
    await expect(page.getByText(/Moves:\s*1/)).toBeVisible({ timeout: 3_000 });

    await expect(page.getByRole("button", { name: "Undo" })).not.toBeDisabled();
  });

  test("undo reverses the last pour", async ({ page }) => {
    // Pour Bottle 1 → Bottle 3 (2 blues move)
    await page.getByRole("button", { name: "Bottle 1, 4 of 4 filled" }).click();
    await page.getByRole("button", { name: "Bottle 3, empty" }).click();
    await expect(page.getByText(/Moves:\s*1/)).toBeVisible({ timeout: 3_000 });

    // Undo the pour
    await page.getByRole("button", { name: "Undo" }).click();

    // Bottles and move count revert to pre-pour state
    await expect(page.getByText(/Moves:\s*0/)).toBeVisible({ timeout: 3_000 });
    await expect(
      page.getByRole("button", { name: "Bottle 1, 4 of 4 filled" }),
    ).toBeVisible({ timeout: 3_000 });
    await expect(
      page.getByRole("button", { name: "Bottle 3, empty" }),
    ).toBeVisible({ timeout: 3_000 });
  });

  test("undo button is disabled again after undoing the only move", async ({ page }) => {
    // Make one pour then undo it — history is empty again
    await page.getByRole("button", { name: "Bottle 1, 4 of 4 filled" }).click();
    await page.getByRole("button", { name: "Bottle 3, empty" }).click();
    await expect(page.getByText(/Moves:\s*1/)).toBeVisible({ timeout: 3_000 });

    await page.getByRole("button", { name: "Undo" }).click();

    // History is now empty — button disabled
    await expect(
      page.getByRole("button", { name: "Bottle 1, 4 of 4 filled" }),
    ).toBeVisible({ timeout: 3_000 });
    await expect(page.getByRole("button", { name: "Undo" })).toBeDisabled({ timeout: 3_000 });
  });
});
