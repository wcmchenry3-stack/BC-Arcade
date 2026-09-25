/**
 * mahjong-leaderboard.spec.ts — GH #1146, #2510, #2627
 *
 * The shared result card: a completed game (all 72 pairs removed,
 * isComplete = true) loads straight onto the win card, and a deadlocked game
 * (no free pairs, no shuffles) shows the loss card. Since #2627 the finished
 * game is the leaderboard entry: the app never posts to `/mahjong/*`, and a
 * won game resumed from storage doesn't ask for its rank again — its session
 * ended when it was won. (The in-session win, recorded as `win` and ranked
 * through `GET /games/{id}/rank`, is covered by MahjongScreen.test.tsx:
 * winning live on web means hitting canvas tiles.)
 *
 * All backend calls are intercepted — no running backend needed.
 */

import { test, expect } from "@playwright/test";
import { injectMahjongState } from "./helpers/mahjong";

const WIN_STATE = {
  _v: 1,
  tiles: [],
  pairsRemoved: 72,
  score: 1220,
  shufflesLeft: 0,
  selected: null,
  undoStack: [],
  isComplete: true,
  isDeadlocked: false,
  startedAt: null,
  accumulatedMs: 120_000,
  dealId: "ff00",
};

const DEADLOCK_STATE = {
  ...WIN_STATE,
  pairsRemoved: 40,
  score: 640,
  isComplete: false,
  isDeadlocked: true,
};

/**
 * Intercepts the legacy Mahjong API and the rank route; returns the URLs of
 * every leaderboard call the app makes (none are expected here).
 */
async function routeMahjongApi(
  page: import("@playwright/test").Page,
): Promise<string[]> {
  const calls: string[] = [];
  await page.route("**/mahjong/**", async (route) => {
    // Only POSTs count: `POST /mahjong/score` is the legacy submit.
    if (route.request().method() === "POST") calls.push(route.request().url());
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ scores: [] }),
    });
  });
  await page.route("**/games/*/rank", async (route) => {
    calls.push(route.request().url());
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ranked: true,
        rank: 1,
        is_best: true,
        reason: null,
      }),
    });
  });
  return calls;
}

async function openMahjong(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "Play Mahjong Solitaire" }).click();
  await page
    .getByRole("heading", { name: "Mahjong Solitaire", exact: true })
    .waitFor({ timeout: 10_000 });
}

test.describe("Mahjong — result card", () => {
  test("a completed game shows the win card and does not look up a rank again", async ({
    page,
  }) => {
    const calls = await routeMahjongApi(page);
    await injectMahjongState(page, WIN_STATE);
    await openMahjong(page);

    const card = page.getByTestId("mahjong-result");
    await expect(card).toBeVisible({ timeout: 5_000 });
    await expect(card.getByText("You Win!")).toBeVisible();
    await expect(card.getByText("All 72 pairs cleared")).toBeVisible();
    await expect(card.getByText("1,220")).toBeVisible();
    await expect(
      card.getByRole("button", { name: "Play Again" }),
    ).toBeVisible();
    await expect(
      card.getByRole("button", { name: "Change Layout" }),
    ).toBeVisible();
    await expect(card.getByRole("button", { name: "Home" })).toBeVisible();

    await page.waitForTimeout(1_000);
    expect(calls).toEqual([]);
  });

  test("Change Layout dismisses the card and a pick starts a fresh game", async ({
    page,
  }) => {
    await routeMahjongApi(page);
    await injectMahjongState(page, WIN_STATE);
    await openMahjong(page);

    const card = page.getByTestId("mahjong-result");
    await card.getByRole("button", { name: "Change Layout" }).click();
    await expect(card).not.toBeVisible({ timeout: 3_000 });

    await page.getByRole("button", { name: "Turtle", exact: true }).click();
    await expect(page.getByText(/^PAIRS\s+0\/72/).first()).toBeVisible({
      timeout: 5_000,
    });
  });

  test("a deadlocked game shows the loss card", async ({ page }) => {
    const calls = await routeMahjongApi(page);
    await injectMahjongState(page, DEADLOCK_STATE);
    await openMahjong(page);

    const card = page.getByTestId("mahjong-result");
    await expect(card).toBeVisible({ timeout: 5_000 });
    await expect(card.getByText("You Lose")).toBeVisible();
    await expect(card.getByText("No free pairs remain")).toBeVisible();
    await expect(
      card.getByRole("button", { name: "Change Layout" }),
    ).toBeVisible();
    expect(calls).toEqual([]);
  });
});
