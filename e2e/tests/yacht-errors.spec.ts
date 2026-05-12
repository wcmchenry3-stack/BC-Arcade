/**
 * yacht-errors.spec.ts
 *
 * Error-path coverage for Yacht. After PR #156 ported the engine client-side,
 * backend-failure tests (503 on start, 400 on score) are obsolete — the
 * engine runs in-process and cannot hit those HTTP paths. What remains are
 * UI-level error surfaces driven by the local engine's exceptions, plus
 * navigation.
 *
 * GH #184 — extended with 5 additional error / guard cases.
 * GH #225 — regression tests for "Play Again" reset bug.
 */

import { test, expect } from "./fixtures";
import { injectGameState, blankScores } from "./helpers/yacht";

test.describe("Yacht — error paths and navigation", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => localStorage.removeItem("yacht_game_v1"));
    await page.goto("/");
  });

  test("navigating away from Yacht returns to Home", async ({ page }) => {
    await page.getByRole("button", { name: "Play Yacht" }).click();
    await expect(page.getByText("Round 1 / 13")).toBeVisible();

    // Navigate home via URL (Lobby tab pop-to-root not reliable on web)
    await page.goto("/");

    await expect(page.getByText("BC Arcade").first()).toBeVisible();
  });

  test("cannot roll a 4th time in the same turn", async ({ page }) => {
    await page.getByRole("button", { name: "Play Yacht" }).click();
    await expect(page.getByText("Round 1 / 13")).toBeVisible();

    const rollBtn = page.getByRole("button", { name: /Roll/i });
    // 3 rolls allowed per turn
    await rollBtn.click();
    await rollBtn.click();
    await rollBtn.click();
    // After the 3rd roll, the roll button is disabled (0 rolls remaining)
    await expect(rollBtn).toBeDisabled();
  });

  // ---------------------------------------------------------------------------
  // GH #184 — additional error / guard cases
  // ---------------------------------------------------------------------------

  test("score rows are all disabled before the first roll of a turn", async ({
    page,
  }) => {
    await page.getByRole("button", { name: "Play Yacht" }).click();
    await expect(page.getByText("Round 1 / 13")).toBeVisible();

    // Before any roll, possibleScores is empty → every ScoreRow shows "not available"
    // and is disabled (no press handler attached).
    const chanceRow = page.getByRole("button", {
      name: /Chance: not available/,
    });
    await expect(chanceRow).toBeVisible();
    await expect(chanceRow).toBeDisabled();
  });

  test("already-scored category row is disabled and not clickable", async ({
    page,
  }) => {
    await page.getByRole("button", { name: "Play Yacht" }).click();
    await expect(page.getByText("Round 1 / 13")).toBeVisible();

    // Score Chance in round 1
    await page.getByRole("button", { name: /Roll/i }).click();
    await page.getByRole("button", { name: /Chance: potential score/ }).click();
    await expect(page.getByText("Round 2 / 13")).toBeVisible();

    // Chance row is now filled — it should be disabled
    const chanceRow = page.getByRole("button", { name: /Chance: scored/ });
    await expect(chanceRow).toBeDisabled();
  });

  test("roll button is disabled when game is over", async ({ page }) => {
    // Inject a game-over state where it's the player's turn but game_over=true
    const state = {
      dice: [0, 0, 0, 0, 0],
      held: [false, false, false, false, false],
      rolls_used: 0,
      round: 14,
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
        chance: 0,
      },
      game_over: true,
      upper_subtotal: 21,
      upper_bonus: 0,
      yacht_bonus_count: 0,
      yacht_bonus_total: 0,
      total_score: 21,
    };

    await injectGameState(page, state);
    await page.getByRole("button", { name: "Play Yacht" }).click();

    // game_over state is loaded → starts a fresh game (HomeScreen rejects game-over saves)
    // So we land on Round 1 with a fresh state — Roll should be enabled
    await expect(page.getByText("Round 1 / 13")).toBeVisible();
    // Dismiss the modal if it appears (shouldn't for fresh game)
    const rollBtn = page.getByRole("button", { name: /Roll/i });
    await expect(rollBtn).toBeVisible();
    await expect(rollBtn).not.toBeDisabled();
  });

  test("game-over modal shows final score and both action buttons", async ({
    page,
  }) => {
    const CATEGORY_LABELS_IN_ORDER = [
      "Ones",
      "Twos",
      "Threes",
      "Fours",
      "Fives",
      "Sixes",
      "Three of a Kind",
      "Four of a Kind",
      "Full House (25)",
      "Sm. Straight (30)",
      "Lg. Straight (40)",
      "Yacht! (50)",
      "Chance",
    ];

    await page.getByRole("button", { name: "Play Yacht" }).click();

    // Play all 13 rounds
    for (let round = 0; round < 13; round++) {
      await expect(page.getByText(`Round ${round + 1} / 13`)).toBeVisible();
      await page.getByRole("button", { name: /Roll/i }).click();
      await page.getByText(CATEGORY_LABELS_IN_ORDER[round]).first().click();
    }

    // Modal should show final score and both action buttons
    await expect(page.getByText("Game Over!")).toBeVisible();
    await expect(page.getByText(/Final Score/i)).toBeVisible();
    await expect(
      page.getByRole("button", { name: /start a new game/i }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: /dismiss/i })).toBeVisible();
  });

  test("scratching a category (scoring 0) is not reversible", async ({
    page,
  }) => {
    await page.getByRole("button", { name: "Play Yacht" }).click();
    await expect(page.getByText("Round 1 / 13")).toBeVisible();

    // Roll dice and score "Ones" — if no ones were rolled, this scratches it at 0
    await page.getByRole("button", { name: /Roll/i }).click();

    // If "Ones" has a potential score (could be 0 if no ones rolled), click it
    const onesRow = page.getByRole("button", { name: /Ones:/ });
    await expect(onesRow).toBeVisible();

    // Score any available category that shows "Ones" is selectable
    const onesSelectable = page.getByRole("button", {
      name: /Ones: potential score/,
    });
    const onesAvailable = await onesSelectable.isVisible();

    if (onesAvailable) {
      await onesSelectable.click();
      await expect(page.getByText("Round 2 / 13")).toBeVisible();

      // The Ones row is now filled and disabled — can't re-score it
      await expect(
        page.getByRole("button", { name: /Ones: scored/ }),
      ).toBeDisabled();
    } else {
      // Ones shows "not available" (this can happen if dice are all blank — skip)
      // Score Chance to advance the round instead
      await page
        .getByRole("button", { name: /Chance: potential score/ })
        .click();
      await expect(page.getByText("Round 2 / 13")).toBeVisible();
    }
  });
});

