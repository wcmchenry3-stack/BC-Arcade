/**
 * freecell-leaderboard.spec.ts — GH #2035, #2508
 *
 * Result card + leaderboard: inject a game one card from winning (the King
 * of Spades alone in column 0), which auto-completes on load. Intercept
 * POST /freecell/score and verify the shared result card submits the move
 * count under the player's display name with no name entry (or asks for
 * one once when none is set). A resumed, already-won save shows the card
 * without submitting again.
 *
 * All backend calls are intercepted — no running backend needed.
 */

import { test, expect, type Page } from "@playwright/test";
import { injectFreecellState } from "./helpers/freecell";

const allRanks = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];
const pile = (suit: string, ranks: number[]) =>
  ranks.map((rank) => ({ suit, rank }));

const WON_STATE = {
  _v: 1,
  tableau: [[], [], [], [], [], [], [], []],
  freeCells: [null, null, null, null],
  foundations: {
    spades: pile("spades", allRanks),
    hearts: pile("hearts", allRanks),
    diamonds: pile("diamonds", allRanks),
    clubs: pile("clubs", allRanks),
  },
  undoStack: [],
  isComplete: true,
  moveCount: 52,
};

const NEAR_WIN_STATE = {
  ...WON_STATE,
  tableau: [[{ suit: "spades", rank: 13 }], [], [], [], [], [], [], []],
  foundations: {
    ...WON_STATE.foundations,
    spades: pile("spades", allRanks.slice(0, 12)),
  },
  isComplete: false,
  moveCount: 51,
};

const DISPLAY_NAME_KEY = "player_display_name";

/** Intercepts the FreeCell API; returns the POST bodies the app sends. */
async function routeFreecellApi(
  page: Page,
): Promise<Record<string, unknown>[]> {
  const posts: Record<string, unknown>[] = [];
  await page.route("**/freecell/**", async (route) => {
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
  await injectFreecellState(page, state);
  if (displayName) {
    await page.evaluate(([key, name]) => localStorage.setItem(key, name), [
      DISPLAY_NAME_KEY,
      displayName,
    ] as const);
    await page.goto("/");
  }
  await page.getByRole("button", { name: "Play FreeCell" }).click();
  await page
    .getByRole("heading", { name: "FreeCell", exact: true })
    .waitFor({ timeout: 10_000 });
}

/** Wins on load (the last card auto-completes) and waits out the celebration. */
async function winGame(page: Page, displayName?: string): Promise<void> {
  await openGame(page, NEAR_WIN_STATE, displayName);
  await expect(page.getByTestId("freecell-result")).toBeVisible({
    timeout: 10_000,
  });
}

test.describe("FreeCell — result card + leaderboard", () => {
  test("submits the move count under the saved display name", async ({
    page,
  }) => {
    const posts = await routeFreecellApi(page);
    await winGame(page, "Tester");

    const card = page.getByTestId("freecell-result");
    await expect(card.getByText("You Win!")).toBeVisible();
    await expect(card.getByText("Completed in 52 moves")).toBeVisible();
    await expect(
      page.getByText("Saved as Tester · #1 on the leaderboard"),
    ).toBeVisible({ timeout: 15_000 });
    expect(posts).toEqual([{ player_id: "Tester", move_count: 52 }]);
    await expect(
      card.getByRole("button", { name: "Play Again" }),
    ).toBeVisible();
    await expect(card.getByRole("button", { name: "Home" })).toBeVisible();
  });

  test("asks for a display name once when none is set, then submits", async ({
    page,
  }) => {
    const posts = await routeFreecellApi(page);
    await winGame(page);

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
    expect(posts).toEqual([{ player_id: "Tester", move_count: 52 }]);
  });

  test("Play Again dismisses the card and starts a fresh game", async ({
    page,
  }) => {
    await routeFreecellApi(page);
    await winGame(page, "Tester");

    await page
      .getByTestId("freecell-result")
      .getByRole("button", { name: "Play Again" })
      .click();

    await expect(page.getByTestId("freecell-result")).not.toBeVisible({
      timeout: 3_000,
    });
    await expect(page.getByText("Moves: 0")).toBeVisible({ timeout: 3_000 });
  });

  test("a resumed, already-won game shows the card without resubmitting", async ({
    page,
  }) => {
    const posts = await routeFreecellApi(page);
    await openGame(page, WON_STATE, "Tester");

    await expect(page.getByTestId("freecell-result")).toBeVisible({
      timeout: 5_000,
    });
    await page.waitForTimeout(1_000);
    expect(posts).toEqual([]);
  });
});
