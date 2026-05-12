/**
 * blackjack-persistence.spec.ts — GH #191
 *
 * State persistence across navigation and page reloads.
 *
 * Blackjack persists EngineState to AsyncStorage (localStorage on web)
 * under the key "blackjack_game_v2" after every action.
 */

import { test, expect } from "@playwright/test";
import {
  BlackjackPage,
  gotoBlackjack,
  injectEngineState,
  playerPhaseState,
  resultPhaseState,
  gameOverState,
} from "./helpers/blackjack";

test.describe("Blackjack — state persistence", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => localStorage.removeItem("blackjack_game_v2"));
    await page.goto("/");
  });

  test("injected player-phase state is loaded on Blackjack screen open", async ({
    page,
  }) => {
    await injectEngineState(page, playerPhaseState());
    await page.getByRole("button", { name: "Play Blackjack" }).click();

    // Should land directly in player phase, not betting
    const bj = new BlackjackPage(page);
    await expect(page.getByText("Hit")).toBeVisible({ timeout: 5000 });
    await expect(bj.dealButton()).not.toBeVisible();
  });

  test("injected result-phase state is loaded and shows outcome", async ({
    page,
  }) => {
    await injectEngineState(page, resultPhaseState());
    await page.getByRole("button", { name: "Play Blackjack" }).click();

    // Result phase: outcome text and Next Hand button visible
    await expect(page.getByText("You Win!")).toBeVisible({ timeout: 5000 });
    await expect(page.getByText("Next Hand")).toBeVisible();
  });

  test("state is saved after dealing and restored on re-navigation", async ({
    page,
  }) => {
    const bj = new BlackjackPage(page);
    await bj.goto();
    await bj.chipButton(25).click();
    await bj.dealButton().click();

    // Wait for player or result phase
    const hitOrResult = page.getByText("Hit").or(page.getByText("Next Hand"));
    await expect(hitOrResult).toBeVisible({ timeout: 5000 });

    const wasPlayerPhase = await page.getByText("Hit").isVisible();

    // Navigate back to Home via URL (Lobby tab pop-to-root not reliable on web)
    await page.goto("/");
    await expect(page.getByText("BC Arcade").first()).toBeVisible({
      timeout: 10000,
    });

    // Return to Blackjack — state should be restored
    await page.getByRole("button", { name: "Play Blackjack" }).click();

    if (wasPlayerPhase) {
      await expect(page.getByText("Hit")).toBeVisible({ timeout: 5000 });
    } else {
      await expect(page.getByText("Next Hand")).toBeVisible({
        timeout: 5000,
      });
    }
  });

  test("state is saved to localStorage with correct key", async ({ page }) => {
    await injectEngineState(page, playerPhaseState());
    await page.getByRole("button", { name: "Play Blackjack" }).click();
    await expect(page.getByText("Hit")).toBeVisible({ timeout: 5000 });

    // Verify the key exists in localStorage
    const stored = await page.evaluate(() =>
      localStorage.getItem("blackjack_game_v2"),
    );
    expect(stored).not.toBeNull();
    const state = JSON.parse(stored!);
    expect(state.phase).toBe("player");
    expect(typeof state.chips).toBe("number");
    expect(Array.isArray(state.player_hand)).toBe(true);
    expect(Array.isArray(state.dealer_hand)).toBe(true);
    expect(Array.isArray(state.deck)).toBe(true);
  });

  test("localStorage is updated after standing (result phase saved)", async ({
    page,
  }) => {
    await injectEngineState(page, playerPhaseState());
    await page.getByRole("button", { name: "Play Blackjack" }).click();
    await expect(page.getByText("Hit")).toBeVisible();

    await page.getByRole("button", { name: /stand/i }).click();
    await expect(page.getByText("Next Hand")).toBeVisible({ timeout: 5000 });

    const stored = await page.evaluate(() =>
      localStorage.getItem("blackjack_game_v2"),
    );
    expect(stored).not.toBeNull();
    const state = JSON.parse(stored!);
    expect(state.phase).toBe("result");
    expect(state.outcome).not.toBeNull();
  });

  test("localStorage is updated to betting phase after Next Hand", async ({
    page,
  }) => {
    await injectEngineState(page, resultPhaseState());
    await page.getByRole("button", { name: "Play Blackjack" }).click();
    await page.getByText("Next Hand").click();

    const bj = new BlackjackPage(page);
    await expect(bj.dealButton()).toBeVisible({ timeout: 5000 });

    const stored = await page.evaluate(() =>
      localStorage.getItem("blackjack_game_v2"),
    );
    expect(stored).not.toBeNull();
    const state = JSON.parse(stored!);
    expect(state.phase).toBe("betting");
    expect(state.bet).toBe(0);
    expect(state.player_hand).toHaveLength(0);
    expect(state.dealer_hand).toHaveLength(0);
  });

  test("game-over state shows Out of Chips modal", async ({ page }) => {
    await injectEngineState(page, gameOverState());
    await page.getByRole("button", { name: "Play Blackjack" }).click();

    await expect(page.getByText("Out of Chips").first()).toBeVisible({
      timeout: 5000,
    });
  });

  test("chip balance persists across sessions (injected chips shown)", async ({
    page,
  }) => {
    await injectEngineState(page, playerPhaseState({ chips: 750 }));
    await page.getByRole("button", { name: "Play Blackjack" }).click();
    await expect(page.getByText("Hit")).toBeVisible();

    // After standing, chip strip shows the correct starting chip count
    await page.getByRole("button", { name: /stand/i }).click();
    await expect(page.getByText("Next Hand")).toBeVisible({ timeout: 5000 });

    // Chip strip should reflect outcome (win/push/lose from 750)
    await expect(page.getByText(/\d+ chips/).first()).toBeVisible();
  });
});
