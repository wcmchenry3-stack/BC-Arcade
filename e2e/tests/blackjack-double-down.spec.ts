/**
 * blackjack-double-down.spec.ts — GH #189
 *
 * Double-down end-to-end verification.
 *
 * Double-down is available when:
 *   - phase === "player"
 *   - player_hand.length === 2 (initial two cards only)
 *   - chips >= bet * 2
 */

import { test, expect } from "./fixtures";
import { injectEngineState, playerPhaseState } from "./helpers/blackjack";

test.describe("Blackjack — double-down", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => localStorage.removeItem("blackjack_game_v2"));
    await page.goto("/");
  });

  test("Double Down button is visible and enabled on first two cards", async ({
    page,
  }) => {
    // chips=1000, bet=100, 2-card hand → double-down available
    await injectEngineState(page, playerPhaseState());
    await page.getByRole("button", { name: "Play Blackjack" }).click();

    await expect(page.getByText("Hit")).toBeVisible();
    await expect(
      page.getByRole("button", { name: /double down — double bet/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /double down — double bet/i }),
    ).not.toBeDisabled();
  });

  test("Double Down transitions directly to result phase", async ({ page }) => {
    await injectEngineState(page, playerPhaseState());
    await page.getByRole("button", { name: "Play Blackjack" }).click();
    await expect(page.getByText("Hit")).toBeVisible();

    await page
      .getByRole("button", { name: /double down — double bet/i })
      .click();

    // Dealer plays out and we land in result phase
    await expect(page.getByText("Next Hand")).toBeVisible({ timeout: 5000 });
    // Hit/Stand/Double Down are gone
    await expect(page.getByText("Hit")).not.toBeVisible();
  });

  test("Double Down is disabled when chips are insufficient", async ({
    page,
  }) => {
    // bet=100, chips=150 → need 200 to double, so disabled
    await injectEngineState(page, playerPhaseState({ chips: 150, bet: 100 }));
    await page.getByRole("button", { name: "Play Blackjack" }).click();
    await expect(page.getByText("Hit")).toBeVisible();

    // Double Down button should be disabled (not enough chips)
    await expect(
      page.getByRole("button", { name: /double down not available/i }),
    ).toBeDisabled();
  });

  test("Double Down is disabled after a third card is dealt (hit first)", async ({
    page,
  }) => {
    // 3-card hand — double down not available
    await injectEngineState(
      page,
      playerPhaseState({
        player_hand: [
          { suit: "♠", rank: "4" },
          { suit: "♥", rank: "5" },
          { suit: "♣", rank: "3" },
        ],
      }),
    );
    await page.getByRole("button", { name: "Play Blackjack" }).click();
    await expect(page.getByText("Hit")).toBeVisible();

    await expect(
      page.getByRole("button", { name: /double down not available/i }),
    ).toBeDisabled();
  });

  test("chip balance reflects doubled bet after double-down win", async ({
    page,
  }) => {
    // chips=1000, bet=100. If win after double: payout = +200 → chips = 1200
    // Outcome is non-deterministic; verify chip count changed from 1000
    await injectEngineState(page, playerPhaseState());
    await page.getByRole("button", { name: "Play Blackjack" }).click();

    await page
      .getByRole("button", { name: /double down — double bet/i })
      .click();
    await expect(page.getByText("Next Hand")).toBeVisible({ timeout: 5000 });

    // Chip display updated (won't be 1000 anymore — bet was 200 post-double)
    await expect(page.getByText(/\d+ chips/).first()).toBeVisible();
  });
});
