/**
 * mahjong-leaderboard.spec.ts — GH #1146, #2510
 *
 * The shared result card: a completed game (all 72 pairs removed,
 * isComplete = true) loads straight onto the win card, and a deadlocked game
 * (no free pairs, no shuffles) shows the loss card. A won game resumed from
 * storage never submits again — its score went out when it was won. (The
 * in-session auto-submit under the display name is covered by
 * MahjongScreen.test.tsx: winning live on web means hitting canvas tiles.)
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

/** Intercepts the Mahjong API; returns the POST bodies the app sends. */
async function routeMahjongApi(
  page: import("@playwright/test").Page,
): Promise<Record<string, unknown>[]> {
  const posts: Record<string, unknown>[] = [];
  await page.route("**/mahjong/**", async (route) => {
    if (route.request().method() === "POST") {
      posts.push(JSON.parse(route.request().postData() ?? "{}"));
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ scores: [] }),
    });
  });
  return posts;
}

async function openMahjong(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "Play Mahjong Solitaire" }).click();
  await page
    .getByRole("heading", { name: "Mahjong Solitaire", exact: true })
    .waitFor({ timeout: 10_000 });
}

test.describe("Mahjong — result card", () => {
  test("a completed game shows the win card and does not resubmit", async ({
    page,
  }) => {
    const posts = await routeMahjongApi(page);
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
    expect(posts).toEqual([]);
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
    const posts = await routeMahjongApi(page);
    await injectMahjongState(page, DEADLOCK_STATE);
    await openMahjong(page);

    const card = page.getByTestId("mahjong-result");
    await expect(card).toBeVisible({ timeout: 5_000 });
    await expect(card.getByText("You Lose")).toBeVisible();
    await expect(card.getByText("No free pairs remain")).toBeVisible();
    await expect(
      card.getByRole("button", { name: "Change Layout" }),
    ).toBeVisible();
    expect(posts).toEqual([]);
  });
});
