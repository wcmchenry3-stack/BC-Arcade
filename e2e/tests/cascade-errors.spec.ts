/**
 * cascade-errors.spec.ts — GH #1563
 *
 * Error-path coverage for Cascade.
 *
 * Covers:
 *   - Navigation (back to Home)
 *   - Invalid input: game-over overlay blocks further play
 *   - Server error display: 500 on cascade API during load
 *   - Graceful recovery: Play Again resets score and clears overlay
 *   - Corrupted localStorage fallback
 */

import { test, expect } from "@playwright/test";
import {
  gotoCascade,
  triggerGameOver,
  getState,
  mockLeaderboard,
} from "./helpers/cascade";
import { installEntitlementsMock } from "./helpers/api-mock";

const API_BASE = "http://localhost:8000";

test.describe("Cascade — error paths", () => {
  // ---------------------------------------------------------------------------
  // Navigation
  // ---------------------------------------------------------------------------

  test("navigating away from Cascade returns to Home", async ({ page }) => {
    await mockLeaderboard(page);
    await gotoCascade(page);

    await page.goto("/");
    await expect(page.getByText("BC Arcade").first()).toBeVisible({
      timeout: 10_000,
    });
  });

  // ---------------------------------------------------------------------------
  // Invalid input rejection
  // ---------------------------------------------------------------------------

  test("game-over overlay blocks further play — overlay persists on canvas click", async ({
    page,
  }) => {
    await mockLeaderboard(page);
    await gotoCascade(page);
    await triggerGameOver(page);

    await expect(page.getByRole("heading", { name: "Game Over" })).toBeVisible({
      timeout: 5_000,
    });

    // Click the canvas area behind the overlay — game-over must not be dismissed
    const canvas = page.getByRole("img", { name: /Cascade game/i });
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);

    // Overlay remains; engine still reports game-over
    await expect(page.getByRole("heading", { name: "Game Over" })).toBeVisible({
      timeout: 2_000,
    });
    const state = await getState(page);
    expect(state.gameOver).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Server error display
  // ---------------------------------------------------------------------------

  test("cascade API 500 on load — canvas still renders, game is playable", async ({
    page,
  }) => {
    await page.route(`${API_BASE}/cascade/**`, async (route) => {
      await route.fulfill({ status: 500, body: "Internal Server Error" });
    });

    await gotoCascade(page);

    // Canvas loads despite server error (game logic is client-side)
    await expect(
      page.getByRole("img", { name: /Cascade game/i }),
    ).toBeVisible();
    const state = await getState(page);
    expect(state.gameOver).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // Graceful recovery
  // ---------------------------------------------------------------------------

  test("Play Again after game-over resets score to 0 and clears overlay", async ({
    page,
  }) => {
    await mockLeaderboard(page);
    await gotoCascade(page);
    await triggerGameOver(page);

    await expect(page.getByRole("heading", { name: "Game Over" })).toBeVisible({
      timeout: 5_000,
    });
    await page.getByRole("button", { name: "Play again" }).click();

    await expect(
      page.getByRole("heading", { name: "Game Over" }),
    ).not.toBeVisible({ timeout: 3_000 });
    const state = await getState(page);
    expect(state.score).toBe(0);
    expect(state.gameOver).toBe(false);
  });

  test("corrupted localStorage — game loads a fresh board", async ({ page }) => {
    await installEntitlementsMock(page);
    await mockLeaderboard(page);
    await page.goto("/");
    await page.evaluate(() =>
      localStorage.setItem("cascade_game_v1", "not-valid-json{{{"),
    );

    await gotoCascade(page);

    await expect(
      page.getByRole("img", { name: /Cascade game/i }),
    ).toBeVisible({ timeout: 15_000 });
    const state = await getState(page);
    expect(state.score).toBe(0);
    expect(state.gameOver).toBe(false);
  });
});
