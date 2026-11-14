/**
 * sort-persistence.spec.ts — GH #1255
 *
 * Persistence: in-progress game state (move count) survives navigate-away-
 * and-back; unlockedLevel survives a full page reload.
 */

import { test, expect } from "@playwright/test";
import {
  mockSortApi,
  gotoSort,
  injectSortProgress,
  injectLegacySortSave,
  injectCatalogSaveWithOldBests,
  readSortBests,
  catalogLevel,
  catalogPar,
  LEVEL_1_POUR,
} from "./helpers/sort";

test("Sort Puzzle — in-progress state survives navigate away and back", async ({ page }) => {
  await mockSortApi(page);
  await gotoSort(page);

  // Start Level 1
  await page.getByRole("button", { name: "Level 1", exact: true }).click();
  await expect(page.getByLabel("Sort Puzzle board")).toBeVisible({ timeout: 5_000 });

  // Make one pour: a full bottle into an empty one (catalog level 1, #2761)
  const { from, to } = LEVEL_1_POUR;
  await page.getByRole("button", { name: `Bottle ${from}, 4 of 4 filled` }).click();
  await page.getByRole("button", { name: `Bottle ${to}, empty` }).click();
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
    page.getByRole("button", { name: "Level 2", exact: true }),
  ).not.toBeDisabled({ timeout: 5_000 });

  // Reload the page
  await page.reload();
  await page.getByRole("button", { name: "Play Sort Puzzle" }).waitFor({ timeout: 10_000 });

  // Navigate back to sort — Level 2 should still be unlocked
  await page.getByRole("button", { name: "Play Sort Puzzle" }).click();
  await page.getByText("Choose a Level").waitFor({ timeout: 10_000 });
  await expect(
    page.getByRole("button", { name: "Level 2", exact: true }),
  ).not.toBeDisabled({ timeout: 5_000 });
});

test("Sort Puzzle — a save from the random levels moves onto the catalog", async ({ page }) => {
  // #2761: old level 10 had 7 colours, so the player unlocks up to the first
  // catalog level with 7; their old bests are cleared and the unfinished board dropped.
  await mockSortApi(page);
  await injectLegacySortSave(
    page,
    {
      unlockedLevel: 10,
      currentLevelId: 9,
      currentState: {
        bottles: [["red"], ["blue"], [], []],
        moveCount: 2,
        undosUsed: 0,
        isComplete: false,
        selectedBottleIndex: null,
      },
    },
    { "1": 8, "9": 30 },
  );
  let firstSeven = 1;
  while (catalogLevel(firstSeven).filter((b) => b.length > 0).length < 7) firstSeven++;

  await page.getByRole("button", { name: "Play Sort Puzzle" }).click();
  await page.getByText("Choose a Level").waitFor({ timeout: 10_000 });
  await expect(page.getByRole("button", { name: `Level ${firstSeven}`, exact: true })).not.toBeDisabled({
    timeout: 5_000,
  });
  await expect(
    page.getByRole("button", { name: `Level ${firstSeven + 1}, locked`, exact: true }),
  ).toBeDisabled();
  await expect(page.getByRole("button", { name: /^Continue Level/ })).toHaveCount(0);
  const stored = {
    ...(await readSortBests(page)),
    version: await page.evaluate(() => localStorage.getItem("@sort/catalog_version")),
  };
  // Bests are written empty in the same write as the version (#2761 review: never removed
  // before the migrated progress is saved; that one write is unit-tested in
  // catalogMigration.test.ts). The grid shows only after the bests are read, by which time the
  // personal best (#3821) has moved the emptied `{}` in (nothing) and removed the old key: the
  // random levels' bests reached neither store.
  expect(stored).toEqual({ bests: null, legacy: null, version: "1" });
  await expect(
    page.getByRole("button", { name: "Level 1, 3 of 3 stars", exact: true }),
  ).toHaveCount(0);
});

test("Sort Puzzle — a catalog save's old best moves move into the personal best (#3821)", async ({
  page,
}) => {
  await mockSortApi(page);
  const par = catalogPar(1);
  await injectCatalogSaveWithOldBests(
    page,
    { unlockedLevel: 3, currentLevelId: null, currentState: null },
    { "1": par, "2": 999 },
  );

  await page.getByRole("button", { name: "Play Sort Puzzle" }).click();
  await page.getByText("Choose a Level").waitFor({ timeout: 10_000 });
  // Level 1's best (moves = par) still earns its 3 stars; level 2's still counts as solved.
  await expect(
    page.getByRole("button", { name: "Level 1, 3 of 3 stars", exact: true }),
  ).toBeVisible({ timeout: 5_000 });
  await expect(
    page.getByRole("button", { name: "Level 2, 1 of 3 stars", exact: true }),
  ).toBeVisible();
  // Written once in the new format; the old key removed only after that.
  const stored = await readSortBests(page);
  expect(stored.legacy).toBeNull();
  expect(JSON.parse(stored.bests ?? "null")).toEqual({ v: 1, b: { "1": par, "2": 999 } });

  // And it survives a reload, read from the new store alone.
  await page.reload();
  await page.getByRole("button", { name: "Play Sort Puzzle" }).click();
  await page.getByText("Choose a Level").waitFor({ timeout: 10_000 });
  await expect(
    page.getByRole("button", { name: "Level 1, 3 of 3 stars", exact: true }),
  ).toBeVisible({ timeout: 5_000 });
  expect(await readSortBests(page)).toEqual(stored);
});
