/**
 * mahjong-smoke.spec.ts — GH #913
 *
 * Smoke tests for Mahjong Solitaire: navigation, board render, HUD display,
 * the overflow menu, and crash-free board interaction.
 *
 * All mahjong API calls are intercepted via page.route() — no backend needed.
 */

import { test, expect } from "@playwright/test";
import { gotoMahjong } from "./helpers/mahjong";
import { installEntitlementsMock } from "./helpers/api-mock";

test.describe("Mahjong — smoke tests", () => {
  test.beforeEach(async ({ page }) => {
    await installEntitlementsMock(page);
    await page.goto("/");
    await page.evaluate(() => {
      localStorage.removeItem("mahjong_game");
      localStorage.removeItem("mahjong_stats_v1");
    });
  });

  test("navigates from Home to Mahjong screen", async ({ page }) => {
    await page.getByRole("button", { name: "Play Mahjong Solitaire" }).click();
    await expect(
      page.getByRole("heading", { name: "Mahjong Solitaire", exact: true }),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("tile board renders after navigation", async ({ page }) => {
    await gotoMahjong(page);
    await expect(
      page.getByRole("img", {
        name: /Mahjong Solitaire — tap two matching free tiles/i,
      }),
    ).toBeVisible();
  });

  test("score and remaining-tile display is visible", async ({ page }) => {
    await gotoMahjong(page);
    await expect(page.getByText(/^SCORE\s+\d/).first()).toBeVisible();
    await expect(page.getByText(/^PAIRS\s+\d/).first()).toBeVisible();
  });

  // #2627: the Scoreboard item led to an untranslated "No scoreboard
  // available" fallback. It is hidden until #2635 points it at the stats screen.
  test("overflow menu has no Scoreboard item", async ({ page }) => {
    await gotoMahjong(page);
    await page.getByRole("button", { name: "More options" }).click();
    await expect(
      page.getByRole("menuitem", { name: "New Game" }),
    ).toBeVisible();
    await expect(
      page.getByRole("menuitem", { name: "Scoreboard" }),
    ).toHaveCount(0);
  });

  test("interacting with the board does not crash the app", async ({
    page,
  }) => {
    await gotoMahjong(page);
    const canvas = page.getByRole("img", { name: /Mahjong Solitaire/i });
    const box = await canvas.boundingBox();
    if (box) {
      await page.mouse.click(
        box.x + box.width / 2,
        box.y + box.height / 2,
      );
    }
    await expect(page.getByRole("alert")).not.toBeVisible();
    await expect(canvas).toBeVisible();
  });
});

test("Mahjong Solitaire card shows premium gate on home screen when not entitled", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: /Mahjong Solitaire — Coming soon/ }),
  ).toBeVisible({ timeout: 10_000 });
});
