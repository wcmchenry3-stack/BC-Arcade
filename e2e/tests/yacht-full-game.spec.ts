/**
 * yacht-full-game.spec.ts
 *
 * E2E user journey: play a complete 13-round Yacht game.
 *
 * The Yacht engine runs entirely client-side (since PR #156), so these
 * tests drive the real engine with real Math.random() dice. Assertions
 * focus on UI state transitions, not specific dice values.
 *
 * Journey:
 *   Home → click "Play Yacht" → 13× (roll + score) → Game Over modal → Play Again
 */

import { test, expect } from "./fixtures";

// Categories scored in order, matched to the scorecard display text.
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

test.describe("Yacht — full 13-round game journey", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    // Clear any saved game from a previous test so each test starts fresh.
    await page.evaluate(() => localStorage.removeItem("yacht_game_v1"));
    await page.goto("/");
  });

  test("navigates from Home to Game on Play Yacht click", async ({ page }) => {
    await expect(page.getByText("BC Arcade").first()).toBeVisible();
    await page.getByRole("button", { name: "Play Yacht" }).click();
    await expect(page.getByText("Round 1 / 13")).toBeVisible();
  });

  test("Roll button appears and responds", async ({ page }) => {
    await page.getByRole("button", { name: "Play Yacht" }).click();
    await expect(page.getByText("Round 1 / 13")).toBeVisible();

    const rollBtn = page.getByRole("button", { name: /Roll/i });
    await expect(rollBtn).toBeVisible();
    await rollBtn.click();

    // After rolling, a die button with an accessible "Die N: showing X" label appears
    await expect(
      page.getByRole("button", { name: /Die 1: showing \d/ }),
    ).toBeVisible();
  });

  test("scoring a category advances the round", async ({ page }) => {
    await page.getByRole("button", { name: "Play Yacht" }).click();
    await expect(page.getByText("Round 1 / 13")).toBeVisible();

    await page.getByRole("button", { name: /Roll/i }).click();
    await page.getByText("Ones").first().click();

    await expect(page.getByText("Round 2 / 13")).toBeVisible();
  });

  test("game-over modal appears after 13 rounds", async ({ page }) => {
    await page.getByRole("button", { name: "Play Yacht" }).click();

    for (let round = 0; round < 13; round++) {
      await expect(page.getByText(`Round ${round + 1} / 13`)).toBeVisible();
      await page.getByRole("button", { name: /Roll/i }).click();
      await page.getByText(CATEGORY_LABELS_IN_ORDER[round]).first().click();
    }

    await expect(page.getByText("Game Over!")).toBeVisible();
    await expect(page.getByText(/Final Score/i)).toBeVisible();
  });

  test("Play Again from game-over modal starts a new game in place", async ({
    page,
  }) => {
    await page.getByRole("button", { name: "Play Yacht" }).click();

    for (let round = 0; round < 13; round++) {
      await page.getByRole("button", { name: /Roll/i }).click();
      await page.getByText(CATEGORY_LABELS_IN_ORDER[round]).first().click();
    }

    await expect(page.getByText("Game Over!")).toBeVisible();
    await page.getByRole("button", { name: /start a new game/i }).click();

    await expect(page.getByText(/Round 1/i)).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole("button", { name: /Roll/i })).toBeVisible();
  });

  test("Play Again clears all scorecard scores — upper and lower sections (GH #263)", async ({
    page,
  }) => {
    await page.getByRole("button", { name: "Play Yacht" }).click();

    for (let round = 0; round < 13; round++) {
      await page.getByRole("button", { name: /Roll/i }).click();
      await page.getByText(CATEGORY_LABELS_IN_ORDER[round]).first().click();
    }

    await expect(page.getByText("Game Over!")).toBeVisible();
    await page.getByRole("button", { name: /start a new game/i }).click();
    await expect(page.getByText(/Round 1/i)).toBeVisible({ timeout: 10000 });

    // All 13 category rows must show "not available" — no score should persist
    // from the previous game (rollsUsed=0 at game start, canScore=false)
    const ALL_CATEGORY_LABELS = [
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
    for (const cat of ALL_CATEGORY_LABELS) {
      await expect(
        page.getByRole("button", { name: `${cat}: not available` }),
      ).toBeVisible();
    }

    // Upper bonus should also reset: no "✓" (achieved), progress shows 0 / 63
    await expect(page.getByText(/✓/)).not.toBeVisible();
    await expect(page.getByText("0 / 63")).toBeVisible();
  });

  test("No Thanks navigates back to HomeScreen", async ({ page }) => {
    await page.getByRole("button", { name: "Play Yacht" }).click();

    for (let round = 0; round < 13; round++) {
      await page.getByRole("button", { name: /Roll/i }).click();
      await page.getByText(CATEGORY_LABELS_IN_ORDER[round]).first().click();
    }

    await expect(page.getByText("Game Over!")).toBeVisible();
    await page.getByRole("button", { name: /dismiss/i }).click();

    // Dismiss now navigates back to HomeScreen rather than hiding the modal in-place.
    await expect(page.getByText("BC Arcade").first()).toBeVisible({
      timeout: 10000,
    });
  });
});