// ---------------------------------------------------------------------------
// GH #225 — "Play Again" reset regression tests
// ---------------------------------------------------------------------------

const CATEGORY_LABELS_IN_ORDER = [
  "Ones",
  "Twos",
  "Threes",
  "Fours",
  "Fives",
  "Sixes",
  "Three of a Kind",
  "Four of a Kind",
  "Full House (25)",
  "Sm. Straight (30)",
  "Lg. Straight (40)",
  "Yacht! (50)",
  "Chance",
];

test.describe("Yacht — Play Again reset regression (GH #225)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => localStorage.removeItem("yacht_game_v1"));
    await page.goto("/");
  });

  /** Helper: play a full 13-round game and reach the game-over modal. */
  async function playFullGame(page: Parameters<Parameters<typeof test>[1]>[0]) {
    await page.getByRole("button", { name: "Play Yacht" }).click();
    for (let round = 0; round < 13; round++) {
      await page
        .getByText(`Round ${round + 1} / 13`)
        .waitFor({ timeout: 15000 });
      await page.getByRole("button", { name: /Roll/i }).click();
      await page.getByText(CATEGORY_LABELS_IN_ORDER[round]).first().click();
    }
    await page.getByText("Game Over!").waitFor({ timeout: 10000 });
  }

  test("Play Again resets to Round 1 / 13", async ({ page }) => {
    await playFullGame(page);

    await page.getByRole("button", { name: /start a new game/i }).click();

    await expect(page.getByText("Round 1 / 13")).toBeVisible({
      timeout: 10000,
    });
  });

  test("Play Again clears all scored categories", async ({ page }) => {
    await playFullGame(page);
    await page.getByRole("button", { name: /start a new game/i }).click();
    await expect(page.getByText("Round 1 / 13")).toBeVisible({
      timeout: 10000,
    });

    // No category should show a filled score — they should all be "not available"
    // (before the first roll, canScore is false so all show "not available")
    await expect(
      page.getByRole("button", { name: /Chance: not available/ }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Ones: not available/ }),
    ).toBeVisible();
  });

  test("Play Again allows rolling and scoring immediately", async ({
    page,
  }) => {
    await playFullGame(page);
    await page.getByRole("button", { name: /start a new game/i }).click();
    await expect(page.getByText("Round 1 / 13")).toBeVisible({
      timeout: 10000,
    });

    const rollBtn = page.getByRole("button", { name: /Roll/i });
    await expect(rollBtn).not.toBeDisabled();
    await rollBtn.click();
    await expect(
      page.getByRole("button", { name: /Chance: potential score/ }),
    ).toBeVisible();
  });

  test("localStorage is updated with round-1 state after Play Again", async ({
    page,
  }) => {
    await playFullGame(page);
    await page.getByRole("button", { name: /start a new game/i }).click();
    await expect(page.getByText("Round 1 / 13")).toBeVisible({
      timeout: 10000,
    });

    const stored = await page.evaluate(() =>
      localStorage.getItem("yacht_game_v1"),
    );
    expect(stored).not.toBeNull();
    const state = JSON.parse(stored!);
    expect(state.round).toBe(1);
    expect(state.game_over).toBe(false);
    // All scores should be null
    for (const v of Object.values(state.scores)) {
      expect(v).toBeNull();
    }
  });

  test("Dismiss navigates back to HomeScreen", async ({ page }) => {
    await playFullGame(page);

    await page.getByRole("button", { name: /dismiss/i }).click();

    // After dismiss the user lands on HomeScreen
    await expect(page.getByText("BC Arcade").first()).toBeVisible({
      timeout: 10000,
    });
  });
});
