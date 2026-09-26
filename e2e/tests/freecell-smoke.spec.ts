/**
 * freecell-smoke.spec.ts — GH #910
 *
 * Smoke tests for FreeCell: navigation, HUD display, board accessibility,
 * and crash-free interaction.
 *
 * FreeCell's board is DOM-based (React Native View components), not canvas.
 * No running backend is needed: the routes this spec depends on are
 * intercepted with page.route(), and any other call (such as SyncWorker's
 * game sync) fails, which the app handles like being offline.
 */

import { test, expect } from "@playwright/test";
import { gotoFreecell } from "./helpers/freecell";

test.describe("FreeCell — smoke tests", () => {
  test.beforeEach(async ({ page }) => {
    await gotoFreecell(page);
  });

  test("navigates from Home to FreeCell screen", async ({ page }) => {
    await expect(
      page.getByRole("heading", { name: "FreeCell", exact: true }),
    ).toBeVisible();
  });

  test("move counter is visible", async ({ page }) => {
    await expect(page.getByText(/Moves:\s*\d+/)).toBeVisible({ timeout: 5_000 });
  });

  test("board region is accessible", async ({ page }) => {
    await expect(
      page.getByLabel("FreeCell board").first(),
    ).toBeVisible({ timeout: 5_000 });
  });

  test("interacting with the board does not crash the app", async ({ page }) => {
    const board = page.getByLabel("FreeCell board").first();
    await expect(board).toBeVisible({ timeout: 5_000 });

    const box = await board.boundingBox();
    if (box) {
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    }

    await expect(page.getByRole("alert")).not.toBeVisible();
    await expect(page.getByText(/Moves:\s*\d+/)).toBeVisible({ timeout: 5_000 });
  });
});
