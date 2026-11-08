/**
 * mahjong-smoke.spec.ts — GH #913
 *
 * Smoke tests for Mahjong Solitaire: navigation, board render, HUD display,
 * the overflow menu, and crash-free board interaction.
 *
 * No running backend is needed: the routes this spec depends on are
 * intercepted with page.route(), and any other call (such as SyncWorker's
 * game sync) fails, which the app handles like being offline.
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

  test("play clock and remaining-tile display is visible", async ({ page }) => {
    await gotoMahjong(page);
    await expect(page.getByText(/^TIME\s+\d+:\d{2}$/).first()).toBeVisible();
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

  // #3614: on a phone the header holds the title alone (the controls are in a bottom action
  // bar), so it is not truncated, and the board, the action bar and the tab bar don't overlap.
  test("on a 390 px phone: full title, and the action bar between board and tab bar", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoMahjong(page);
    const title = page.getByRole("heading", {
      name: "Mahjong Solitaire",
      exact: true,
    });
    const clipped = await title.evaluate(
      (el) => el.scrollWidth > el.clientWidth,
    );
    expect(clipped).toBe(false);

    const bar = page.getByTestId("mahjong-action-bar");
    for (const id of [
      "mahjong-undo-button",
      "mahjong-hint-button",
      "mahjong-shuffle-button",
    ]) {
      await expect(bar.getByTestId(id)).toBeVisible();
    }
    const viewport = (await page
      .getByTestId("mahjong-board-viewport")
      .boundingBox())!;
    const barBox = (await bar.boundingBox())!;
    const lobby = (await page
      .getByRole("tab", { name: /Lobby/i })
      .boundingBox())!;
    expect(viewport.y + viewport.height).toBeLessThanOrEqual(barBox.y + 1);
    expect(barBox.y + barBox.height).toBeLessThanOrEqual(lobby.y);
  });

  // #3612: double-tap zooms the board to readable tiles and back to fit.
  test("double-tap zooms in on the board and back to fit", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoMahjong(page);
    const board = page.getByRole("img", { name: /Mahjong Solitaire/i });
    const fit = (await board.boundingBox())!;
    await page.mouse.dblclick(fit.x + fit.width * 0.25, fit.y + fit.height / 2);
    await expect
      .poll(async () => (await board.boundingBox())!.width)
      .toBeGreaterThan(fit.width * 1.5);
    await expect(page.getByTestId("mahjong-minimap")).toBeVisible();
    await page.mouse.dblclick(200, 400);
    await expect
      .poll(async () => (await board.boundingBox())!.width)
      .toBeCloseTo(fit.width, 0);
    await expect(page.getByTestId("mahjong-minimap")).toHaveCount(0);
  });

  // #3612: two quick taps far apart (selecting a pair) are not a double-tap.
  test("two quick taps far apart do not zoom the board", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoMahjong(page);
    const board = page.getByRole("img", { name: /Mahjong Solitaire/i });
    const fit = (await board.boundingBox())!;
    const y = fit.y + fit.height / 2;
    await page.mouse.click(fit.x + fit.width * 0.2, y);
    await page.mouse.click(fit.x + fit.width * 0.8, y);
    await page.waitForTimeout(500);
    expect((await board.boundingBox())!.width).toBeCloseTo(fit.width, 0);
    await expect(page.getByTestId("mahjong-minimap")).toHaveCount(0);
  });

  // #3612: the widest layouts open zoomed in on their top-left corner, with the mini-map;
  // tapping the mini-map moves the view there.
  test("a wide layout opens zoomed in, and the mini-map moves the view", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await installEntitlementsMock(page);
    await page.goto("/");
    await page.evaluate(() => {
      localStorage.removeItem("mahjong_game");
      localStorage.setItem(
        "@mahjong/progress",
        JSON.stringify({
          unlockedLayouts: [
            "turtle",
            "pyramid",
            "square",
            "arena",
            "four_rivers",
            "butterfly",
          ],
          currentLayoutId: null,
          currentState: null,
        }),
      );
    });
    await page.goto("/");
    await page.getByRole("button", { name: "Play Mahjong Solitaire" }).click();
    await page.getByRole("button", { name: "Butterfly", exact: true }).click();
    const board = page.getByRole("img", { name: /Mahjong Solitaire/i });
    await board.waitFor({ timeout: 15_000 });
    const minimap = page.getByTestId("mahjong-minimap");
    await expect(minimap).toBeVisible();
    const start = (await board.boundingBox())!;
    expect(start.width).toBeGreaterThan(390); // zoomed in past the screen
    const map = (await minimap.boundingBox())!;
    await minimap.click({ position: { x: map.width - 8, y: map.height / 2 } });
    await expect
      .poll(async () => (await board.boundingBox())!.x)
      .toBeLessThan(start.x - 100);
  });

  test("the deal id is in the overflow menu", async ({ page }) => {
    await gotoMahjong(page);
    await page.getByRole("button", { name: "More options" }).click();
    await expect(page.getByTestId("nav-menu-info")).toHaveText(/^DEAL #\S+$/);
  });

  test("interacting with the board does not crash the app", async ({
    page,
  }) => {
    await gotoMahjong(page);
    const canvas = page.getByRole("img", { name: /Mahjong Solitaire/i });
    const box = await canvas.boundingBox();
    if (box) {
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
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
    page.getByRole("button", {
      name: /Mahjong Solitaire — Locked, tap to unlock/,
    }),
  ).toBeVisible({ timeout: 10_000 });
});
