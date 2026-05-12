/**
 * yacht-persistence.spec.ts
 *
 * GH #183 — LocalStorage persistence.
 *
 * The Yacht engine saves state after every action (roll/score) via AsyncStorage
 * which maps to localStorage in the Expo Web build. Pressing "Play Yacht" on the
 * Home screen resumes any non-game-over saved game.
 */

import { test, expect } from "./fixtures";
import { injectGameState, blankScores } from "./helpers/yacht";

test.describe("Yacht — localStorage persistence (#183)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => localStorage.removeItem("yacht_game_v1"));
    await page.goto("/");
  });

  test("game state is saved after scoring a category", async ({ page }) => {
    await page.getByRole("button", { name: "Play Yacht" }).click();
    await expect(page.getByText("Round 1 / 13")).toBeVisible();

    await page.getByRole("button", { name: /Roll/i }).click();
    await page.getByRole("button", { name: /Chance: potential score/ }).click();
    await expect(page.getByText("Round 2 / 13")).toBeVisible();

    // Verify the key was written to localStorage
    const stored = await page.evaluate(() =>
      localStorage.getItem("yacht_game_v1"),
    );
    expect(stored).not.toBeNull();

    const state = JSON.parse(stored!);
    expect(state.round).toBe(2); // after scoring round 1, engine advances to round 2
    expect(state.scores.chance).not.toBeNull();
  });

  test("navigating away and returning to Yacht resumes the saved game", async ({
    page,
  }) => {
    // Play through one scoring action
    await page.getByRole("button", { name: "Play Yacht" }).click();
    await expect(page.getByText("Round 1 / 13")).toBeVisible();

    await page.getByRole("button", { name: /Roll/i }).click();
    await page.getByRole("button", { name: /Chance: potential score/ }).click();
    await expect(page.getByText("Round 2 / 13")).toBeVisible();

    // Go back to Home via URL (Lobby tab pop-to-root not reliable on web)
    await page.goto("/");
    await expect(page.getByText("BC Arcade").first()).toBeVisible();

    // Return to Yacht — should resume on Round 2
    await page.getByRole("button", { name: "Play Yacht" }).click();
    await expect(page.getByText("Round 2 / 13")).toBeVisible();

    // The scored Chance category should still show as filled
    await expect(
      page.getByRole("button", { name: /Chance: scored/ }),
    ).toBeVisible();
  });

  test("page reload resumes the saved game at the correct round", async ({
    page,
  }) => {
    await page.getByRole("button", { name: "Play Yacht" }).click();
    await expect(page.getByText("Round 1 / 13")).toBeVisible();

    await page.getByRole("button", { name: /Roll/i }).click();
    await page.getByRole("button", { name: /Chance: potential score/ }).click();
    await expect(page.getByText("Round 2 / 13")).toBeVisible();

    // Hard reload (simulates app restart while game is in progress)
    await page.reload();
    await expect(page.getByText("BC Arcade").first()).toBeVisible();

    await page.getByRole("button", { name: "Play Yacht" }).click();
    await expect(page.getByText("Round 2 / 13")).toBeVisible();
  });

  test("completed game is not resumed — Play Yacht starts fresh after game over", async ({
    page,
  }) => {
    // Inject a game-over state into localStorage
    const gameOverState = {
      dice: [0, 0, 0, 0, 0],
      held: [false, false, false, false, false],
      rolls_used: 0,
      round: 14, // engine sets round to 14 after scoring in round 13
      scores: {
        ones: 1,
        twos: 2,
        threes: 3,
        fours: 4,
        fives: 5,
        sixes: 6,
        three_of_a_kind: 0,
        four_of_a_kind: 0,
        full_house: 0,
        small_straight: 0,
        large_straight: 0,
        yacht: 0,
        chance: 10,
      },
      game_over: true,
      upper_subtotal: 21,
      upper_bonus: 0,
      yacht_bonus_count: 0,
      yacht_bonus_total: 0,
      total_score: 31,
    };

    await page.evaluate(
      (s) => localStorage.setItem("yacht_game_v1", JSON.stringify(s)),
      gameOverState,
    );
    await page.goto("/");

    await page.getByRole("button", { name: "Play Yacht" }).click();

    // Should start a fresh game, not resume the game-over state
    await expect(page.getByText("Round 1 / 13")).toBeVisible();
  });

  test("injected mid-game state is resumed correctly", async ({ page }) => {
    // Inject a state at round 5 with some scores filled
    const midGameState = {
      dice: [0, 0, 0, 0, 0],
      held: [false, false, false, false, false],
      rolls_used: 0,
      round: 5,
      scores: {
        ...blankScores(),
        ones: 3,
        twos: 6,
        threes: 9,
        fours: 12,
      },
      game_over: false,
      upper_subtotal: 30,
      upper_bonus: 0,
      yacht_bonus_count: 0,
      yacht_bonus_total: 0,
      total_score: 30,
    };

    await injectGameState(page, midGameState);
    await page.getByRole("button", { name: "Play Yacht" }).click();

    await expect(page.getByText("Round 5 / 13")).toBeVisible();

    // Previously scored categories show their values
    await expect(
      page.getByRole("button", { name: /Ones: scored 3/ }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Twos: scored 6/ }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Threes: scored 9/ }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Fours: scored 12/ }),
    ).toBeVisible();
  });
});
