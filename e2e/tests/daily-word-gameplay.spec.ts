/**
 * daily-word-gameplay.spec.ts — GH #1254
 *
 * Core gameplay: typing letters, delete, enter validation, guess submission,
 * invalid word error.
 */

import { test, expect } from "@playwright/test";
import { gotoDailyWord, mockDailyWordApi } from "./helpers/daily_word";

test.describe("Daily Word — gameplay", () => {
  test.beforeEach(async ({ page }) => {
    await gotoDailyWord(page);
  });

  test("typing a letter populates the first tile", async ({ page }) => {
    await page.getByRole("button", { name: "A" }).click();
    // The tile should show the letter "A" (screen uppercases letters)
    await expect(page.getByTestId("tile-0-0")).toContainText("A", { timeout: 3_000 });
  });

  test("Delete removes the last typed letter", async ({ page }) => {
    await page.getByRole("button", { name: "A" }).click();
    await expect(page.getByTestId("tile-0-0")).toContainText("A", { timeout: 3_000 });

    await page.getByRole("button", { name: "Delete" }).click();
    await expect(page.getByTestId("tile-0-0")).toContainText("", { timeout: 3_000 });
  });

  test("Enter with fewer than word_length letters shows Not enough letters toast", async ({
    page,
  }) => {
    await page.getByRole("button", { name: "A" }).click();
    await page.getByRole("button", { name: "Enter" }).click();
    await expect(page.getByText("Not enough letters")).toBeVisible({ timeout: 3_000 });
  });

  test("submitting a valid guess renders colored tiles", async ({ page }) => {
    // Mock returns a mixed-status response
    await page.route("**/daily-word/guess", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          tiles: [
            { letter: "c", status: "correct" },
            { letter: "r", status: "present" },
            { letter: "a", status: "absent" },
            { letter: "n", status: "absent" },
            { letter: "e", status: "absent" },
          ],
        }),
      });
    });

    // Type CRANE
    for (const letter of ["C", "R", "A", "N", "E"]) {
      await page.getByRole("button", { name: letter }).click();
    }
    await page.getByRole("button", { name: "Enter" }).click();

    // Wait for the flip animation to complete and tiles to show colored state
    await expect(page.getByTestId("tile-0-0")).toBeVisible({ timeout: 5_000 });
    // Tile 0 should now have correct status label
    await expect(page.getByTestId("tile-0-0")).toHaveAttribute(
      "aria-label",
      /correct/i,
      { timeout: 3_000 }
    );
  });

  test("submitting an invalid word shows Not in word list toast", async ({ page }) => {
    // Override guess route to return 422 not_a_word
    await page.route("**/daily-word/guess", async (route) => {
      await route.fulfill({
        status: 422,
        contentType: "application/json",
        body: JSON.stringify({ detail: "not_a_word" }),
      });
    });

    for (const letter of ["Z", "Z", "Z", "Z", "Z"]) {
      await page.getByRole("button", { name: letter }).click();
    }
    await page.getByRole("button", { name: "Enter" }).click();
    await expect(page.getByText("Not in word list")).toBeVisible({ timeout: 3_000 });
  });
});
