/**
 * sort-win-flow.spec.ts — GH #1255, #2512, #2625
 *
 * Win flow: inject a near-solved state, complete the last pour, and verify
 * the shared result card — its stats, the scored session completion and the
 * rank the card reads from GET /games/{id}/rank (no POST /sort/score any
 * more), the next-level unlock, and the Next Level / Change Level actions
 * (available at once, with no score entry).
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

interface Captured {
  /** POST /sort/score bodies: the app must send none (#2625). */
  legacyPosts: Record<string, unknown>[];
  /** PATCH /games/{id}/complete bodies. */
  completions: Record<string, unknown>[];
}

/**
 * Mocks the session sync (`/games`, `/players/me`) and the rank lookup, and
 * captures what the app sends. Register after mockSortApi so it wins.
 */
async function captureSync(page: Page): Promise<Captured> {
  const captured: Captured = { legacyPosts: [], completions: [] };
  const ok = (body: unknown = {}) => ({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
  await page.route("**/sort/score", async (route) => {
    captured.legacyPosts.push(JSON.parse(route.request().postData() ?? "{}"));
    await route.fulfill(
      ok({ player_name: "Tester", level_reached: 1, rank: 3 }),
    );
  });
  await page.route("**/players/me", (route) => route.fulfill(ok()));
  await page.route(
    (url) => /^\/games(\/|$)/.test(url.pathname),
    async (route) => {
      const req = route.request();
      const url = req.url();
      if (url.includes("/leaderboard/")) return route.fallback();
      if (req.method() === "PATCH" && url.endsWith("/complete")) {
        captured.completions.push(JSON.parse(req.postData() ?? "{}"));
      }
      if (req.method() === "GET" && url.endsWith("/rank")) {
        return route.fulfill(
          ok({ rank: 3, is_best: true, ranked: true, reason: null }),
        );
      }
      return route.fulfill(ok());
    },
  );
  return captured;
}

async function loadNearSolvedLevel(
  page: Page,
  displayName?: string,
): Promise<Captured> {
  await mockSortApi(page);
  // Registered after mockSortApi so it takes priority (routes match LIFO).
  const captured = await captureSync(page);
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
  return captured;
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

  test("completes the level as the session's score and shows its rank", async ({
    page,
  }) => {
    const captured = await loadNearSolvedLevel(page, "Tester");
    await makeWinningPour(page);

    await expect(
      page.getByText("Saved as Tester · #3 on the leaderboard"),
    ).toBeVisible({ timeout: 10_000 });
    expect(captured.legacyPosts).toEqual([]);
    expect(captured.completions).toHaveLength(1);
    expect(captured.completions[0]).toMatchObject({
      final_score: 1,
      outcome: "completed",
      // First solve of level 1: its best (6 moves) is the whole total.
      result: {
        level: 1,
        moves: 6,
        undos: 0,
        level_reached: 1,
        total_moves: 6,
      },
    });
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
