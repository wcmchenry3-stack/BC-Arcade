/**
 * mahjong-errors.spec.ts — GH #1563
 *
 * Error-path coverage for Mahjong Solitaire.
 *
 * Covers:
 *   - Navigation (back to Home)
 *   - Invalid input: rapid canvas taps do not crash the app
 *   - Server error display: 500 on mahjong API — canvas still loads
 *   - Graceful recovery: HUD visible and game continues after errors
 *   - Corrupted localStorage fallback
 */

import { test, expect } from "@playwright/test";
import { gotoMahjong, mockMahjongApi } from "./helpers/mahjong";

const API_BASE = "http://localhost:8000";

test.describe("Mahjong — error paths", () => {
  // ---------------------------------------------------------------------------
  // Navigation
  // ---------------------------------------------------------------------------

  test("navigating away from Mahjong returns to Home", async ({ page }) => {
    await mockMahjongApi(page);
    await gotoMahjong(page);

    await page.goto("/");
    await expect(page.getByText("BC Arcade").first()).toBeVisible({
      timeout: 10_000,
    });
  });

  // ---------------------------------------------------------------------------
  // Invalid input rejection
  // ---------------------------------------------------------------------------

  test("rapid canvas taps on non-matching tiles do not crash the app", async ({
    page,
  }) => {
    await mockMahjongApi(page);
    await page.goto("/");
    await page.evaluate(() => {
      localStorage.removeItem("mahjong_game");
      localStorage.removeItem("mahjong_stats_v1");
    });
    await gotoMahjong(page);

    const canvas = page.getByRole("img", { name: /Mahjong Solitaire/i });
    const box = await canvas.boundingBox();
    if (box) {
      const cx = box.x + box.width / 2;
      const cy = box.y + box.height / 2;
      // Rapid taps at offset positions unlikely to hit a matching pair
      for (let i = 0; i < 5; i++) {
        await page.mouse.click(cx + i * 20 - 40, cy);
      }
    }

    // HUD must remain visible — game did not crash
    await expect(page.getByText(/^SCORE\s+\d/).first()).toBeVisible({
      timeout: 3_000,
    });
    await expect(page.getByText(/^PAIRS\s+\d/).first()).toBeVisible();
    await expect(page.getByRole("alert")).not.toBeAttached();
  });

  // ---------------------------------------------------------------------------
  // Server error display
  // ---------------------------------------------------------------------------

  test("mahjong API 500 on load — canvas still renders", async ({ page }) => {
    await page.route(`${API_BASE}/mahjong/**`, async (route) => {
      await route.fulfill({ status: 500, body: "Internal Server Error" });
    });
    await page.goto("/");
    await page.evaluate(() => {
      localStorage.removeItem("mahjong_game");
      localStorage.removeItem("mahjong_stats_v1");
    });
    await page.getByRole("button", { name: "Play Mahjong Solitaire" }).click();
    await page
      .getByRole("heading", { name: "Mahjong Solitaire", exact: true })
      .waitFor({ timeout: 10_000 });

    // Canvas renders despite backend 500 (game logic is client-side)
    await expect(
      page.getByRole("img", { name: /Mahjong Solitaire/i }),
    ).toBeVisible({ timeout: 15_000 });
  });

  // ---------------------------------------------------------------------------
  // Graceful recovery
  // ---------------------------------------------------------------------------

  test("HUD remains visible after mahjong API 500 and canvas interaction", async ({
    page,
  }) => {
    await page.route(`${API_BASE}/mahjong/**`, async (route) => {
      await route.fulfill({ status: 500, body: "Internal Server Error" });
    });
    await page.goto("/");
    await page.evaluate(() => {
      localStorage.removeItem("mahjong_game");
      localStorage.removeItem("mahjong_stats_v1");
    });
    await page.getByRole("button", { name: "Play Mahjong Solitaire" }).click();
    await page
      .getByRole("heading", { name: "Mahjong Solitaire", exact: true })
      .waitFor({ timeout: 10_000 });
    await page
      .getByRole("img", { name: /Mahjong Solitaire/i })
      .waitFor({ timeout: 15_000 });

    // Interact with the board
    const canvas = page.getByRole("img", { name: /Mahjong Solitaire/i });
    const box = await canvas.boundingBox();
    if (box) {
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    }

    // HUD still visible — game continues despite earlier server error
    await expect(page.getByText(/^SCORE\s+\d/).first()).toBeVisible({
      timeout: 3_000,
    });
    await expect(page.getByRole("alert")).not.toBeAttached();
  });

  test("corrupted mahjong_game localStorage — fresh board loads", async ({
    page,
  }) => {
    await mockMahjongApi(page);
    await page.goto("/");
    await page.evaluate(() => {
      localStorage.setItem("mahjong_game", "not-valid-json{{{");
      localStorage.removeItem("mahjong_stats_v1");
    });
    await page.goto("/");
    await page.getByRole("button", { name: "Play Mahjong Solitaire" }).click();
    await page
      .getByRole("heading", { name: "Mahjong Solitaire", exact: true })
      .waitFor({ timeout: 10_000 });

    // Corrupted state is ignored — a fresh canvas renders
    await expect(
      page.getByRole("img", { name: /Mahjong Solitaire/i }),
    ).toBeVisible({ timeout: 15_000 });
  });
});
