/**
 * hearts-persistence.spec.ts — GH #1142
 *
 * State persistence: inject a mid-game state (trick 4 done, player has 9
 * cards), navigate to Hearts, verify the hand count, navigate away, and
 * confirm the same hand count after returning.
 *
 * HeartsScreen saves via useFocusEffect(blur) when the screen loses focus.
 * The test relies on that save being committed before `page.goto("/")` fully
 * resolves — which is the same pattern used in the 2048 persistence suite.
 *
 * All backend calls are intercepted — no running backend needed.
 */

import { test, expect } from "./fixtures";
import { mockHeartsApi, injectHeartsState } from "./helpers/hearts";

const c = (suit: string, rank: number) => ({ suit, rank });

// 4 tricks played; each player holds 9 cards (ranks 3–11 per suit).
// currentPlayerIndex=0 so the AI loop does not fire during the test.
const MID_GAME_STATE = {
  _v: 2,
  phase: "playing",
  handNumber: 1,
  passDirection: "left",
  playerHands: [
    [3, 4, 5, 6, 7, 8, 9, 10, 11].map((r) => c("clubs", r)),
    [3, 4, 5, 6, 7, 8, 9, 10, 11].map((r) => c("spades", r)),
    [3, 4, 5, 6, 7, 8, 9, 10, 11].map((r) => c("diamonds", r)),
    [3, 4, 5, 6, 7, 8, 9, 10, 11].map((r) => c("hearts", r)),
  ],
  cumulativeScores: [0, 0, 0, 0],
  handScores: [0, 0, 0, 0],
  scoreHistory: [],
  passSelections: [[], [], [], []],
  passingComplete: true,
  currentTrick: [],
  currentLeaderIndex: 0,
  currentPlayerIndex: 0,
  wonCards: [
    [
      c("clubs", 1), c("clubs", 2), c("clubs", 12), c("clubs", 13),
      c("spades", 1), c("spades", 2), c("spades", 12), c("spades", 13),
      c("diamonds", 1), c("diamonds", 2), c("diamonds", 12), c("diamonds", 13),
      c("hearts", 1), c("hearts", 2), c("hearts", 12), c("hearts", 13),
    ],
    [], [], [],
  ],
  heartsBroken: true,
  tricksPlayedInHand: 4,
  isComplete: false,
  winnerIndex: null,
};

test("mid-game state persists across navigation away and back", async ({
  page,
}) => {
  await mockHeartsApi(page);
  await injectHeartsState(page, MID_GAME_STATE);

  await page.getByRole("button", { name: "Play Hearts" }).click();
  await page
    .getByRole("heading", { name: "Hearts", exact: true })
    .waitFor({ timeout: 10_000 });

  // Wait for injected state to load: player should have 9 cards.
  await expect(page.getByLabel("Your hand, 9 cards")).toBeVisible({
    timeout: 5_000,
  });

  // Navigate away — useFocusEffect(blur) fires and saves gameState.
  await page.goto("/");
  await page.getByText("BC Arcade").first().waitFor();

  // Return to Hearts.
  await page.getByRole("button", { name: "Play Hearts" }).click();
  await page
    .getByRole("heading", { name: "Hearts", exact: true })
    .waitFor({ timeout: 10_000 });

  // State should be restored: player still has 9 cards.
  await expect(page.getByLabel("Your hand, 9 cards")).toBeVisible({
    timeout: 5_000,
  });
});
