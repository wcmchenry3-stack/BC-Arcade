/**
 * hearts-difficulty-select.spec.ts — GH #1168
 *
 * Difficulty selector: pre-game picker, the result card's Change Difficulty /
 * Play Again (#2506), and difficulty persistence.
 * No running backend is needed: the routes this spec depends on are
 * intercepted with page.route(), and any other call (such as SyncWorker's
 * game sync) fails, which the app handles like being offline.
 */

import { test, expect } from "./fixtures";
import { gotoHearts, injectHeartsState } from "./helpers/hearts";
import { installEntitlementsMock } from "./helpers/api-mock";

const c = (suit: string, rank: number) => ({ suit: suit, rank: rank });

// A complete game state so we can trigger the game-over result card.
// All scoreHistory entries must be in [0, 26] and each row must sum to 26
// so the state passes loadGame's bounds validation (#1540).
const GAME_OVER_STATE = {
  _v: 3,
  aiDifficulty: "schemer",
  phase: "game_over",
  handNumber: 5,
  passDirection: "none",
  playerHands: [[], [], [], []],
  cumulativeScores: [104, 0, 0, 0],
  handScores: [0, 0, 0, 0],
  scoreHistory: [
    [26, 0, 0, 0],
    [26, 0, 0, 0],
    [26, 0, 0, 0],
    [26, 0, 0, 0],
  ],
  passSelections: [[], [], [], []],
  passingComplete: true,
  currentTrick: [],
  currentLeaderIndex: 0,
  currentPlayerIndex: 0,
  wonCards: [[], [], [], []],
  heartsBroken: true,
  tricksPlayedInHand: 13,
  isComplete: true,
  winnerIndex: 1,
};

test.describe("Hearts — difficulty selector (#1168)", () => {
  test("pre-game picker shows Cautious / Schemer / Daring radio buttons", async ({
    page,
  }) => {
    await installEntitlementsMock(page);
    await page.goto("/");
    await page.evaluate(() => localStorage.removeItem("hearts_game"));
    await page.getByRole("button", { name: "Play Hearts" }).click();
    await page
      .getByRole("heading", { name: "Hearts", exact: true })
      .waitFor({ timeout: 10_000 });

    const group = page.getByRole("radiogroup", { name: "Opponent Style" });
    await expect(group).toBeVisible({ timeout: 5_000 });
    await expect(group.getByRole("radio", { name: "Cautious" })).toBeVisible();
    await expect(group.getByRole("radio", { name: "Schemer" })).toBeVisible();
    await expect(group.getByRole("radio", { name: "Daring" })).toBeVisible();
  });

  test("selecting Cautious and clicking Start Game launches a game", async ({
    page,
  }) => {
    await installEntitlementsMock(page);
    await page.goto("/");
    await page.evaluate(() => localStorage.removeItem("hearts_game"));
    await page.getByRole("button", { name: "Play Hearts" }).click();
    await page
      .getByRole("heading", { name: "Hearts", exact: true })
      .waitFor({ timeout: 10_000 });

    await page.getByRole("radio", { name: "Cautious" }).click();
    await page.getByRole("button", { name: "Start Game" }).click();

    await expect(page.getByLabel("Your hand, 13 cards")).toBeVisible({
      timeout: 8_000,
    });
  });

  test("selecting Daring and clicking Start Game launches a game", async ({
    page,
  }) => {
    await installEntitlementsMock(page);
    await page.goto("/");
    await page.evaluate(() => localStorage.removeItem("hearts_game"));
    await page.getByRole("button", { name: "Play Hearts" }).click();
    await page
      .getByRole("heading", { name: "Hearts", exact: true })
      .waitFor({ timeout: 10_000 });

    await page.getByRole("radio", { name: "Daring" }).click();
    await page.getByRole("button", { name: "Start Game" }).click();

    await expect(page.getByLabel("Your hand, 13 cards")).toBeVisible({
      timeout: 8_000,
    });
  });

  test("Change Difficulty on the result card returns to the difficulty picker", async ({
    page,
  }) => {
    await injectHeartsState(page, GAME_OVER_STATE);
    await page.getByRole("button", { name: "Play Hearts" }).click();
    await page
      .getByRole("heading", { name: "Hearts", exact: true })
      .waitFor({ timeout: 10_000 });

    // The shared result card (#2506) — West has the lowest score.
    const card = page.getByTestId("hearts-result");
    await expect(card).toBeVisible({ timeout: 5_000 });
    await expect(card.getByText("West Wins")).toBeVisible();

    await card.getByRole("button", { name: "Change Difficulty" }).click();
    await expect(
      page.getByRole("radiogroup", { name: "Opponent Style" }),
    ).toBeVisible({
      timeout: 5_000,
    });
    await expect(
      page.getByRole("button", { name: "Start Game" }),
    ).toBeVisible();
  });

  test("Play Again on the result card deals a new game without the picker", async ({
    page,
  }) => {
    await injectHeartsState(page, GAME_OVER_STATE);
    await page.getByRole("button", { name: "Play Hearts" }).click();
    await page
      .getByRole("heading", { name: "Hearts", exact: true })
      .waitFor({ timeout: 10_000 });

    const card = page.getByTestId("hearts-result");
    await expect(card).toBeVisible({ timeout: 5_000 });
    await card.getByRole("button", { name: "Play Again" }).click();

    await expect(page.getByLabel("Your hand, 13 cards")).toBeVisible({
      timeout: 8_000,
    });
    await expect(page.getByRole("button", { name: "Start Game" })).toHaveCount(
      0,
    );
  });

  test("v2 saved game (no aiDifficulty) loads without showing the picker", async ({
    page,
  }) => {
    // Inject a v2 state — migration should convert it to v3 silently
    const v2State = {
      _v: 2,
      phase: "playing",
      handNumber: 1,
      passDirection: "left",
      playerHands: [
        [
          c("spades", 1),
          c("spades", 13),
          c("clubs", 7),
          c("clubs", 8),
          c("clubs", 9),
          c("diamonds", 5),
          c("diamonds", 9),
          c("clubs", 10),
          c("diamonds", 3),
          c("hearts", 5),
          c("hearts", 6),
          c("hearts", 7),
          c("hearts", 8),
        ],
        Array.from({ length: 13 }, (_, i) => c("spades", i + 1)),
        Array.from({ length: 13 }, (_, i) => c("diamonds", i + 1)),
        Array.from({ length: 13 }, (_, i) => c("hearts", i + 1)),
      ],
      cumulativeScores: [0, 0, 0, 0],
      handScores: [0, 0, 0, 0],
      scoreHistory: [],
      passSelections: [[], [], [], []],
      passingComplete: true,
      currentTrick: [],
      currentLeaderIndex: 0,
      currentPlayerIndex: 0,
      wonCards: [[], [], [], []],
      heartsBroken: false,
      tricksPlayedInHand: 0,
      isComplete: false,
      winnerIndex: null,
    };
    await injectHeartsState(page, v2State);
    await page.getByRole("button", { name: "Play Hearts" }).click();
    await page
      .getByRole("heading", { name: "Hearts", exact: true })
      .waitFor({ timeout: 10_000 });

    // No pre-game picker — game loaded from storage
    await expect(page.getByRole("button", { name: "Start Game" })).toHaveCount(
      0,
    );
    await expect(page.getByLabel("Your hand, 13 cards")).toBeVisible({
      timeout: 5_000,
    });
  });
});
