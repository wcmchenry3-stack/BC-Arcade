/**
 * yacht-zero-confirm.spec.ts
 *
 * #4092 — a zero takes two taps. The first tap on an open row that would score 0 arms it (amber
 * row, "Tap again to score 0"), the second scores it. A row with points scores in one tap.
 *
 * The dice are injected (the same way yacht-joker-rule.spec.ts does) so Ones, Full House and the
 * straights are zeros and Sixes is not, whatever the RNG would roll.
 */

import { test, expect } from "./fixtures";
import {
  injectGameState,
  blankScores,
  InjectedGameState,
} from "./helpers/yacht";

function midTurn(): InjectedGameState {
  return {
    dice: [6, 6, 6, 2, 3], // Ones 0, Sixes 18, Full House 0
    held: [false, false, false, false, false],
    rolls_used: 1,
    round: 1,
    scores: blankScores(),
    game_over: false,
    upper_subtotal: 0,
    upper_bonus: 0,
    yacht_bonus_count: 0,
    yacht_bonus_total: 0,
    total_score: 0,
  };
}

test.describe("Yacht — zero confirm (#4092)", () => {
  test.beforeEach(async ({ page }) => {
    await injectGameState(page, midTurn());
    await page.getByRole("button", { name: "Play Yacht" }).click();
    await expect(page.getByText("Round 1 / 13")).toBeVisible();
  });

  test("a zero takes two taps: the first arms the row, the second scores it", async ({
    page,
  }) => {
    await page
      .getByRole("button", { name: /Ones: open, would score 0/ })
      .click();

    // Armed, nothing committed.
    await expect(page.getByTestId("yacht-row-ones-armed")).toBeVisible();
    await expect(page.getByText("Tap again to score 0")).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: /Ones: would score 0. Tap again to score 0/,
      }),
    ).toBeVisible();
    await expect(page.getByText("Round 1 / 13")).toBeVisible();

    // The second tap commits the 0.
    await page.getByTestId("score-row-ones").click();
    await expect(page.getByText("Round 2 / 13")).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Ones: scored, 0/ }),
    ).toBeVisible();
    await expect(page.getByTestId("yacht-row-ones-armed")).toHaveCount(0);
  });

  test("a row with points scores in one tap", async ({ page }) => {
    await page
      .getByRole("button", { name: /Sixes: open, would score 18/ })
      .click();
    await expect(page.getByText("Round 2 / 13")).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Sixes: scored, 18/ }),
    ).toBeVisible();
  });

  test("tapping another row disarms: the armed zero is not scored", async ({
    page,
  }) => {
    await page.getByTestId("score-row-ones").click();
    await expect(page.getByTestId("yacht-row-ones-armed")).toBeVisible();

    await page.getByTestId("score-row-full_house").click();
    await expect(page.getByTestId("yacht-row-ones-armed")).toHaveCount(0);
    await expect(page.getByTestId("yacht-row-full_house-armed")).toBeVisible();

    await page.getByTestId("score-row-sixes").click();
    await expect(page.getByText("Round 2 / 13")).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Sixes: scored, 18/ }),
    ).toBeVisible();
    // Round 2 has no roll yet, so the still-open Ones reads "not available" (a scratched 0 would
    // read "Ones: scored, 0").
    await expect(
      page.getByRole("button", { name: /Ones: not available/ }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Ones: scored/ }),
    ).toHaveCount(0);
  });

  test("holding a die disarms", async ({ page }) => {
    await page.getByTestId("score-row-ones").click();
    await expect(page.getByTestId("yacht-row-ones-armed")).toBeVisible();
    await page.getByTestId("yacht-die-0").click();
    await expect(page.getByTestId("yacht-row-ones-armed")).toHaveCount(0);
    await expect(page.getByText("Round 1 / 13")).toBeVisible();
  });
});
