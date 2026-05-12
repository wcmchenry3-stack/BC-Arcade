/**
 * hearts-shoot-the-moon.spec.ts — GH #1142
 *
 * Shoot-the-moon: inject a near-moon state where the player holds only the
 * Ace of Hearts (the final heart needed), play it, and verify the "Hand
 * Complete" overlay shows the moon-shot message and zero score for the player.
 *
 * State at injection: trick 13, player leads, wonCards[0] = 12 hearts
 * (ranks 2–13) + Queen of Spades. Opponents each hold one club card.
 * After playing A♥ the hand ends: detectMoon fires for player 0,
 * cumulativeScores → [0, 26, 26, 26].
 *
 * All backend calls are intercepted — no running backend needed.
 */

import { test, expect } from "./fixtures";
import { mockHeartsApi, injectHeartsState } from "./helpers/hearts";

const c = (suit: string, rank: number) => ({ suit, rank });

// wonCards[0]: 12 hearts (2–K) + Q♠ — player is one card away from moon.
const HEARTS_2_TO_K = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13].map((r) =>
  c("hearts", r),
);
const QUEEN_OF_SPADES = c("spades", 12);

const NEAR_MOON_STATE = {
  _v: 2,
  phase: "playing",
  handNumber: 1,
  passDirection: "left",
  playerHands: [
    [c("hearts", 1)], // You: only the Ace of Hearts remains
    [c("clubs", 5)],  // West: one club
    [c("clubs", 6)],  // North: one club
    [c("clubs", 7)],  // East: one club
  ],
  cumulativeScores: [0, 0, 0, 0],
  handScores: [25, 0, 0, 0], // 12 hearts (12 pts) + Q♠ (13 pts) accumulated
  scoreHistory: [],
  passSelections: [[], [], [], []],
  passingComplete: true,
  currentTrick: [],
  currentLeaderIndex: 0,
  currentPlayerIndex: 0, // Player's turn to lead
  wonCards: [[...HEARTS_2_TO_K, QUEEN_OF_SPADES], [], [], []],
  heartsBroken: true,
  tricksPlayedInHand: 12,
  isComplete: false,
  winnerIndex: null,
};

test("shoot-the-moon: play final heart, verify moon message and zero score", async ({
  page,
}) => {
  await mockHeartsApi(page);
  await injectHeartsState(page, NEAR_MOON_STATE);

  await page.getByRole("button", { name: "Play Hearts" }).click();
  await page
    .getByRole("heading", { name: "Hearts", exact: true })
    .waitFor({ timeout: 10_000 });

  // Wait for injected state to load (player hand shows 1 card).
  await expect(page.getByLabel(/Your hand, 1 cards?/)).toBeVisible({
    timeout: 5_000,
  });

  // Play the Ace of Hearts. rankLabel(1) = "A", so aria-label = "A of Hearts".
  await page.getByLabel("A of Hearts").click();

  // AI opponents play their clubs (3 × 400 ms delay). After trick 13:
  // detectMoon fires → phase transitions to "dealing" → Hand Complete overlay.
  await expect(page.getByText("Hand Complete")).toBeVisible({ timeout: 10_000 });

  // Moon-shot announcement uses playerLabels[0] = "You".
  await expect(
    page.getByText("You shot the moon! +26 to all others."),
  ).toBeVisible({ timeout: 3_000 });
});
