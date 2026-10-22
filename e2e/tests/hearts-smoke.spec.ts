/**
 * hearts-smoke.spec.ts — GH #1142
 *
 * Smoke tests: navigation, the dealt table, hand render, and trick area visibility.
 * No running backend is needed: the routes this spec depends on are
 * intercepted with page.route(), and any other call (such as SyncWorker's
 * game sync) fails, which the app handles like being offline.
 */

import { test, expect } from "@playwright/test";
import { gotoHearts } from "./helpers/hearts";
import { installEntitlementsMock } from "./helpers/api-mock";

test.describe("Hearts — smoke tests", () => {
  test("a fresh Hearts screen deals the table, with no pre-game screen or opponent picker", async ({ page }) => {
    await installEntitlementsMock(page);
    await page.goto("/");
    await page.evaluate(() => localStorage.removeItem("hearts_game"));
    await page.getByRole("button", { name: "Play Hearts" }).click();
    await page.getByRole("heading", { name: "Hearts", exact: true }).waitFor({ timeout: 10_000 });
    // One CPU, so no opponent choice (#3489): the table is dealt without a Start Game step.
    await expect(page.getByLabel("Your hand, 13 cards")).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByRole("button", { name: "Start Game" })).toHaveCount(0);
    await expect(
      page.getByRole("radiogroup", { name: "Opponent Style" }),
    ).toHaveCount(0);
  });

  test.describe("after starting game", () => {
    test.beforeEach(async ({ page }) => {
      // gotoHearts clears storage and navigates to Hearts, which deals the table
      await gotoHearts(page);
    });

    test("navigates from Home to Hearts screen", async ({ page }) => {
      await expect(
        page.getByRole("heading", { name: "Hearts", exact: true }),
      ).toBeVisible();
    });

    test("player hand renders with 13 cards", async ({ page }) => {
      await expect(
        page.getByLabel("Your hand, 13 cards"),
      ).toBeVisible({ timeout: 5_000 });
    });

    test("trick area is visible", async ({ page }) => {
      await expect(
        page.getByLabel("Current trick"),
      ).toBeVisible({ timeout: 5_000 });
    });
  });
});
