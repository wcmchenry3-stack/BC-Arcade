/**
 * hearts-leaderboard.spec.ts — GH #1142, #2506
 *
 * Result card + leaderboard: inject the last trick of a hand with West
 * already at 100, let the AIs finish it (the human wins the trick, +1), and
 * verify the shared result card submits under the player's display name with
 * no name entry — or asks for one once when none is set. A finished game
 * resumed from storage shows the card without submitting again.
 *
 * Score submitted = Math.max(0, 100 − cumulativeScores[0]).
 * The human ends on 46: score = 54.
 *
 * All backend calls are intercepted — no running backend needed.
 */

import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";
import { injectHeartsState } from "./helpers/hearts";

// Player 0 leads with 45 points (lowest). Player 1 is already at 100.
// scoreHistory rows must be valid: each value in [0,26], each row sums to 26
// (normal hand) or 78 with exactly one 0 and three 26s (moon shot). Column
// sums must equal cumulativeScores. P0 shoots the moon twice (rows 0–1) so
// their delta stays 0 while others accumulate; normal hands fill the rest.
const GAME_OVER_STATE = {
  _v: 2,
  phase: "game_over",
  handNumber: 7,
  passDirection: "none",
  playerHands: [[], [], [], []],
  cumulativeScores: [45, 100, 63, 52],
  handScores: [0, 0, 0, 0],
  scoreHistory: [
    [0, 26, 26, 26], // P0 shoots moon — sum 78
    [0, 26, 26, 26], // P0 shoots moon — sum 78
    [12, 12, 2, 0], // normal — sum 26
    [12, 12, 2, 0], // normal — sum 26
    [12, 12, 2, 0], // normal — sum 26
    [9, 12, 5, 0], // normal — sum 26
  ],
  passSelections: [[], [], [], []],
  passingComplete: true,
  currentTrick: [],
  currentLeaderIndex: 0,
  currentPlayerIndex: 0,
  wonCards: [[], [], [], []],
  heartsBroken: false,
  tricksPlayedInHand: 0,
  isComplete: true,
  winnerIndex: 0, // Player 0 wins (lowest score)
};

// The last trick of hand 7: the human led ♥5, the AIs follow with diamonds.
const LAST_TRICK_STATE = {
  ...GAME_OVER_STATE,
  _v: 3,
  aiDifficulty: "schemer",
  phase: "playing",
  isComplete: false,
  winnerIndex: null,
  heartsBroken: true,
  tricksPlayedInHand: 12,
  currentLeaderIndex: 0,
  currentPlayerIndex: 1,
  currentTrick: [{ card: { suit: "hearts", rank: 5 }, playerIndex: 0 }],
  playerHands: [
    [],
    [{ suit: "diamonds", rank: 7 }],
    [{ suit: "diamonds", rank: 8 }],
    [{ suit: "diamonds", rank: 9 }],
  ],
};

const DISPLAY_NAME_KEY = "player_display_name";

/** Intercepts the Hearts API; returns the POST bodies the app sends. */
async function routeHeartsApi(page: Page): Promise<Record<string, unknown>[]> {
  const posts: Record<string, unknown>[] = [];
  await page.route("**/hearts/**", async (route) => {
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

/** Opens a saved game, optionally under a display name. */
async function openGame(
  page: Page,
  state: Record<string, unknown>,
  displayName?: string,
): Promise<void> {
  await injectHeartsState(page, state);
  if (displayName) {
    await page.evaluate(([key, name]) => localStorage.setItem(key, name), [
      DISPLAY_NAME_KEY,
      displayName,
    ] as const);
    await page.goto("/");
  }
  await page.getByRole("button", { name: "Play Hearts" }).click();
  await page
    .getByRole("heading", { name: "Hearts", exact: true })
    .waitFor({ timeout: 10_000 });
}

/** Lets the AIs play out the final trick, which ends the game. */
async function finishGame(page: Page, displayName?: string): Promise<void> {
  await openGame(page, LAST_TRICK_STATE, displayName);
  await expect(page.getByTestId("hearts-result")).toBeVisible({
    timeout: 15_000,
  });
}

test.describe("Hearts — result card + leaderboard", () => {
  test("submits under the saved display name with no name entry", async ({
    page,
  }) => {
    const posts = await routeHeartsApi(page);
    await finishGame(page, "Tester");

    const card = page.getByTestId("hearts-result");
    await expect(card.getByText("You Win!")).toBeVisible();
    await expect(
      card.getByText("West reached 100 · lowest score wins"),
    ).toBeVisible();
    await expect(card.getByTestId("hearts-final-standings")).toBeVisible();
    await expect(
      page.getByText("Saved as Tester · #1 on the leaderboard"),
    ).toBeVisible({ timeout: 15_000 });
    expect(posts).toEqual([{ player_name: "Tester", score: 54 }]);
    await expect(
      card.getByRole("button", { name: "Play Again" }),
    ).toBeVisible();
    await expect(
      card.getByRole("button", { name: "Change Difficulty" }),
    ).toBeVisible();
    await expect(card.getByRole("button", { name: "Home" })).toBeVisible();
  });

  test("asks for a display name once when none is set, then submits", async ({
    page,
  }) => {
    const posts = await routeHeartsApi(page);
    await finishGame(page);

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
    expect(posts).toEqual([{ player_name: "Tester", score: 54 }]);
  });

  test("a finished game resumed from storage shows the card without resubmitting", async ({
    page,
  }) => {
    const posts = await routeHeartsApi(page);
    await openGame(page, GAME_OVER_STATE, "Tester");

    await expect(page.getByTestId("hearts-result")).toBeVisible({
      timeout: 5_000,
    });
    await page.waitForTimeout(1_000);
    expect(posts).toEqual([]);
  });
});
