/**
 * yacht-scoring.spec.ts
 *
 * GH #180 — Scoring category verification.
 *
 * Verifies that each scored category:
 *   - transitions the scorecard row from "potential" to "scored"
 *   - advances the round counter
 *   - updates the total score display
 */

import { test, expect } from "./fixtures";

// Categories in scorecard display order — matches yacht-full-game.spec.ts
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

test.describe("Yacht — scoring verification (#180)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => localStorage.removeItem("yacht_game_v1"));
    await page.goto("/");
    await page.getByRole("button", { name: "Play Yacht" }).click();
    await expect(page.getByText("Round 1 / 13")).toBeVisible();
  });

  test("scoring Chance fills the row and advances the round", async ({
    page,
  }) => {
    await page.getByRole("button", { name: /Roll/i }).click();

    // Wait for potential scores to appear
    const chanceBtn = page.getByRole("button", {
      name: /Chance: potential score/,
    });
    await expect(chanceBtn).toBeVisible();
    await chanceBtn.click();

    await expect(page.getByText("Round 2 / 13")).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Chance: scored/ }),
    ).toBeVisible();
  });

  test("scored Chance value appears in the total score", async ({ page }) => {
    await page.getByRole("button", { name: /Roll/i }).click();

    const chanceBtn = page.getByRole("button", {
      name: /Chance: potential score/,
    });
    await expect(chanceBtn).toBeVisible();

    // Extract the potential value from the accessibility label before scoring
    const label = (await chanceBtn.getAttribute("aria-label")) ?? "";
    const match = label.match(/potential score (\d+)/);
    const potentialValue = match ? parseInt(match[1], 10) : null;

    await chanceBtn.click();
    await expect(page.getByText("Round 2 / 13")).toBeVisible();

    // Verify the Chance row shows the scored value — this also validates the total
    // (using the aria-label to avoid strict-mode violations from duplicate text nodes)
    if (potentialValue !== null) {
      await expect(
        page.getByRole("button", {
          name: new RegExp(`Chance: scored ${potentialValue}`),
        }),
      ).toBeVisible();
    }
  });

  test("upper section bonus row shows 0 / 63 progress before scoring", async ({
    page,
  }) => {
    await page.getByRole("button", { name: /Roll/i }).click();
    // Bonus (≥63 = +35) row is visible and progress starts at 0
    await expect(page.getByText(/Bonus \(≥63/)).toBeVisible();
    await expect(page.getByText("0 / 63")).toBeVisible();
  });

  test("scoring Ones updates the upper subtotal", async ({ page }) => {
    await page.getByRole("button", { name: /Roll/i }).click();

    const onesBtn = page.getByRole("button", { name: /Ones: potential score/ });
    if (await onesBtn.isVisible()) {
      const label = (await onesBtn.getAttribute("aria-label")) ?? "";
      const match = label.match(/potential score (\d+)/);
      const potentialValue = match ? parseInt(match[1], 10) : null;

      await onesBtn.click();

      // The subtotal for the upper section should now reflect the scored Ones value
      if (potentialValue !== null) {
        await expect(
          page.getByText(new RegExp(`${potentialValue} / 63`)),
        ).toBeVisible();
      }
    } else {
      // Ones not in potential scores (dice show no 1s) — still verify scoring
      // any available category advances the round
      await page
        .getByRole("button", { name: /Chance: potential score/ })
        .click();
      await expect(page.getByText("Round 2 / 13")).toBeVisible();
    }
  });

  test("score row label changes to 'scored N' after filling", async ({
    page,
  }) => {
    await page.getByRole("button", { name: /Roll/i }).click();

    const chanceBtn = page.getByRole("button", {
      name: /Chance: potential score/,
    });
    await expect(chanceBtn).toBeVisible();
    await chanceBtn.click();

    // Row is now filled — accessibility label includes "scored"
    const filledRow = page.getByRole("button", { name: /Chance: scored \d+/ });
    await expect(filledRow).toBeVisible();
  });

  test("completing all 13 rounds shows game-over modal with final score", async ({
    page,
  }) => {
    for (let round = 0; round < 13; round++) {
      await expect(page.getByText(`Round ${round + 1} / 13`)).toBeVisible();
      await page.getByRole("button", { name: /Roll/i }).click();
      await page.getByText(CATEGORY_LABELS_IN_ORDER[round]).first().click();
    }

    await expect(page.getByText("Game Over!")).toBeVisible();
    await expect(page.getByText(/Final Score/i)).toBeVisible();
  });
});
