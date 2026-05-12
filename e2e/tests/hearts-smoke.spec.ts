/**
 * hearts-smoke.spec.ts — GH #1142
 *
 * Smoke tests: navigation, difficulty picker, hand render, and trick area visibility.
 * All backend calls are intercepted — no running backend needed.
 */

import { test, expect } from "@playwright/test";
import { mockHeartsApi, gotoHearts } from "./helpers/hearts";
import { installEntitlementsMock } from "./helpers/api-mock";

test.describe("Hearts — smoke tests", () => {
  test("pre-game difficulty selector is visible on first load", async ({ page }) => {
    await mockHeartsApi(page);
    await installEntitlementsMock(page);
    await page.goto("/");
    await page.evaluate(() => localStorage.removeItem("hearts_game"));
    await page.getByRole("button", { name: "Play Hearts" }).click();
    await page.getByRole("heading", { name: "Hearts", exact: true }).waitFor({ timeout: 10_000 });
    await expect(
      page.getByRole("radiogroup", { name: "AI Difficulty" }),
    ).toBeVisible({ timeout: 5_000 });
  });

  test.describe("after starting game", () => {
    test.beforeEach(async ({ page }) => {
      await mockHeartsApi(page);
      // gotoHearts clears storage, navigates to Hearts, and clicks "Start Game"
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
