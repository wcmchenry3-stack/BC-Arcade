/**
 * hearts-leaderboard.spec.ts — GH #1142
 *
 * Leaderboard integration: inject a game-over state, intercept
 * POST /hearts/score, enter a name, submit, and verify the confirmation.
 *
 * Score submitted = Math.max(0, 100 − cumulativeScores[0]).
 * With cumulativeScores[0] = 45: score = 55.
 *
 * All backend calls are intercepted — no running backend needed.
 */

import { test, expect } from "./fixtures";
import { mockHeartsApi, injectHeartsState } from "./helpers/hearts";

// Player 0 wins with 45 points (lowest). Player 1 triggers game-over at 102.
const GAME_OVER_STATE = {
  _v: 2,
  phase: "game_over",
  handNumber: 5,
  passDirection: "none",
  playerHands: [[], [], [], []],
  cumulativeScores: [45, 102, 78, 65],
  handScores: [0, 0, 0, 0],
  scoreHistory: [
    [9, 26, 16, 10],
    [10, 23, 14, 14],
    [12, 27, 18, 17],
    [14, 26, 30, 24],
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

test.describe("Hearts — leaderboard", () => {
  // injectHeartsState navigates to "/" before setting state, so localStorage
  // is always written into a live document (no about:blank security error).
  // hearts_stats_v1 does not exist in the current codebase but clearing it
  // is harmless and satisfies the acceptance criteria for isolation.

  test("POST /hearts/score intercepted and confirmation shown after submit", async ({
    page,
  }) => {
    let capturedBody: Record<string, unknown> | null = null;

    // Override the catch-all mock to capture the POST payload.
    // Use **/hearts/** glob so the route matches regardless of the base URL
    // baked into the bundle (EXPO_PUBLIC_API_URL at export time).
    await page.route("**/hearts/**", async (route) => {
      if (route.request().method() === "POST") {
        capturedBody = JSON.parse(route.request().postData() ?? "{}");
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ player_name: "Tester", score: 55, rank: 1 }),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ scores: [] }),
        });
      }
    });

    await injectHeartsState(page, GAME_OVER_STATE);
    await page.getByRole("button", { name: "Play Hearts" }).click();
    await page
      .getByRole("heading", { name: "Hearts", exact: true })
      .waitFor({ timeout: 10_000 });

    // Game-over overlay appears once the injected state loads.
    await expect(page.getByText("Game Over")).toBeVisible({ timeout: 5_000 });

    await page.getByLabel("Enter your name").fill("Tester");

    const submitBtn = page.getByRole("button", { name: "Submit Score" });
    await expect(submitBtn).toBeEnabled({ timeout: 2_000 });
    await submitBtn.click();

    await expect(page.getByText("Score submitted!")).toBeVisible({
      timeout: 5_000,
    });

    expect(capturedBody).not.toBeNull();
    expect(capturedBody!["player_name"]).toBe("Tester");
    expect(capturedBody!["score"]).toBe(55);
  });

  test("Submit Score button is disabled when name field is empty", async ({
    page,
  }) => {
    await mockHeartsApi(page);
    await injectHeartsState(page, GAME_OVER_STATE);
    await page.getByRole("button", { name: "Play Hearts" }).click();
    await page
      .getByRole("heading", { name: "Hearts", exact: true })
      .waitFor({ timeout: 10_000 });

    await expect(page.getByText("Game Over")).toBeVisible({ timeout: 5_000 });

    // Name field is empty by default → button disabled.
    await expect(
      page.getByRole("button", { name: "Submit Score" }),
    ).toBeDisabled({ timeout: 2_000 });
  });
});
