/**
 * blackjack-accessibility.spec.ts — GH #193
 *
 * Accessibility smoke tests for the Blackjack screen.
 *
 * Verifies:
 *   - ARIA labels on all interactive controls
 *   - Card accessibility labels (face-up and face-down)
 *   - Chip balance accessible label
 *   - axe-core scan passes on betting, player, and result phases
 */

import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import {
  BlackjackPage,
  gotoBlackjack,
  injectEngineState,
  playerPhaseState,
  resultPhaseState,
} from "./helpers/blackjack";

test.describe("Blackjack — accessibility", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => localStorage.removeItem("blackjack_game_v2"));
    await page.goto("/");
  });

  // ---------------------------------------------------------------------------
  // Betting phase
  // ---------------------------------------------------------------------------

  test("goal-progress HUD has accessible label in betting phase", async ({ page }) => {
    await gotoBlackjack(page);
    await expect(
      page.locator('[aria-label*="Goal progress:"]'),
    ).toBeVisible();
  });

  test("chip buttons have accessible labels in betting phase", async ({
    page,
  }) => {
    const bj = new BlackjackPage(page);
    await bj.goto();
    await expect(bj.chipButton(5)).toBeVisible();
    await expect(bj.chipButton(10)).toBeVisible();
    await expect(bj.chipButton(25)).toBeVisible();
  });

  test("current bet circle has accessible label", async ({ page }) => {
    await gotoBlackjack(page);
    await expect(
      page.locator('[aria-label*="Current bet: 0 chips"]'),
    ).toBeVisible();
  });

  test("Deal button has accessible label including bet amount", async ({
    page,
  }) => {
    const bj = new BlackjackPage(page);
    await bj.goto();
    await bj.chipButton(25).click();
    await expect(
      page.getByRole("button", { name: /deal cards with 25-chip bet/i }),
    ).toBeVisible();
  });

  // ---------------------------------------------------------------------------
  // Player phase
  // ---------------------------------------------------------------------------

  test("Hit button has accessible label", async ({ page }) => {
    await injectEngineState(page, playerPhaseState());
    await page.getByRole("button", { name: "Play Blackjack" }).click();
    await expect(page.getByText("Hit")).toBeVisible();

    await expect(
      page.getByRole("button", { name: /hit — take another card/i }),
    ).toBeVisible();
  });

  test("Stand button has accessible label", async ({ page }) => {
    await injectEngineState(page, playerPhaseState());
    await page.getByRole("button", { name: "Play Blackjack" }).click();
    await expect(page.getByText("Hit")).toBeVisible();

    await expect(
      page.getByRole("button", { name: /stand — end your turn/i }),
    ).toBeVisible();
  });

  test("Double Down button has accessible label when available", async ({
    page,
  }) => {
    await injectEngineState(page, playerPhaseState());
    await page.getByRole("button", { name: "Play Blackjack" }).click();
    await expect(page.getByText("Hit")).toBeVisible();

    await expect(
      page.getByRole("button", { name: /double down — double bet/i }),
    ).toBeVisible();
  });

  test("Double Down button has accessible disabled label when not available", async ({
    page,
  }) => {
    // 3-card hand → double not available
    await injectEngineState(
      page,
      playerPhaseState({
        player_hand: [
          { suit: "♠", rank: "3" },
          { suit: "♥", rank: "4" },
          { suit: "♣", rank: "5" },
        ],
      }),
    );
    await page.getByRole("button", { name: "Play Blackjack" }).click();
    await expect(page.getByText("Hit")).toBeVisible();

    await expect(
      page.getByRole("button", { name: /double down not available/i }),
    ).toBeDisabled();
  });

  test("goal-progress HUD has accessible label in player phase", async ({
    page,
  }) => {
    await injectEngineState(page, playerPhaseState({ chips: 1000 }));
    await page.getByRole("button", { name: "Play Blackjack" }).click();
    await expect(page.getByText("Hit")).toBeVisible();

    await expect(
      page.locator('[aria-label*="Goal progress:"]'),
    ).toBeVisible();
  });

  // ---------------------------------------------------------------------------
  // Cards accessibility
  // ---------------------------------------------------------------------------

  test("face-up player cards have rank and suit in accessible label", async ({
    page,
  }) => {
    // player hand: 8♠ and 7♥
    await injectEngineState(page, playerPhaseState());
    await page.getByRole("button", { name: "Play Blackjack" }).click();
    await expect(page.getByText("Hit")).toBeVisible();

    // "8 of Spades" or similar (i18n expands the suit symbol)
    await expect(
      page
        .locator('[aria-label*="8 of Spades"]')
        .or(page.locator('[role="img"][aria-label*="8"]')),
    ).toBeVisible();
  });

  test("face-down dealer hole card has accessible label", async ({ page }) => {
    await injectEngineState(page, playerPhaseState());
    await page.getByRole("button", { name: "Play Blackjack" }).click();
    await expect(page.getByText("Hit")).toBeVisible();

    // Dealer hole card is concealed during player phase
    await expect(page.locator('[aria-label="Face-down card"]')).toBeVisible();
  });

  // ---------------------------------------------------------------------------
  // Result phase
  // ---------------------------------------------------------------------------

  test("Next Hand button has accessible label in result phase", async ({
    page,
  }) => {
    await injectEngineState(page, resultPhaseState());
    await page.getByRole("button", { name: "Play Blackjack" }).click();
    await expect(page.getByText("Next Hand")).toBeVisible();

    await expect(
      page.getByRole("button", { name: /start the next hand/i }),
    ).toBeVisible();
  });

  test("Quit button has accessible label in result phase", async ({ page }) => {
    await injectEngineState(page, resultPhaseState());
    await page.getByRole("button", { name: "Play Blackjack" }).click();
    await expect(page.getByText("Next Hand")).toBeVisible();

    await expect(
      page.getByRole("button", { name: /quit and return to home screen/i }),
    ).toBeVisible();
  });

  test("payout text has accessible label in result phase", async ({ page }) => {
    await injectEngineState(page, resultPhaseState({ payout: 100 }));
    await page.getByRole("button", { name: "Play Blackjack" }).click();
    await expect(page.getByText("Next Hand")).toBeVisible();

    await expect(
      page.locator('[aria-label*="Payout: 100 chips"]'),
    ).toBeVisible();
  });

  // ---------------------------------------------------------------------------
  // axe-core automated scan
  // ---------------------------------------------------------------------------

  test("no critical axe violations during betting phase", async ({ page }) => {
    await gotoBlackjack(page);
    const results = await new AxeBuilder({ page })
      .disableRules(["color-contrast"]) // theme-dependent; checked manually
      .analyze();
    expect(
      results.violations.filter((v) => v.impact === "critical"),
    ).toHaveLength(0);
  });

  test("no critical axe violations during player phase", async ({ page }) => {
    await injectEngineState(page, playerPhaseState());
    await page.getByRole("button", { name: "Play Blackjack" }).click();
    await expect(page.getByText("Hit")).toBeVisible();

    const results = await new AxeBuilder({ page })
      .disableRules(["color-contrast"])
      .analyze();
    expect(
      results.violations.filter((v) => v.impact === "critical"),
    ).toHaveLength(0);
  });

  test("no critical axe violations during result phase", async ({ page }) => {
    await injectEngineState(page, resultPhaseState());
    await page.getByRole("button", { name: "Play Blackjack" }).click();
    await expect(page.getByText("Next Hand")).toBeVisible();

    const results = await new AxeBuilder({ page })
      .disableRules(["color-contrast"])
      .analyze();
    expect(
      results.violations.filter((v) => v.impact === "critical"),
    ).toHaveLength(0);
  });
});
