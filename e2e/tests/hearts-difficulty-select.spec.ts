/**
 * hearts-difficulty-select.spec.ts — GH #1168
 *
 * Hearts has one CPU, so no opponent picker and no pre-game screen (#3489): a
 * fresh screen deals the table, and the result card offers Play Again (#2506)
 * but no Change Difficulty, also from a saved legacy-persona game. That
 * the legacy save plays as "conservative" is asserted in
 * hearts-leaderboard.spec.ts (ai_difficulty) and the unit tests.
 * No running backend is needed: the routes this spec depends on are
 * intercepted with page.route(), and any other call (such as SyncWorker's
 * game sync) fails, which the app handles like being offline.
 */

import { test, expect } from "./fixtures";
import { gotoHearts, injectHeartsState } from "./helpers/hearts";
import { installEntitlementsMock } from "./helpers/api-mock";
import {
  DIFFICULTY_GAME_OVER_STATE as GAME_OVER_STATE,
  DIFFICULTY_V2_STATE,
} from "./helpers/heartsFixtures";

test.describe("Hearts — no opponent picker (#1168, #3158, #3489)", () => {
  test("a fresh screen deals the table: no pre-game screen, no opponent picker", async ({
    page,
  }) => {
    await installEntitlementsMock(page);
    await page.goto("/");
    await page.evaluate(() => localStorage.removeItem("hearts_game"));
    await page.getByRole("button", { name: "Play Hearts" }).click();
    await page
      .getByRole("heading", { name: "Hearts", exact: true })
      .waitFor({ timeout: 10_000 });

    await expect(page.getByLabel("Your hand, 13 cards")).toBeVisible({
      timeout: 8_000,
    });
    await expect(page.getByRole("button", { name: "Start Game" })).toHaveCount(
      0,
    );
    await expect(
      page.getByRole("radiogroup", { name: "Opponent Style" }),
    ).toHaveCount(0);
    await expect(page.getByRole("radio")).toHaveCount(0);
  });

  test("store build: Play Again works from a saved legacy-persona game", async ({
    page,
  }) => {
    await injectHeartsState(page, { ...GAME_OVER_STATE, aiDifficulty: "daring" });
    await page.getByRole("button", { name: "Play Hearts" }).click();
    await page
      .getByRole("heading", { name: "Hearts", exact: true })
      .waitFor({ timeout: 10_000 });
    await expect(page.getByTestId("hearts-result")).toBeVisible({
      timeout: 5_000,
    });
    await page
      .getByTestId("hearts-result")
      .getByRole("button", { name: "Play Again" })
      .click();
    await expect(page.getByLabel("Your hand, 13 cards")).toBeVisible({
      timeout: 8_000,
    });
  });

  test("the result card has no Change Difficulty (there is nothing to change)", async ({
    page,
  }) => {
    await injectHeartsState(page, GAME_OVER_STATE);
    await page.getByRole("button", { name: "Play Hearts" }).click();
    await page
      .getByRole("heading", { name: "Hearts", exact: true })
      .waitFor({ timeout: 10_000 });

    // The shared result card (#2506) — West has the lowest score.
    const card = page.getByTestId("hearts-result");
    await expect(card).toBeVisible({ timeout: 5_000 });
    await expect(card.getByText("West Wins")).toBeVisible();
    await expect(card.getByRole("button", { name: "Play Again" })).toBeVisible();
    await expect(
      card.getByRole("button", { name: "Change Difficulty" }),
    ).toHaveCount(0);
  });

  test("Play Again on the result card deals a new game without the picker", async ({
    page,
  }) => {
    await injectHeartsState(page, GAME_OVER_STATE);
    await page.getByRole("button", { name: "Play Hearts" }).click();
    await page
      .getByRole("heading", { name: "Hearts", exact: true })
      .waitFor({ timeout: 10_000 });

    const card = page.getByTestId("hearts-result");
    await expect(card).toBeVisible({ timeout: 5_000 });
    await card.getByRole("button", { name: "Play Again" }).click();

    await expect(page.getByLabel("Your hand, 13 cards")).toBeVisible({
      timeout: 8_000,
    });
    await expect(page.getByRole("button", { name: "Start Game" })).toHaveCount(
      0,
    );
  });

  test("v2 saved game (no aiDifficulty) loads without showing the picker", async ({
    page,
  }) => {
    // Inject a v2 state — migration should convert it to v3 silently
    const v2State = DIFFICULTY_V2_STATE;
    await injectHeartsState(page, v2State);
    await page.getByRole("button", { name: "Play Hearts" }).click();
    await page
      .getByRole("heading", { name: "Hearts", exact: true })
      .waitFor({ timeout: 10_000 });

    // No pre-game picker — game loaded from storage
    await expect(page.getByRole("button", { name: "Start Game" })).toHaveCount(
      0,
    );
    await expect(page.getByLabel("Your hand, 13 cards")).toBeVisible({
      timeout: 5_000,
    });
  });
});
