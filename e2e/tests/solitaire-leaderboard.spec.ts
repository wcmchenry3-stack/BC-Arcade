/**
 * solitaire-leaderboard.spec.ts — GH #1143, #2509
 *
 * Result card + leaderboard: inject a completed game (all 52 cards in
 * foundations, isComplete = true), intercept POST /solitaire/score, and
 * verify the shared result card submits under the player's display name
 * with no name entry (or asks for one once when none is set).
 *
 * All backend calls are intercepted — no running backend needed.
 */

import { test, expect, type Page } from "@playwright/test";
import { injectSolitaireState } from "./helpers/solitaire";

const allRanks = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];
const card = (suit: string, rank: number) => ({ suit, rank, faceUp: true });

const WIN_STATE = {
  _v: 1,
  drawMode: 1 as const,
  tableau: [[], [], [], [], [], [], []],
  foundations: {
    spades: allRanks.map((r) => card("spades", r)),
    hearts: allRanks.map((r) => card("hearts", r)),
    diamonds: allRanks.map((r) => card("diamonds", r)),
    clubs: allRanks.map((r) => card("clubs", r)),
  },
  stock: [],
  waste: [],
  score: 1000,
  undoStack: [],
  isComplete: true,
  recycleCount: 0,
  events: [],
};

const DISPLAY_NAME_KEY = "player_display_name";

/** Intercepts the Solitaire API; returns the POST bodies the app sends. */
async function routeSolitaireApi(
  page: Page,
): Promise<Record<string, unknown>[]> {
  const posts: Record<string, unknown>[] = [];
  await page.route("**/solitaire/**", async (route) => {
    if (route.request().method() === "POST") {
      const body = JSON.parse(route.request().postData() ?? "{}");
      posts.push(body);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ...body, rank: 1 }),
      });
    } else {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ scores: [] }),
      });
    }
  });
  return posts;
}

/** Opens a saved, already-won game; the result card shows on load. */
async function openWonGame(page: Page, displayName?: string): Promise<void> {
  await injectSolitaireState(page, WIN_STATE);
  if (displayName) {
    await page.evaluate(([key, name]) => localStorage.setItem(key, name), [
      DISPLAY_NAME_KEY,
      displayName,
    ] as const);
    await page.goto("/");
  }
  await page.getByRole("button", { name: "Play Solitaire" }).click();
  await page
    .getByRole("heading", { name: "Solitaire", exact: true })
    .waitFor({ timeout: 10_000 });
  await expect(page.getByText("You Win!")).toBeVisible({ timeout: 5_000 });
}

test.describe("Solitaire — result card + leaderboard", () => {
  test("submits under the saved display name with no name entry", async ({
    page,
  }) => {
    const posts = await routeSolitaireApi(page);
    await openWonGame(page, "Tester");

    await expect(
      page.getByText("Saved as Tester · #1 on the leaderboard"),
    ).toBeVisible({ timeout: 15_000 });
    expect(posts).toEqual([{ player_name: "Tester", score: 1000 }]);
    const card = page.getByTestId("solitaire-result");
    await expect(
      card.getByRole("button", { name: "Play Again" }),
    ).toBeVisible();
    await expect(
      card.getByRole("button", { name: "Change Mode" }),
    ).toBeVisible();
    await expect(card.getByRole("button", { name: "Home" })).toBeVisible();
  });

  test("asks for a display name once when none is set, then submits", async ({
    page,
  }) => {
    const posts = await routeSolitaireApi(page);
    await openWonGame(page);

    const nameInput = page.getByLabel("Pick a display name for leaderboards");
    await expect(nameInput).toBeVisible({ timeout: 5_000 });
    const save = page.getByRole("button", { name: "Save" });
    await expect(save).toBeDisabled();
    expect(posts).toEqual([]);

    await nameInput.fill("Tester");
    await save.click();

    await expect(
      page.getByText("Saved as Tester · #1 on the leaderboard"),
    ).toBeVisible({ timeout: 15_000 });
    expect(posts).toEqual([{ player_name: "Tester", score: 1000 }]);
  });
});
