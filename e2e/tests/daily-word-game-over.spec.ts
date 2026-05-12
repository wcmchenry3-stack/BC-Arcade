/**
 * daily-word-game-over.spec.ts — GH #1254
 *
 * Loss flow: inject LOSS_STATE, navigate to screen, verify loss modal contents.
 * GET /answer is mocked to return "crane".
 */

import { test, expect, type Page } from "@playwright/test";
import { injectDailyWordState, LOSS_STATE } from "./helpers/daily_word";

async function loadLossState(page: Page): Promise<void> {
  await injectDailyWordState(page, LOSS_STATE);
  // Mock answer endpoint
  await page.route("**/daily-word/answer**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ answer: "crane" }),
    });
  });
  await page.getByRole("button", { name: "Play Daily Word" }).click();
  await page.getByRole("heading", { name: "Daily Word" }).waitFor({ timeout: 10_000 });
}

test.describe("Daily Word — game over", () => {
  test("loss modal is visible after loading a lost state", async ({ page }) => {
    await loadLossState(page);
    await expect(page.getByText("Better luck tomorrow")).toBeVisible({ timeout: 5_000 });
  });

  test("loss modal shows the answer word", async ({ page }) => {
    await loadLossState(page);
    await expect(page.getByText(/The word was CRANE/i)).toBeVisible({ timeout: 5_000 });
  });

  test("loss modal shows next-word countdown", async ({ page }) => {
    await loadLossState(page);
    await expect(page.getByText("Next word in")).toBeVisible({ timeout: 5_000 });
  });
});
