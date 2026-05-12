/**
 * mahjong-tile-interaction.spec.ts — GH #1146
 *
 * Tile interaction: tap the canvas at several locations, confirm the HUD
 * (SCORE / PAIRS) remains visible and no error alert is raised.
 *
 * Canvas layout is non-deterministic, so assertions target HUD visibility
 * and crash-freedom rather than specific tile-match outcomes.
 * All backend calls are intercepted — no running backend needed.
 */

import { test, expect } from "@playwright/test";
import { gotoMahjong, mockMahjongApi } from "./helpers/mahjong";

test.describe("Mahjong — tile interaction", () => {
  test.beforeEach(async ({ page }) => {
    await mockMahjongApi(page);
    await page.goto("/");
    await page.evaluate(() => {
      localStorage.removeItem("mahjong_game");
      localStorage.removeItem("mahjong_stats_v1");
    });
  });

  test("tapping the canvas leaves HUD visible and raises no error alert", async ({ page }) => {
    await gotoMahjong(page);
    const canvas = page.getByRole("img", { name: /Mahjong Solitaire/i });
    const box = await canvas.boundingBox();
    if (box) {
      const cx = box.x + box.width / 2;
      const cy = box.y + box.height / 2;
      await page.mouse.click(cx, cy);
      await page.mouse.click(cx - 40, cy);
      await page.mouse.click(cx + 40, cy);
    }
    await expect(page.getByText(/^SCORE\s+\d/).first()).toBeVisible();
    await expect(page.getByText(/^PAIRS\s+\d/).first()).toBeVisible();
    await expect(page.getByRole("alert")).not.toBeAttached();
  });
});
