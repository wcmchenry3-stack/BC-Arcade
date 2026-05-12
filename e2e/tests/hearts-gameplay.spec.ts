/**
 * hearts-gameplay.spec.ts — GH #1142
 *
 * Pass phase interaction and AI auto-play.
 * All backend calls are intercepted — no running backend needed.
 */

import { test, expect } from "./fixtures";
import { mockHeartsApi, gotoHearts, injectHeartsState } from "./helpers/hearts";

// 13-card hands where Player 1 (West) holds 2♣ and leads trick 1 automatically.
//
// Distribution (52 cards, 13 each):
//   Player 0 (You):   Spades A,K,Q,J,10,9,8,7 + Diamonds A,K,Q,J,10
//   Player 1 (West):  Clubs 2,3,4,5,6          + Diamonds 9,8,7,6,5,4,3,2
//   Player 2 (North): Clubs 7,8,9,10,J,Q,K,A   + Spades 2,3,4,5,6
//   Player 3 (East):  Hearts A,K,Q,J,10,9,8,7,6,5,4,3,2
const c = (suit: string, rank: number) => ({ suit, rank });
const AI_LEADS_STATE = {
  _v: 2,
  phase: "playing",
  handNumber: 1,
  passDirection: "left",
  playerHands: [
    [c("spades", 1), c("spades", 13), c("spades", 12), c("spades", 11), c("spades", 10), c("spades", 9), c("spades", 8), c("spades", 7), c("diamonds", 1), c("diamonds", 13), c("diamonds", 12), c("diamonds", 11), c("diamonds", 10)],
    [c("clubs", 2), c("clubs", 3), c("clubs", 4), c("clubs", 5), c("clubs", 6), c("diamonds", 9), c("diamonds", 8), c("diamonds", 7), c("diamonds", 6), c("diamonds", 5), c("diamonds", 4), c("diamonds", 3), c("diamonds", 2)],
    [c("clubs", 7), c("clubs", 8), c("clubs", 9), c("clubs", 10), c("clubs", 11), c("clubs", 12), c("clubs", 13), c("clubs", 1), c("spades", 2), c("spades", 3), c("spades", 4), c("spades", 5), c("spades", 6)],
    [c("hearts", 1), c("hearts", 2), c("hearts", 3), c("hearts", 4), c("hearts", 5), c("hearts", 6), c("hearts", 7), c("hearts", 8), c("hearts", 9), c("hearts", 10), c("hearts", 11), c("hearts", 12), c("hearts", 13)],
  ],
  cumulativeScores: [0, 0, 0, 0],
  handScores: [0, 0, 0, 0],
  scoreHistory: [],
  passSelections: [[], [], [], []],
  passingComplete: true,
  currentTrick: [],
  currentLeaderIndex: 1,
  currentPlayerIndex: 1,
  wonCards: [[], [], [], []],
  heartsBroken: false,
  tricksPlayedInHand: 0,
  isComplete: false,
  winnerIndex: null,
};

test.describe("Hearts — gameplay", () => {
  test("pass phase: 3 cards selected and passed; trick area active", async ({ page }) => {
    await mockHeartsApi(page);
    // gotoHearts navigates to "/" and clears hearts_game before entering the screen.
    await gotoHearts(page);

    // Fresh game starts in "passing" phase (hand 1 = pass left).
    await expect(page.getByLabel("Your hand, 13 cards")).toBeVisible({ timeout: 5_000 });

    // Click the first 3 cards in the player hand.
    const handArea = page.getByLabel("Your hand, 13 cards");
    const cardButtons = handArea.getByRole("button");
    await cardButtons.nth(0).click();
    await cardButtons.nth(2).click();
    await cardButtons.nth(4).click();

    // Confirm button enabled once 3 cards are selected.
    const confirmBtn = page.getByRole("button", {
      name: "Confirm — pass 3 selected cards",
    });
    await expect(confirmBtn).toBeEnabled({ timeout: 3_000 });
    await confirmBtn.click();

    // Phase transitions to "playing" — trick area remains visible.
    await expect(page.getByLabel("Current trick")).toBeVisible({ timeout: 5_000 });
  });

  test("AI plays at least one card automatically after pass phase completes", async ({
    page,
  }) => {
    await mockHeartsApi(page);
    // Inject a state where it is West's turn to lead (West holds 2♣).
    // The AI loop fires immediately, so West plays without player interaction.
    await injectHeartsState(page, AI_LEADS_STATE);
    await page.getByRole("button", { name: "Play Hearts" }).click();
    await page
      .getByRole("heading", { name: "Hearts", exact: true })
      .waitFor({ timeout: 10_000 });

    // Wait for the game state to load and AI loop to fire.
    await expect(page.getByLabel("Your hand, 13 cards")).toBeVisible({ timeout: 5_000 });

    // "Empty slot — West" disappears once West plays a card.
    await expect(page.getByLabel("Empty slot — West")).toHaveCount(0, { timeout: 8_000 });
  });
});
