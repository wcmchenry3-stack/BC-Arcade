/**
 * hearts-difficulty-select.spec.ts — GH #1168
 *
 * Difficulty selector: pre-game picker, Play Again picker, and difficulty persistence.
 * All backend calls are intercepted — no running backend needed.
 */

import { test, expect } from "./fixtures";
import { mockHeartsApi, gotoHearts, injectHeartsState } from "./helpers/hearts";
import { installEntitlementsMock } from "./helpers/api-mock";

const c = (suit: string, rank: number) => ({ suit: suit, rank: rank });

// A complete game state so we can trigger the game_over overlay
const GAME_OVER_STATE = {
  _v: 3,
  aiDifficulty: "medium",
  phase: "game_over",
  handNumber: 5,
  passDirection: "none",
  playerHands: [[], [], [], []],
  cumulativeScores: [105, 30, 25, 22],
  handScores: [0, 0, 0, 0],
  scoreHistory: [
    [26, 0, 0, 0],
    [26, 0, 0, 0],
    [26, 0, 0, 0],
    [27, 30, 25, 22],
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
  winnerIndex: 3,
};

test.describe("Hearts — difficulty selector (#1168)", () => {
  test("pre-game picker shows Easy / Medium / Hard radio buttons", async ({ page }) => {
    await mockHeartsApi(page);
    await installEntitlementsMock(page);
    await page.goto("/");
    await page.evaluate(() => localStorage.removeItem("hearts_game"));
    await page.getByRole("button", { name: "Play Hearts" }).click();
    await page.getByRole("heading", { name: "Hearts", exact: true }).waitFor({ timeout: 10_000 });

    const group = page.getByRole("radiogroup", { name: "AI Difficulty" });
    await expect(group).toBeVisible({ timeout: 5_000 });
    await expect(group.getByRole("radio", { name: "Easy" })).toBeVisible();
    await expect(group.getByRole("radio", { name: "Medium" })).toBeVisible();
    await expect(group.getByRole("radio", { name: "Hard" })).toBeVisible();
  });

  test("selecting Easy and clicking Start Game launches a game", async ({ page }) => {
    await mockHeartsApi(page);
    await installEntitlementsMock(page);
    await page.goto("/");
    await page.evaluate(() => localStorage.removeItem("hearts_game"));
    await page.getByRole("button", { name: "Play Hearts" }).click();
    await page.getByRole("heading", { name: "Hearts", exact: true }).waitFor({ timeout: 10_000 });

    await page.getByRole("radio", { name: "Easy" }).click();
    await page.getByRole("button", { name: "Start Game" }).click();

    await expect(page.getByLabel("Your hand, 13 cards")).toBeVisible({ timeout: 8_000 });
  });

  test("selecting Hard and clicking Start Game launches a game", async ({ page }) => {
    await mockHeartsApi(page);
    await installEntitlementsMock(page);
    await page.goto("/");
    await page.evaluate(() => localStorage.removeItem("hearts_game"));
    await page.getByRole("button", { name: "Play Hearts" }).click();
    await page.getByRole("heading", { name: "Hearts", exact: true }).waitFor({ timeout: 10_000 });

    await page.getByRole("radio", { name: "Hard" }).click();
    await page.getByRole("button", { name: "Start Game" }).click();

    await expect(page.getByLabel("Your hand, 13 cards")).toBeVisible({ timeout: 8_000 });
  });

  test("Play Again on game over returns to difficulty picker", async ({ page }) => {
    await mockHeartsApi(page);
    await injectHeartsState(page, GAME_OVER_STATE);
    await page.getByRole("button", { name: "Play Hearts" }).click();
    await page.getByRole("heading", { name: "Hearts", exact: true }).waitFor({ timeout: 10_000 });

    // Game over overlay should show
    await expect(page.getByText("Game Over")).toBeVisible({ timeout: 5_000 });

    // Difficulty selector appears in game_over panel
    await expect(page.getByRole("radiogroup", { name: "AI Difficulty" })).toBeVisible({
      timeout: 3_000,
    });

    // Click Play Again — goes back to pre-game picker
    await page.getByRole("button", { name: "Play Again" }).click();
    await expect(page.getByRole("radiogroup", { name: "AI Difficulty" })).toBeVisible({
      timeout: 5_000,
    });
    await expect(page.getByRole("button", { name: "Start Game" })).toBeVisible();
  });

  test("difficulty selector in game_over panel shows Easy / Medium / Hard", async ({ page }) => {
    await mockHeartsApi(page);
    await injectHeartsState(page, GAME_OVER_STATE);
    await page.getByRole("button", { name: "Play Hearts" }).click();
    await page.getByRole("heading", { name: "Hearts", exact: true }).waitFor({ timeout: 10_000 });

    await expect(page.getByText("Game Over")).toBeVisible({ timeout: 5_000 });

    const groups = page.getByRole("radiogroup", { name: "AI Difficulty" });
    await expect(groups.first()).toBeVisible({ timeout: 3_000 });
    await expect(groups.first().getByRole("radio", { name: "Easy" })).toBeVisible();
    await expect(groups.first().getByRole("radio", { name: "Medium" })).toBeVisible();
    await expect(groups.first().getByRole("radio", { name: "Hard" })).toBeVisible();
  });

  test("v2 saved game (no aiDifficulty) loads without showing the picker", async ({ page }) => {
    await mockHeartsApi(page);
    // Inject a v2 state — migration should convert it to v3 silently
    const v2State = {
      _v: 2,
      phase: "playing",
      handNumber: 1,
      passDirection: "left",
      playerHands: [
        [c("spades", 1), c("spades", 13), c("clubs", 7), c("clubs", 8), c("clubs", 9),
         c("diamonds", 5), c("diamonds", 9), c("clubs", 10), c("diamonds", 3),
         c("hearts", 5), c("hearts", 6), c("hearts", 7), c("hearts", 8)],
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
    await page.getByRole("heading", { name: "Hearts", exact: true }).waitFor({ timeout: 10_000 });

    // No pre-game picker — game loaded from storage
    await expect(page.getByRole("button", { name: "Start Game" })).toHaveCount(0);
    await expect(page.getByLabel("Your hand, 13 cards")).toBeVisible({ timeout: 5_000 });
  });
});
