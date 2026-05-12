/**
 * yacht-new-game.spec.ts — GH #393
 *
 * Covers the New Game button and confirmation modal flows:
 *   - Fresh game: tap New Game → immediately back in round 1, no dialog
 *   - In-progress: roll + score → tap New Game → Cancel → state preserved
 *   - In-progress: roll + score → tap New Game → Start new game → fresh round 1
 */

import { test, expect } from "./fixtures";

test.describe("Yacht — New Game button", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => localStorage.removeItem("yacht_game_v1"));
    await page.goto("/");
  });

  test("fresh game: New Game resets immediately with no confirm dialog", async ({
    page,
  }) => {
    await page.getByRole("button", { name: "Play Yacht" }).click();
    await expect(page.getByText("Round 1 / 13")).toBeVisible();

    await page.getByRole("button", { name: /new game/i }).click();

    // Confirm dialog must NOT appear
    await expect(page.getByText("Start new game?")).not.toBeVisible();
    // Still in round 1 — game reset in place
    await expect(page.getByText("Round 1 / 13")).toBeVisible();
  });

  test("in-progress: Cancel preserves game state", async ({ page }) => {
    await page.getByRole("button", { name: "Play Yacht" }).click();
    await expect(page.getByText("Round 1 / 13")).toBeVisible();

    // Advance to round 2 by rolling and scoring Ones
    await page.getByRole("button", { name: /roll/i }).click();
    await page.getByText("Ones").first().click();
    await expect(page.getByText("Round 2 / 13")).toBeVisible();

    // Tap New Game — confirm dialog should appear
    await page.getByRole("button", { name: /new game/i }).click();
    await expect(page.getByText("Start new game?")).toBeVisible();

    // Cancel — dialog closes, still in round 2
    await page.getByRole("button", { name: /^cancel$/i }).click();
    await expect(page.getByText("Start new game?")).not.toBeVisible();
    await expect(page.getByText("Round 2 / 13")).toBeVisible();
  });

  test("in-progress: Start new game resets to round 1 with no scored categories", async ({
    page,
  }) => {
    await page.getByRole("button", { name: "Play Yacht" }).click();
    await expect(page.getByText("Round 1 / 13")).toBeVisible();

    // Advance to round 2
    await page.getByRole("button", { name: /roll/i }).click();
    await page.getByText("Ones").first().click();
    await expect(page.getByText("Round 2 / 13")).toBeVisible();

    // Tap New Game → confirm
    await page.getByRole("button", { name: /new game/i }).click();
    await expect(page.getByText("Start new game?")).toBeVisible();
    await page.getByRole("button", { name: "Start new game" }).click();

    // Back to round 1 with fresh state
    await expect(page.getByText("Round 1 / 13")).toBeVisible({ timeout: 5000 });
    // No scored categories — all rows show "not available"
    await expect(
      page.getByRole("button", { name: "Ones: not available" }),
    ).toBeVisible();
    // Rolls should be fresh (Roll button available)
    await expect(page.getByRole("button", { name: /roll/i })).toBeVisible();
  });
});
