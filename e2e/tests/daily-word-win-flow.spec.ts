/**
 * daily-word-win-flow.spec.ts — GH #1254
 *
 * Win flow: inject WIN_STATE, navigate to screen, verify win modal contents.
 */

import { test, expect, type Page } from "@playwright/test";
import {
  injectDailyWordState,
  WIN_STATE,
} from "./helpers/daily_word";

async function loadWinState(page: Page): Promise<void> {
  await injectDailyWordState(page, WIN_STATE);
  await page.getByRole("button", { name: "Play Daily Word" }).click();
  await page.getByRole("heading", { name: "Daily Word" }).waitFor({ timeout: 10_000 });
}

test.describe("Daily Word — win flow", () => {
  test("win modal is visible after loading a won state", async ({ page }) => {
    await loadWinState(page);
    await expect(page.getByText("Brilliant!")).toBeVisible({ timeout: 5_000 });
  });

  test("win modal shows guess count", async ({ page }) => {
    await loadWinState(page);
    // WIN_STATE won on row 3 (3 submitted rows)
    await expect(page.getByText(/in 3 guesses/i)).toBeVisible({ timeout: 5_000 });
  });

  test("win modal shows Share button", async ({ page }) => {
    await loadWinState(page);
    await expect(page.getByRole("button", { name: "Share" })).toBeVisible({ timeout: 5_000 });
  });

  test("win modal shows next-word countdown in HH:MM:SS format", async ({ page }) => {
    await loadWinState(page);
    await expect(page.getByText(/\d{2}:\d{2}:\d{2}/)).toBeVisible({ timeout: 5_000 });
  });
});
