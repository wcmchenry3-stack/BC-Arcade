/**
 * solitaire-leaderboard.spec.ts — GH #1143, #2509, #2632
 *
 * Result card + leaderboard: inject a game one move from winning (the King
 * of Clubs on the waste), auto-complete it, and verify the shared result card
 * shows where the synced game ranks (GET /games/{id}/rank) under the player's
 * display name with no name entry (or asks for one once when none is set).
 * Nothing goes to the legacy POST /solitaire/score (#2632). A resumed,
 * already-won save shows the card without looking its rank up again.
 *
 * All backend calls are intercepted — no running backend needed.
 */

import { test, expect, type Page } from "@playwright/test";
import { injectSolitaireState } from "./helpers/solitaire";
import { routeSessionBoard } from "./helpers/sessionBoard";

const allRanks = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];
const card = (suit: string, rank: number) => ({ suit, rank, faceUp: true });

const WON_STATE = {
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
  events: ["foundationComplete", "gameWin"],
};

const NEAR_WIN_STATE = {
  ...WON_STATE,
  foundations: {
    ...WON_STATE.foundations,
    clubs: allRanks.slice(0, 12).map((r) => card("clubs", r)),
  },
  waste: [card("clubs", 13)],
  isComplete: false,
  events: [],
};

const DISPLAY_NAME_KEY = "player_display_name";

/** Mocks the rank lookup and records any legacy Solitaire call. */
const routeSolitaireApi = (page: Page) =>
  routeSessionBoard(page, { legacyPattern: "**/solitaire/**" });

/** Opens a saved game, optionally under a display name. */
async function openGame(
  page: Page,
  state: Record<string, unknown>,
  displayName?: string,
): Promise<void> {
  await injectSolitaireState(page, state);
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
}

/** Auto-completes the last card onto its foundation and waits out the win cascade. */
async function winGame(page: Page, displayName?: string): Promise<void> {
  await openGame(page, NEAR_WIN_STATE, displayName);
  await page.getByRole("button", { name: "Auto-Complete" }).click();
  await expect(page.getByText("You Win!")).toBeVisible({ timeout: 10_000 });
}

test.describe("Solitaire — result card + leaderboard", () => {
  test("shows the rank under the saved display name with no name entry", async ({
    page,
  }) => {
    const calls = await routeSolitaireApi(page);
    await winGame(page, "Tester");

    await expect(
      page.getByText("Saved as Tester · #1 on the leaderboard"),
    ).toBeVisible({ timeout: 15_000 });
    expect(calls.rankLookups).toHaveLength(1);
    expect(calls.legacyCalls).toEqual([]);
    const card = page.getByTestId("solitaire-result");
    await expect(
      card.getByRole("button", { name: "Play Again" }),
    ).toBeVisible();
    await expect(
      card.getByRole("button", { name: "Change Mode" }),
    ).toBeVisible();
    await expect(card.getByRole("button", { name: "Home" })).toBeVisible();
  });

  test("asks for a display name once when none is set, then shows the rank", async ({
    page,
  }) => {
    const calls = await routeSolitaireApi(page);
    await winGame(page);

    const nameInput = page.getByLabel("Pick a display name for leaderboards");
    await expect(nameInput).toBeVisible({ timeout: 5_000 });
    const save = page.getByRole("button", { name: "Save" });
    await expect(save).toBeDisabled();
    expect(calls.rankLookups).toEqual([]);

    await nameInput.fill("Tester");
    await save.click();

    await expect(
      page.getByText("Saved as Tester · #1 on the leaderboard"),
    ).toBeVisible({ timeout: 15_000 });
    expect(calls.rankLookups).toHaveLength(1);
    expect(calls.legacyCalls).toEqual([]);
  });

  test("a resumed, already-won game shows the card without a rank lookup", async ({
    page,
  }) => {
    const calls = await routeSolitaireApi(page);
    await openGame(page, WON_STATE, "Tester");

    await expect(page.getByText("You Win!")).toBeVisible({ timeout: 5_000 });
    await expect(
      page.getByTestId("solitaire-result").getByRole("button", {
        name: "Play Again",
      }),
    ).toBeVisible();
    await page.waitForTimeout(1_000);
    expect(calls.rankLookups).toEqual([]);
    expect(calls.legacyCalls).toEqual([]);
  });
});
