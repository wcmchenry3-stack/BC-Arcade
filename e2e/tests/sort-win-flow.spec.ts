/**
 * sort-win-flow.spec.ts — GH #1255, #2512
 *
 * Win flow: inject a near-solved state, complete the last pour, and verify
 * the shared result card — its stats, the automatic POST /sort/score under
 * the player's display name, the next-level unlock, and the Next Level /
 * Change Level actions (available at once, with no score entry).
 *
 * Near-solved layout (injected via localStorage):
 *   Bottle 1 (idx 0): ["blue","blue","blue","blue"]  solved
 *   Bottle 2 (idx 1): ["red","red","red"]             needs 1 more red
 *   Bottle 3 (idx 2): ["red"]                         1 red to pour
 *   Bottle 4 (idx 3): []                              empty
 *
 * Winning move: pour Bottle 3 → Bottle 2 (1 red fills the last slot).
 */

import { test, expect, type Page } from "@playwright/test";
import { mockSortApi, injectSortProgress } from "./helpers/sort";

const NEAR_SOLVED = {
  unlockedLevel: 1,
  currentLevelId: 1,
  currentState: {
    bottles: [
      ["blue", "blue", "blue", "blue"],
      ["red", "red", "red"],
      ["red"],
      [],
    ],
    moveCount: 5,
    undosUsed: 0,
    isComplete: false,
    selectedBottleIndex: null,
  },
};

const DISPLAY_NAME_KEY = "player_display_name";

/** Captures POST /sort/score bodies; register after mockSortApi so it wins. */
async function capturePosts(page: Page): Promise<Record<string, unknown>[]> {
  const posts: Record<string, unknown>[] = [];
  await page.route("**/sort/score", async (route) => {
    if (route.request().method() === "POST") {
      posts.push(JSON.parse(route.request().postData() ?? "{}"));
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        player_name: "Tester",
        level_reached: 1,
        rank: 3,
      }),
    });
  });
  return posts;
}

async function loadNearSolvedLevel(
  page: Page,
  displayName?: string,
): Promise<Record<string, unknown>[]> {
  await mockSortApi(page);
  // Registered after mockSortApi so it takes priority (routes match LIFO).
  const posts = await capturePosts(page);
  await injectSortProgress(page, NEAR_SOLVED);
  if (displayName) {
    await page.evaluate(([key, name]) => localStorage.setItem(key, name), [
      DISPLAY_NAME_KEY,
      displayName,
    ] as const);
    await page.goto("/");
  }
  await page.getByRole("button", { name: "Play Sort Puzzle" }).click();
  await page.getByText("Choose a Level").waitFor({ timeout: 10_000 });
  await page.getByRole("button", { name: "Continue Level 1" }).click();
  await expect(page.getByLabel("Sort Puzzle board")).toBeVisible({
    timeout: 5_000,
  });
  return posts;
}

async function makeWinningPour(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Bottle 3, 1 of 4 filled" }).click();
  await expect(
    page.getByRole("button", {
      name: "Bottle 3 selected — tap another bottle to pour",
    }),
  ).toBeVisible({ timeout: 3_000 });
  await page.getByRole("button", { name: "Bottle 2, 3 of 4 filled" }).click();
  await expect(page.getByTestId("sort-result")).toBeVisible({ timeout: 5_000 });
}

test.describe("Sort Puzzle — win flow", () => {
  test("completing the last pour shows the result card with its stats", async ({
    page,
  }) => {
    await loadNearSolvedLevel(page);
    await makeWinningPour(page);

    const card = page.getByTestId("sort-result");
    await expect(card.getByText("You Win!")).toBeVisible();
    await expect(card.getByText("Sort Puzzle · Level 1")).toBeVisible();
    // moveCount was 5 + 1 winning pour = 6.
    await expect(card.getByText("6", { exact: true }).first()).toBeVisible();
    await expect(card.getByText("Undos")).toBeVisible();
  });

  test("submits the level to POST /sort/score under the display name", async ({
    page,
  }) => {
    const posts = await loadNearSolvedLevel(page, "Tester");
    await makeWinningPour(page);

    await expect(
      page.getByText("Saved as Tester · #3 on the leaderboard"),
    ).toBeVisible({ timeout: 10_000 });
    expect(posts).toEqual([{ player_name: "Tester", level_reached: 1 }]);
  });

  test("Next Level is available at once, with no score entry", async ({
    page,
  }) => {
    await loadNearSolvedLevel(page);
    await makeWinningPour(page);

    const next = page
      .getByTestId("sort-result")
      .getByRole("button", { name: "Next Level" });
    await expect(next).toBeVisible();
    await next.click();
    await expect(page.getByTestId("sort-result")).not.toBeVisible({
      timeout: 3_000,
    });
    await expect(page.getByText("Level 2").first()).toBeVisible({
      timeout: 5_000,
    });
  });

  test("Change Level returns to level select with the next level unlocked", async ({
    page,
  }) => {
    await loadNearSolvedLevel(page);
    await makeWinningPour(page);

    await page
      .getByTestId("sort-result")
      .getByRole("button", { name: "Change Level" })
      .click();

    await expect(
      page.getByRole("button", { name: "Level 2" }),
    ).not.toBeDisabled({
      timeout: 5_000,
    });
  });
});
