/**
 * blackjack-betting.spec.ts — GH #190 / #335
 *
 * Bet chip selector and Deal button interaction tests.
 *
 * BettingPanel rules (Beginner table — selected after fresh install):
 *   - Default bet: 0 (no chips placed yet)
 *   - Chip denominations: 5, 10, 25
 *   - Min bet: 5, Max bet: min(25, chips)
 *   - Deal button disabled when bet < 5 or bet > chips
 *   - Clear Bet resets to 0
 */

import { test, expect } from "@playwright/test";
import {
  BlackjackPage,
  gotoBlackjack,
  injectEngineState,
  playerPhaseState,
  resultPhaseState,
} from "./helpers/blackjack";

test.describe("Blackjack — betting panel and chip selector", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => localStorage.removeItem("blackjack_game_v2"));
    await page.goto("/");
  });

  test("default bet is 0 and Deal is disabled on a fresh game", async ({
    page,
  }) => {
    await gotoBlackjack(page);
    await expect(
      page.getByRole("button", { name: /deal cards with 0-chip bet/i }),
    ).toBeDisabled();
  });

  test("bankroll is displayed in the header", async ({ page }) => {
    await gotoBlackjack(page);
    await expect(
      page.locator('[aria-label*="Bankroll: 100 chips"]'),
    ).toBeVisible();
  });

  test("clicking 10-chip button adds 10 to bet", async ({ page }) => {
    const bj = new BlackjackPage(page);
    await bj.goto();
    await bj.chipButton(10).click();

    await expect(
      page.getByRole("button", { name: /deal cards with 10-chip bet/i }),
    ).toBeVisible();
  });

  test("clicking 25-chip button adds 25 to bet", async ({ page }) => {
    const bj = new BlackjackPage(page);
    await bj.goto();
    await bj.chipButton(25).click();

    await expect(
      page.getByRole("button", { name: /deal cards with 25-chip bet/i }),
    ).toBeVisible();
  });

  test("multiple chip clicks accumulate the bet", async ({ page }) => {
    const bj = new BlackjackPage(page);
    await bj.goto();
    await bj.chipButton(10).click();
    await bj.chipButton(5).click();

    // 10 + 5 = 15
    await expect(
      page.getByRole("button", { name: /deal cards with 15-chip bet/i }),
    ).toBeVisible();
  });

  test("Clear Bet resets bet to 0 and disables Deal", async ({ page }) => {
    const bj = new BlackjackPage(page);
    await bj.goto();
    await bj.chipButton(25).click();
    await expect(
      page.getByRole("button", { name: /deal cards with 25-chip bet/i }),
    ).toBeVisible();

    await page.getByRole("button", { name: /clear bet/i }).click();

    await expect(
      page.getByRole("button", { name: /deal cards with 0-chip bet/i }),
    ).toBeDisabled();
  });

  test("Clear Bet is disabled when bet is 0", async ({ page }) => {
    await gotoBlackjack(page);
    await expect(
      page.getByRole("button", { name: /clear bet/i }),
    ).toBeDisabled();
  });

  test("25-chip button is disabled when chips < 25", async ({ page }) => {
    await injectEngineState(
      page,
      playerPhaseState({
        chips: 10,
        bet: 0,
        phase: "betting",
        outcome: null,
        payout: 0,
        player_hand: [],
        dealer_hand: [],
      }),
    );
    await page.getByRole("button", { name: "Play Blackjack" }).click();
    const bj = new BlackjackPage(page);
    await expect(bj.dealButton()).toBeVisible();

    await expect(
      page.getByRole("button", { name: /25.*not available/i }),
    ).toBeDisabled();
  });

  test("chip button is disabled when it would exceed max bet", async ({
    page,
  }) => {
    await gotoBlackjack(page);
    // Place 25 chips — at max bet for beginner table (betMax = 25)
    await page.getByRole("button", { name: /add 25 to bet/i }).click();

    await expect(
      page.getByRole("button", { name: /deal cards with 25-chip bet/i }),
    ).toBeVisible();
    // 5-chip button should now be disabled (exact match avoids 25 ambiguity)
    await expect(
      page.getByRole("button", { name: "5-chip not available", exact: true }),
    ).toBeDisabled();
  });

  test("table limits are visible", async ({ page }) => {
    await gotoBlackjack(page);
    await expect(page.getByText(/table limits/i)).toBeVisible();
  });

  test("Deal button is enabled after placing a valid bet", async ({ page }) => {
    const bj = new BlackjackPage(page);
    await bj.goto();
    await bj.chipButton(25).click();
    await expect(
      page.getByRole("button", { name: /deal cards with 25-chip bet/i }),
    ).not.toBeDisabled();
  });

  test("pressing Deal with a valid bet starts the hand", async ({ page }) => {
    const bj = new BlackjackPage(page);
    await bj.goto();
    await bj.chipButton(25).click();
    await page
      .getByRole("button", { name: /deal cards with 25-chip bet/i })
      .click();

    // Either player phase or natural blackjack result
    await expect(
      page.getByText("Hit").or(page.getByText("Next Hand")),
    ).toBeVisible({
      timeout: 5000,
    });
  });

  test("Hit and Stand buttons are visible in player phase", async ({
    page,
  }) => {
    await injectEngineState(page, playerPhaseState());
    await page.getByRole("button", { name: "Play Blackjack" }).click();

    await expect(
      page.getByRole("button", { name: /hit — take another card/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /stand — end your turn/i }),
    ).toBeVisible();
  });

  test("BettingPanel is not shown during player phase", async ({ page }) => {
    const bj = new BlackjackPage(page);
    await injectEngineState(page, playerPhaseState());
    await page.getByRole("button", { name: "Play Blackjack" }).click();
    await expect(page.getByText("Hit")).toBeVisible();

    // Deal button should not be visible
    await expect(bj.dealButton()).not.toBeVisible();
  });

  test("BettingPanel returns after pressing Next Hand", async ({ page }) => {
    const bj = new BlackjackPage(page);
    await injectEngineState(page, resultPhaseState());
    await page.getByRole("button", { name: "Play Blackjack" }).click();

    await expect(page.getByText("Next Hand")).toBeVisible();
    await page.getByText("Next Hand").click();

    // BettingPanel with Deal button should be visible again
    await expect(bj.dealButton()).toBeVisible({ timeout: 5000 });
  });
});
