/**
 * hearts-leaderboard.spec.ts — GH #1142, #2506, #2629
 *
 * Result card + leaderboard: inject the last trick of a hand with West
 * already at 100 and the human holding the last card. Playing it starts the
 * game's session (with the opponent style as `ai_difficulty`) and ends the
 * game. The finished game syncs itself (`POST /games`, `PATCH
 * /games/{id}/complete`) and the card shows where it ranks
 * (`GET /games/{id}/rank`) under the player's display name — or asks for
 * one once when none is set. Nothing goes to `POST /hearts/score` (#2629),
 * which was removed in #2644.
 * A finished game resumed from storage shows the card without sending
 * anything.
 *
 * final_score recorded = Math.max(0, 100 − cumulativeScores[0]).
 * The human discards ♥5 onto East's winning ♦9 and ends on 45: 55.
 *
 * No running backend is needed: the routes this spec depends on (the game
 * sync included) are intercepted with page.route(), and any other call
 * fails, which the app handles like being offline.
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

// The last trick of hand 7: West led ♦7, North and East followed; the human
// holds only ♥5 and plays it.
const LAST_TRICK_STATE = {
  ...GAME_OVER_STATE,
  _v: 3,
  aiDifficulty: "schemer",
  phase: "playing",
  isComplete: false,
  winnerIndex: null,
  heartsBroken: true,
  tricksPlayedInHand: 12,
  currentLeaderIndex: 1,
  currentPlayerIndex: 0,
  currentTrick: [
    { card: { suit: "diamonds", rank: 7 }, playerIndex: 1 },
    { card: { suit: "diamonds", rank: 8 }, playerIndex: 2 },
    { card: { suit: "diamonds", rank: 9 }, playerIndex: 3 },
  ],
  playerHands: [[{ suit: "hearts", rank: 5 }], [], [], []],
};

const DISPLAY_NAME_KEY = "player_display_name";

interface Traffic {
  /** Requests to the removed Hearts routes (`/hearts/...`, #2644). */
  hearts: string[];
  /** `POST /games` bodies. */
  creates: Record<string, unknown>[];
  /** `PATCH /games/{id}/complete` bodies. */
  completes: Record<string, unknown>[];
  /** `GET /games/{id}/rank` calls. */
  ranks: string[];
}

/** Intercepts the game sync, rank and player routes, and records any `/hearts/` call. */
async function routeApi(page: Page): Promise<Traffic> {
  const traffic: Traffic = {
    hearts: [],
    creates: [],
    completes: [],
    ranks: [],
  };
  const json = (body: unknown) => ({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
  await page.route("**/hearts/**", async (route) => {
    traffic.hearts.push(`${route.request().method()} ${route.request().url()}`);
    await route.fulfill({ ...json({ detail: "Not Found" }), status: 404 });
  });
  await page.route("**/players/me", async (route) => {
    const body = JSON.parse(route.request().postData() ?? "{}");
    await route.fulfill(json({ display_name: body.display_name ?? null }));
  });
  await page.route("**/games**", async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    const body = JSON.parse(req.postData() ?? "{}");
    if (req.method() === "POST" && path.endsWith("/games")) {
      traffic.creates.push(body);
      await route.fulfill(json({ id: body.id }));
    } else if (req.method() === "PATCH" && path.endsWith("/complete")) {
      traffic.completes.push(body);
      await route.fulfill(json({ id: path.split("/").slice(-2)[0] }));
    } else if (req.method() === "GET" && path.endsWith("/rank")) {
      traffic.ranks.push(path);
      await route.fulfill(
        json({ rank: 1, is_best: true, ranked: true, reason: null }),
      );
    } else {
      await route.fulfill(json({}));
    }
  });
  return traffic;
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

/** Plays the human's last card, which ends the game. */
async function finishGame(page: Page, displayName?: string): Promise<void> {
  await openGame(page, LAST_TRICK_STATE, displayName);
  await page.getByTestId("hearts-hand-card-0").getByRole("button").click();
  await expect(page.getByTestId("hearts-result")).toBeVisible({
    timeout: 15_000,
  });
}

test.describe("Hearts — result card + leaderboard", () => {
  test("shows the game's rank under the saved display name with no name entry", async ({
    page,
  }) => {
    const traffic = await routeApi(page);
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

    expect(traffic.creates).toHaveLength(1);
    expect(traffic.creates[0]).toMatchObject({
      game_type: "hearts",
      metadata: { ai_difficulty: "schemer" },
    });
    expect(traffic.completes).toHaveLength(1);
    expect(traffic.completes[0]).toMatchObject({
      outcome: "win",
      final_score: 55,
      result: { final_score: 55, vs_result: "win" },
    });
    // The play clock's active time (#2629), never 0.
    expect(traffic.completes[0].duration_ms).toBeGreaterThan(0);
    expect(traffic.ranks).toEqual([`/games/${traffic.creates[0].id}/rank`]);
    expect(traffic.hearts).toEqual([]);

    await expect(
      card.getByRole("button", { name: "Play Again" }),
    ).toBeVisible();
    await expect(
      card.getByRole("button", { name: "Change Difficulty" }),
    ).toBeVisible();
    await expect(card.getByRole("button", { name: "Home" })).toBeVisible();
  });

  test("asks for a display name once when none is set, then shows the rank", async ({
    page,
  }) => {
    const traffic = await routeApi(page);
    await finishGame(page);

    const nameInput = page.getByLabel("Pick a display name for leaderboards");
    await expect(nameInput).toBeVisible({ timeout: 5_000 });
    const save = page.getByRole("button", { name: "Save" });
    await expect(save).toBeDisabled();

    await nameInput.fill("Tester");
    await save.click();

    await expect(
      page.getByText("Saved as Tester · #1 on the leaderboard"),
    ).toBeVisible({ timeout: 15_000 });
    expect(traffic.hearts).toEqual([]);
  });

  test("a finished game resumed from storage shows the card without sending anything", async ({
    page,
  }) => {
    const traffic = await routeApi(page);
    await openGame(page, GAME_OVER_STATE, "Tester");

    await expect(page.getByTestId("hearts-result")).toBeVisible({
      timeout: 5_000,
    });
    await page.waitForTimeout(1_000);
    expect(traffic.hearts).toEqual([]);
    expect(traffic.completes).toEqual([]);
  });
});
