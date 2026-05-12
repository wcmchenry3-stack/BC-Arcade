/**
 * daily-word-smoke.spec.ts — GH #1254
 *
 * Smoke tests: navigation, tile grid structure, keyboard presence.
 */

import { test, expect } from "@playwright/test";
import { gotoDailyWord } from "./helpers/daily_word";

test.describe("Daily Word — smoke", () => {
  test("navigates from Home to Daily Word screen", async ({ page }) => {
    await gotoDailyWord(page);
    await expect(page.getByRole("heading", { name: "Daily Word" })).toBeVisible({ timeout: 5_000 });
  });

  test("tile grid renders 6 rows", async ({ page }) => {
    await gotoDailyWord(page);
    const rows = page.locator('[data-testid^="daily-word-row-"]');
    await expect(rows).toHaveCount(6, { timeout: 5_000 });
  });

  test("keyboard renders letter keys and action buttons", async ({ page }) => {
    await gotoDailyWord(page);
    await expect(page.getByRole("button", { name: "A" })).toBeVisible({ timeout: 5_000 });
    await expect(page.getByRole("button", { name: "Delete" })).toBeVisible({ timeout: 5_000 });
    await expect(page.getByRole("button", { name: "Enter" })).toBeVisible({ timeout: 5_000 });
  });
});
