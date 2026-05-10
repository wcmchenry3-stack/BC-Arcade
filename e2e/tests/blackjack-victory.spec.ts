/**
 * blackjack-victory.spec.ts — BJ-3
 *
 * Victory screen: run-complete flow, cash-out, and keep-playing.
 * Tests use injectEngineState to land directly in phase=victory.
 */

import { test, expect } from "@playwright/test";
import { injectEngineState, victoryPhaseState } from "./helpers/blackjack";

test.describe("Blackjack — victory screen", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => localStorage.removeItem("blackjack_game_v2"));
    await page.goto("/");
  });

  test("victory state loads the Victory screen with goal-reached title", async ({ page }) => {
    await injectEngineState(page, victoryPhaseState());
    await page.getByRole("button", { name: "Play Blackjack" }).click();

    await expect(page.getByText("Goal Reached!")).toBeVisible({ timeout: 5000 });
  });

  test("Victory screen shows chip count and goal", async ({ page }) => {
    await injectEngineState(page, victoryPhaseState({ chips: 260, runGoal: 250 }));
    await page.getByRole("button", { name: "Play Blackjack" }).click();

    await expect(page.getByText("Goal Reached!")).toBeVisible({ timeout: 5000 });
    await expect(page.getByText(/260 chips/i)).toBeVisible();
    await expect(page.getByText(/Goal: 250 chips/i)).toBeVisible();
  });

  test("Victory screen shows completed table name", async ({ page }) => {
    await injectEngineState(page, victoryPhaseState());
    await page.getByRole("button", { name: "Play Blackjack" }).click();

    await expect(page.getByText("Goal Reached!")).toBeVisible({ timeout: 5000 });
    await expect(page.getByText(/beginner/i).first()).toBeVisible();
  });

  test("Cash Out navigates to table selection", async ({ page }) => {
    await injectEngineState(page, victoryPhaseState());
    await page.getByRole("button", { name: "Play Blackjack" }).click();

    await expect(page.getByText("Goal Reached!")).toBeVisible({ timeout: 5000 });
    await page.getByRole("button", { name: /cash out/i }).click();

    // Should land on table select (Choose Your Table)
    await expect(page.getByText(/choose your table/i)).toBeVisible({ timeout: 5000 });
  });

  test("Keep Playing transitions to betting phase without a goal", async ({ page }) => {
    await injectEngineState(page, victoryPhaseState());
    await page.getByRole("button", { name: "Play Blackjack" }).click();

    await expect(page.getByText("Goal Reached!")).toBeVisible({ timeout: 5000 });
    await page.getByRole("button", { name: /keep playing/i }).click();

    // Should land on betting panel (Deal button), not table select
    await expect(
      page.getByRole("button", { name: /deal cards with/i }),
    ).toBeVisible({ timeout: 5000 });
    // Table select should NOT be shown
    await expect(page.getByText(/choose your table/i)).not.toBeVisible();
  });

  test("non-high-roller victory shows next table CTA", async ({ page }) => {
    // Beginner table (betMin=5, betMax=25) — next table is Intermediate
    await injectEngineState(page, victoryPhaseState());
    await page.getByRole("button", { name: "Play Blackjack" }).click();

    await expect(page.getByText("Goal Reached!")).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole("button", { name: /play intermediate table/i })).toBeVisible();
  });

  test("high-roller victory shows Cash Out as primary CTA (no next table)", async ({ page }) => {
    await injectEngineState(
      page,
      victoryPhaseState({ chips: 1550, runGoal: 1500, betMin: 25, betMax: 200, startingChips: 500 }),
    );
    await page.getByRole("button", { name: "Play Blackjack" }).click();

    await expect(page.getByText("Goal Reached!")).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole("button", { name: /cash out/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /play.*table/i })).not.toBeVisible();
  });

  test("back button on Victory screen returns to Home", async ({ page }) => {
    await injectEngineState(page, victoryPhaseState());
    await page.getByRole("button", { name: "Play Blackjack" }).click();

    await expect(page.getByText("Goal Reached!")).toBeVisible({ timeout: 5000 });
    await page.getByRole("button", { name: /back/i }).click();

    await expect(page.getByText("BC Arcade").first()).toBeVisible({ timeout: 5000 });
  });
});
