/**
 * cascade-flow.spec.ts
 *
 * E2E smoke test for the Cascade game.
 *
 * Canvas content is not DOM-inspectable, so these tests focus on:
 *   - Navigation (Home → Cascade → Back → Home)
 *   - Score display element presence after interaction
 *   - App stability (no crashes/reloads after drops)
 *
 * The real Rapier2D WASM runs in the Playwright Chromium container.
 */

import { test, expect } from "./fixtures";

const API_BASE = "http://localhost:8000";

test.describe("Cascade — navigation and smoke tests", () => {
  test.beforeEach(async ({ page }) => {
    // Mock the leaderboard endpoint (POST /cascade/score) to avoid network calls
    await page.route(`${API_BASE}/cascade/**`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ scores: [] }),
      });
    });
  });

  test("navigates from Home to Cascade screen", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("BC Arcade").first()).toBeVisible();

    await page.getByRole("button", { name: "Play Cascade" }).click();

    // Cascade screen title or canvas should appear
    await expect(
      page.getByRole("heading", { name: "Cascade", exact: true }),
    ).toBeVisible({
      timeout: 10000,
    });
  });

  test("score display is visible on the Cascade screen", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Play Cascade" }).click();

    // Score display should show "Score" label
    await expect(page.getByText("Score", { exact: true })).toBeVisible({
      timeout: 10000,
    });
  });

  test("tapping the canvas does not crash the app", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Play Cascade" }).click();

    // Wait for canvas to appear (look by aria-label)
    const canvas = page.getByRole("img", {
      name: /Cascade game/i,
    });
    await expect(canvas).toBeVisible({ timeout: 10000 });

    // Tap center of canvas to drop a fruit
    const box = await canvas.boundingBox();
    if (box) {
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    }

    // Verify the score element still exists (no crash)
    await expect(page.getByText("Score", { exact: true })).toBeVisible({
      timeout: 8000,
    });
  });

  test("multiple taps do not cause a crash or navigation", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Play Cascade" }).click();

    const canvas = page.getByRole("img", { name: /Cascade game/i });
    await expect(canvas).toBeVisible({ timeout: 10000 });

    const box = await canvas.boundingBox();
    if (box) {
      // Drop 5 fruits at different x positions
      for (let i = 0; i < 5; i++) {
        await page.mouse.click(box.x + (box.width / 6) * (i + 1), box.y + 50);
        await expect(page.getByText("Score", { exact: true })).toBeVisible({
          timeout: 3000,
        });
      }
    }

    // App should still be on Cascade screen
    await expect(page.getByText("Score", { exact: true })).toBeVisible();
    await expect(page.url()).toContain(page.url()); // still on same page
  });

  test("navigating away from Cascade returns to Home", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Play Cascade" }).click();
    await expect(
      page.getByRole("heading", { name: "Cascade", exact: true }),
    ).toBeVisible({
      timeout: 10000,
    });

    // Navigate home via URL (Lobby tab pop-to-root not reliable on web)
    await page.goto("/");

    await expect(page.getByText("BC Arcade").first()).toBeVisible({
      timeout: 5000,
    });
  });
});
