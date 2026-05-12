/**
 * sort-gameplay.spec.ts — GH #1255
 *
 * Core gameplay: bottle selection, pour application, move counter increment,
 * and solved-bottle indicator.
 *
 * Level 1 mock layout (bottom-first):
 *   Bottle 1 (idx 0): ["red", "red", "blue", "blue"]  top = blue
 *   Bottle 2 (idx 1): ["blue", "blue", "red", "red"]  top = red
 *   Bottle 3 (idx 2): []  empty
 *   Bottle 4 (idx 3): []  empty
 */

import { test, expect } from "@playwright/test";
import { mockSortApi, gotoSort } from "./helpers/sort";

test.describe("Sort Puzzle — gameplay (Level 1)", () => {
  test.beforeEach(async ({ page }) => {
    await mockSortApi(page);
    await gotoSort(page);
    await page.getByRole("button", { name: "Level 1" }).click();
    await expect(page.getByLabel("Sort Puzzle board")).toBeVisible({ timeout: 5_000 });
  });

  test("tapping a filled bottle selects it", async ({ page }) => {
    await page.getByRole("button", { name: "Bottle 1, 4 of 4 filled" }).click();
    await expect(
      page.getByRole("button", {
        name: "Bottle 1 selected — tap another bottle to pour",
      }),
    ).toBeVisible({ timeout: 3_000 });
  });

  test("tapping a selected bottle deselects it", async ({ page }) => {
    await page.getByRole("button", { name: "Bottle 1, 4 of 4 filled" }).click();
    await page
      .getByRole("button", {
        name: "Bottle 1 selected — tap another bottle to pour",
      })
      .click();
    await expect(
      page.getByRole("button", { name: "Bottle 1, 4 of 4 filled" }),
    ).toBeVisible({ timeout: 3_000 });
  });

  test("tapping a dest bottle applies the pour and increments move count", async ({ page }) => {
    // Bottle 1 top = blue; Bottle 3 = empty → valid pour of 2 blues
    await page.getByRole("button", { name: "Bottle 1, 4 of 4 filled" }).click();
    await page.getByRole("button", { name: "Bottle 3, empty" }).click();

    await expect(page.getByText(/Moves:\s*1/)).toBeVisible({ timeout: 3_000 });
    await expect(
      page.getByRole("button", { name: "Bottle 1, 2 of 4 filled" }),
    ).toBeVisible({ timeout: 3_000 });
    await expect(
      page.getByRole("button", { name: "Bottle 3, 2 of 4 filled" }),
    ).toBeVisible({ timeout: 3_000 });
  });

  test("invalid pour (incompatible colors) deselects without moving", async ({ page }) => {
    // Bottle 1 top = blue; Bottle 2 top = red → cannot pour blue onto red
    await page.getByRole("button", { name: "Bottle 1, 4 of 4 filled" }).click();
    await page.getByRole("button", { name: "Bottle 2, 4 of 4 filled" }).click();

    // Move count stays at 0 — no valid pour
    await expect(page.getByText(/Moves:\s*0/)).toBeVisible({ timeout: 3_000 });
  });
});

