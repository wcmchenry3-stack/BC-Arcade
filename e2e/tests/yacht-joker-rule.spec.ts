/**
 * yacht-joker-rule.spec.ts
 *
 * GH #181 — Joker rule enforcement e2e.
 *
 * The joker rule activates when:
 *   - The player already scored 50 in the "Yacht" category
 *   - The current roll is five-of-a-kind
 *
 * Priority chain:
 *   P1 — corresponding upper category (if open)  → ONLY that category selectable
 *   P2 — any open lower category (except Yacht)  → only lower categories selectable
 *   P3 — any open upper category                 → only upper categories selectable
 *
 * We inject pre-built GameState into localStorage to create each scenario
 * without needing to rely on random dice producing a yacht.
 */

import { test, expect } from "./fixtures";
import {
  injectGameState,
  blankScores,
  InjectedGameState,
} from "./helpers/yacht";

// ---------------------------------------------------------------------------
// State factories
// ---------------------------------------------------------------------------

function jokerState(overrides: {
  scores?: Record<string, number | null>;
  round?: number;
  total_score?: number;
  yacht_bonus_count?: number;
  yacht_bonus_total?: number;
}): InjectedGameState {
  return {
    dice: [3, 3, 3, 3, 3], // five threes → joker when yacht=50
    held: [false, false, false, false, false],
    rolls_used: 1,
    round: overrides.round ?? 2,
    scores: overrides.scores ?? { ...blankScores(), yacht: 50 },
    game_over: false,
    upper_subtotal: 0,
    upper_bonus: 0,
    yacht_bonus_count: overrides.yacht_bonus_count ?? 0,
    yacht_bonus_total: overrides.yacht_bonus_total ?? 0,
    total_score: overrides.total_score ?? 50,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("Yacht — joker rule enforcement (#181)", () => {
  test("priority 1: only corresponding upper category is selectable when it is open", async ({
    page,
  }) => {
    // dice=[3,3,3,3,3], yacht=50 scored → joker active, threes is open
    // Only "Threes" should be selectable; all other rows should be disabled/not-potential.
    await injectGameState(page, jokerState({}));
    await page.getByRole("button", { name: "Play Yacht" }).click();
    await expect(page.getByText(/Round 2 \/ 13/)).toBeVisible();

    // "Threes" row should show potential score (joker gives sum = 15 for five 3s)
    await expect(
      page.getByRole("button", { name: /Threes: potential score/ }),
    ).toBeVisible();

    // Upper categories other than Threes should NOT show potential score
    await expect(
      page.getByRole("button", { name: /Ones: potential score/ }),
    ).not.toBeVisible();
    await expect(
      page.getByRole("button", { name: /Twos: potential score/ }),
    ).not.toBeVisible();

    // Lower categories (e.g. Chance) should NOT show potential score when upper is forced
    await expect(
      page.getByRole("button", { name: /Chance: potential score/ }),
    ).not.toBeVisible();
  });

  test("priority 1: scoring the corresponding upper category awards the sum", async ({
    page,
  }) => {
    await injectGameState(page, jokerState({}));
    await page.getByRole("button", { name: "Play Yacht" }).click();
    await expect(page.getByText(/Round 2 \/ 13/)).toBeVisible();

    await page.getByRole("button", { name: /Threes: potential score/ }).click();

    // Round advances
    await expect(page.getByText(/Round 3 \/ 13/)).toBeVisible();

    // Threes scored with sum of dice (5×3 = 15)
    await expect(
      page.getByRole("button", { name: /Threes: scored 15/ }),
    ).toBeVisible();

    // Yacht bonus count incremented → yacht bonus row becomes visible
    await expect(page.getByText("Yacht Bonus")).toBeVisible();
  });

  test("priority 2: lower categories selectable when corresponding upper is filled", async ({
    page,
  }) => {
    // threes already scored → P1 is blocked → P2: open lower categories selectable
    const scores = {
      ...blankScores(),
      yacht: 50,
      threes: 15, // corresponding upper is filled → P1 skipped
    };
    await injectGameState(
      page,
      jokerState({ scores, total_score: 65, round: 3 }),
    );
    await page.getByRole("button", { name: "Play Yacht" }).click();
    await expect(page.getByText(/Round 3 \/ 13/)).toBeVisible();

    // Lower section categories should show potential scores (joker values)
    await expect(
      page.getByRole("button", { name: /Chance: potential score/ }),
    ).toBeVisible();

    // Upper categories other than the already-scored ones should NOT be selectable
    // when P2 lower categories are open
    await expect(
      page.getByRole("button", { name: /Ones: potential score/ }),
    ).not.toBeVisible();
  });

  test("priority 2: scoring a lower category under joker records the joker value", async ({
    page,
  }) => {
    const scores = {
      ...blankScores(),
      yacht: 50,
      threes: 15,
    };
    await injectGameState(
      page,
      jokerState({ scores, total_score: 65, round: 3 }),
    );
    await page.getByRole("button", { name: "Play Yacht" }).click();
    await expect(page.getByText(/Round 3 \/ 13/)).toBeVisible();

    // Score "Chance" — joker gives sum = 15
    await page.getByRole("button", { name: /Chance: potential score/ }).click();
    await expect(page.getByText(/Round 4 \/ 13/)).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Chance: scored 15/ }),
    ).toBeVisible();
  });

  test("scratched Yacht (scored 0) does not activate joker on subsequent yacht roll", async ({
    page,
  }) => {
    // yacht scored as 0 (scratched) → jokerActive requires yacht===50, not met
    const scores = { ...blankScores(), yacht: 0 };
    const state: InjectedGameState = {
      dice: [4, 4, 4, 4, 4],
      held: [false, false, false, false, false],
      rolls_used: 1,
      round: 2,
      scores,
      game_over: false,
      upper_subtotal: 0,
      upper_bonus: 0,
      yacht_bonus_count: 0,
      yacht_bonus_total: 0,
      total_score: 0,
    };

    await injectGameState(page, state);
    await page.getByRole("button", { name: "Play Yacht" }).click();
    await expect(page.getByText(/Round 2 \/ 13/)).toBeVisible();

    // Without joker active, all unfilled categories should show normal potential scores
    // Fours should show 20 (normal scoring: 5×4 = 20)
    await expect(
      page.getByRole("button", { name: /Fours: potential score/ }),
    ).toBeVisible();

    // Chance should also be selectable (normal scoring — no joker restriction)
    await expect(
      page.getByRole("button", { name: /Chance: potential score/ }),
    ).toBeVisible();
  });
});
