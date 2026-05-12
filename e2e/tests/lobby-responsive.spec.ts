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
});
