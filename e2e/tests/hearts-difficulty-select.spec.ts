/**
 * hearts-difficulty-select.spec.ts — GH #1168
 *
 * Store builds show no opponent picker (#3158; the legacy picker is dev /
 * pre-launch only): the pre-game screen, the result card's Change Difficulty /
 * Play Again (#2506), and Play Again from a saved legacy-persona game. That
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

test.describe("Hearts — difficulty selector, store build (#1168, #3158)", () => {
  test("store build: no opponent picker is rendered before a game", async ({
    page,
  }) => {
    await installEntitlementsMock(page);
    await page.goto("/");
    await page.evaluate(() => localStorage.removeItem("hearts_game"));
    await page.getByRole("button", { name: "Play Hearts" }).click();
    await page
      .getByRole("heading", { name: "Hearts", exact: true })
      .waitFor({ timeout: 10_000 });

    await expect(page.getByRole("button", { name: "Start Game" })).toBeVisible({
      timeout: 5_000,
    });
    await expect(
      page.getByRole("radiogroup", { name: "Opponent Style" }),
    ).toHaveCount(0);
    await expect(page.getByRole("radio")).toHaveCount(0);
  });

  test("store build: Start Game launches a game", async ({
    page,
  }) => {
    await installEntitlementsMock(page);
    await page.goto("/");
    await page.evaluate(() => localStorage.removeItem("hearts_game"));
    await page.getByRole("button", { name: "Play Hearts" }).click();
    await page
      .getByRole("heading", { name: "Hearts", exact: true })
      .waitFor({ timeout: 10_000 });

    await page.getByRole("button", { name: "Start Game" }).click();

    await expect(page.getByLabel("Your hand, 13 cards")).toBeVisible({
      timeout: 8_000,
    });
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

  test("Change Difficulty on the result card returns to the pre-game screen (no picker in store builds)", async ({
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

    await card.getByRole("button", { name: "Change Difficulty" }).click();
    await expect(
      page.getByRole("button", { name: "Start Game" }),
    ).toBeVisible({ timeout: 5_000 });
    await expect(
      page.getByRole("radiogroup", { name: "Opponent Style" }),
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
