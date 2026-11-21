/**
 * lobby-responsive.spec.ts — GH #356
 *
 * Verifies that the HomeScreen lobby renders correctly at narrow viewports
 * (Galaxy Fold outer display ~280 px) and standard widths, and that all
 * game cards are reachable regardless of viewport width.
 */

import { test, expect } from "@playwright/test";
import { installEntitlementsMock } from "./helpers/api-mock";

test.describe("Lobby — responsive layout", () => {
  test("all game cards visible at Galaxy Fold width (280 px)", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      viewport: { width: 280, height: 653 },
    });
    const page = await context.newPage();
    await installEntitlementsMock(page);
    await page.goto("/");

    // All four game cards must be visible and tappable
    await expect(page.getByRole("button", { name: "Play Yacht" })).toBeVisible({
      timeout: 10000,
    });
    await expect(
      page.getByRole("button", { name: "Play Cascade" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Play Blackjack" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Play 2048" })).toBeVisible();

    await context.close();
  });

  test("all game cards visible at 360 px viewport (2-col breakpoint)", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      viewport: { width: 360, height: 740 },
    });
    const page = await context.newPage();
    await installEntitlementsMock(page);
    await page.goto("/");

    await expect(page.getByRole("button", { name: "Play Yacht" })).toBeVisible({
      timeout: 10000,
    });
    await expect(
      page.getByRole("button", { name: "Play Cascade" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Play Blackjack" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Play 2048" })).toBeVisible();

    await context.close();
  });

  test("all game cards visible at standard mobile width (390 px)", async ({
    page,
  }) => {
    await installEntitlementsMock(page);
    await page.goto("/");

    await expect(page.getByRole("button", { name: "Play Yacht" })).toBeVisible({
      timeout: 10000,
    });
    await expect(
      page.getByRole("button", { name: "Play Cascade" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Play Blackjack" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Play 2048" })).toBeVisible();
  });

  test("AppHeader visible on home screen", async ({ page }) => {
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "BC Arcade", exact: true }),
    ).toBeVisible({
      timeout: 10000,
    });
  });

  test("game cards are tappable at Galaxy Fold width", async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: 280, height: 653 },
    });
    const page = await context.newPage();
    await installEntitlementsMock(page);
    await page.goto("/");

    // Tapping Cascade should navigate to Cascade screen
    await page.getByRole("button", { name: "Play Cascade" }).click();
    await expect(
      page.getByRole("heading", { name: "Cascade", exact: true }),
    ).toBeVisible({ timeout: 10000 });

    await context.close();
  });

  // #4005: every tile in a row has the same width and height, at a phone and a tablet width.
  // Cascade and Star Swarm are left locked so rows mix locked and unlocked tiles: before
  // #4005 a locked tile was 2 pt taller. (The web build shows all 12 games, which fill every
  // row at 2, 3 and 4 columns, so spacer cells are covered by HomeScreen.test.tsx instead.)
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 1024, height: 768 },
  ]) {
    test(`tiles in a row share one width and height at ${viewport.width}x${viewport.height}`, async ({
      browser,
    }) => {
      const context = await browser.newContext({ viewport });
      const page = await context.newPage();
      await installEntitlementsMock(page, ["blackjack", "hearts", "mahjong"]);
      await page.goto("/");
      await expect(page.getByTestId("game-tile-yacht")).toBeVisible({
        timeout: 10000,
      });
      await expect(
        page.getByRole("button", { name: /Cascade.*Locked/ }),
      ).toBeVisible();

      const tiles = page.locator("[data-testid^='game-tile-']");
      const count = await tiles.count();
      expect(count).toBeGreaterThan(1);
      const boxes = [];
      for (let i = 0; i < count; i++) {
        const box = await tiles.nth(i).boundingBox();
        expect(box).not.toBeNull();
        boxes.push(box!);
      }

      // Group tiles into rows by their top edge (within 2 px).
      const rows: (typeof boxes)[] = [];
      for (const box of boxes) {
        const row = rows.find((r) => Math.abs(r[0].y - box.y) < 2);
        if (row) row.push(box);
        else rows.push([box]);
      }
      for (const row of rows) {
        for (const box of row) {
          expect(Math.abs(box.height - row[0].height)).toBeLessThan(0.5);
          expect(Math.abs(box.width - row[0].width)).toBeLessThan(0.5);
        }
      }
      // Every tile in the grid keeps the same column width, including the last row's.
      const widths = boxes.map((b) => b.width);
      expect(Math.max(...widths) - Math.min(...widths)).toBeLessThan(0.5);

      await context.close();
    });
  }
});
