/**
 * yacht-ai-turn.spec.ts
 *
 * GH #1602 — AI turn flow in VS mode.
 *
 * Verifies that:
 *   - "Your Turn" banner is shown at game start
 *   - Roll button is enabled on the player's turn
 *   - After the player scores, "Computer's Turn" banner appears
 *   - Roll button is disabled while the AI is thinking
 *   - AI completes its turn and control returns to the player
 */

import { test, expect } from "./fixtures";

test.describe("Yacht — AI turn flow (#1602)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => localStorage.removeItem("yacht_game_v2"));
    await page.goto("/");
    await page.getByRole("button", { name: "Play Yacht" }).click();
    // Use Easy for fastest AI turns
    await page.getByRole("radio", { name: /^Easy$/i }).click();
    await page.getByRole("button", { name: /^VS Computer$/i }).click();
    await expect(page.getByText("Round 1 / 13")).toBeVisible();
  });

  test("shows Your Turn banner at game start", async ({ page }) => {
    await expect(page.getByText(/Your Turn/i)).toBeVisible();
  });

  test("Roll button is enabled on the player's turn", async ({ page }) => {
    await expect(
      page.getByRole("button", { name: /Roll dice/i }),
    ).toBeEnabled();
  });

  test("shows Computer's Turn banner and disables Roll after player scores", async ({
    page,
  }) => {
    // Player rolls once
    await page.getByRole("button", { name: /Roll dice/i }).click();

    // Score into Chance (always legal)
    const chanceBtn = page.getByRole("button", {
      name: /Chance: potential score/i,
    });
    await expect(chanceBtn).toBeVisible();
    await chanceBtn.click();

    // AI turn banner must appear immediately
    await expect(page.getByText(/Computer'?s Turn/i)).toBeVisible();
    // Roll button must be disabled while AI plays
    await expect(
      page.getByRole("button", { name: /Roll dice/i }),
    ).toBeDisabled();
  });

  test("control returns to player after AI completes its turn", async ({
    page,
  }) => {
    await page.getByRole("button", { name: /Roll dice/i }).click();

    const chanceBtn = page.getByRole("button", {
      name: /Chance: potential score/i,
    });
    await expect(chanceBtn).toBeVisible();
    await chanceBtn.click();

    // Wait for AI to finish — Easy AI takes up to ~2.5 s per turn; allow 10 s
    await expect(page.getByText(/Your Turn/i)).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole("button", { name: /Roll dice/i })).toBeEnabled({
      timeout: 10000,
    });
  });

  test("round advances after both players score", async ({ page }) => {
    await page.getByRole("button", { name: /Roll dice/i }).click();

    const chanceBtn = page.getByRole("button", {
      name: /Chance: potential score/i,
    });
    await expect(chanceBtn).toBeVisible();
    await chanceBtn.click();

    // Wait for AI turn to complete
    await expect(page.getByText(/Your Turn/i)).toBeVisible({ timeout: 10000 });
    // Both players have now scored round 1 → should be Round 2
    await expect(page.getByText("Round 2 / 13")).toBeVisible({ timeout: 5000 });
  });
});
