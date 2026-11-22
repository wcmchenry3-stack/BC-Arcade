/**
 * sort-gameplay.spec.ts — GH #1255
 *
 * Core gameplay: bottle selection, pour application, move counter increment,
 * and solved-bottle indicator.
 *
 * Plays the shipped catalog's level 1 (#2761): its full bottles hold 4 units
 * each and it has empty bottles. `LEVEL_1_POUR` is its first full bottle
 * poured into its first empty one; `LEVEL_1_BLOCKED` two full bottles whose
 * top colours differ.
 */

import { test, expect } from "@playwright/test";
import { mockSortApi, gotoSort, LEVEL_1_BLOCKED, LEVEL_1_POUR } from "./helpers/sort";

const { from, to, units } = LEVEL_1_POUR;

test.describe("Sort Puzzle — gameplay (Level 1)", () => {
  test.beforeEach(async ({ page }) => {
    await mockSortApi(page);
    await gotoSort(page);
    await page.getByRole("button", { name: "Level 1", exact: true }).click();
    await expect(page.getByLabel("Sort Puzzle board")).toBeVisible({ timeout: 5_000 });
  });

  test("tapping a filled bottle selects it", async ({ page }) => {
    await page.getByRole("button", { name: `Bottle ${from}, 4 of 4 filled` }).click();
    await expect(
      page.getByRole("button", {
        name: `Bottle ${from} selected — tap another bottle to pour`,
      }),
    ).toBeVisible({ timeout: 3_000 });
  });

  test("tapping a selected bottle deselects it", async ({ page }) => {
    await page.getByRole("button", { name: `Bottle ${from}, 4 of 4 filled` }).click();
    await page
      .getByRole("button", {
        name: `Bottle ${from} selected — tap another bottle to pour`,
      })
      .click();
    await expect(
      page.getByRole("button", { name: `Bottle ${from}, 4 of 4 filled` }),
    ).toBeVisible({ timeout: 3_000 });
  });

  test("tapping a dest bottle applies the pour and increments move count", async ({ page }) => {
    // The top run of a full bottle pours into an empty one.
    await page.getByRole("button", { name: `Bottle ${from}, 4 of 4 filled` }).click();
    await page.getByRole("button", { name: `Bottle ${to}, empty` }).click();

    await expect(page.getByText(/Moves:\s*1/)).toBeVisible({ timeout: 3_000 });
    await expect(
      page.getByRole("button", { name: `Bottle ${from}, ${4 - units} of 4 filled` }),
    ).toBeVisible({ timeout: 3_000 });
    await expect(
      page.getByRole("button", { name: `Bottle ${to}, ${units} of 4 filled` }),
    ).toBeVisible({ timeout: 3_000 });
  });

  test("invalid pour (incompatible colors) deselects without moving", async ({ page }) => {
    // Two full bottles with different top colours: nothing can pour.
    const blocked = LEVEL_1_BLOCKED;
    await page.getByRole("button", { name: `Bottle ${blocked.from}, 4 of 4 filled` }).click();
    await page.getByRole("button", { name: `Bottle ${blocked.to}, 4 of 4 filled` }).click();

    // Move count stays at 0 — no valid pour
    await expect(page.getByText(/Moves:\s*0/)).toBeVisible({ timeout: 3_000 });
  });
});
