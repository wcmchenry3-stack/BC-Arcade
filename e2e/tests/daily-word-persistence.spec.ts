/**
 * daily-word-persistence.spec.ts — GH #1254
 *
 * Persistence: state survives navigate-away and reload.
 */

import { test, expect } from "@playwright/test";
import { gotoDailyWord, injectDailyWordState, WIN_STATE } from "./helpers/daily_word";

test("Daily Word — typed letters in current row persist after navigate away and back", async ({
  page,
}) => {
  await gotoDailyWord(page);

  // Type a letter
  await page.getByRole("button", { name: "A" }).click();
  await expect(page.getByTestId("tile-0-0")).toContainText("A", { timeout: 3_000 });

  // Navigate away
  await page.goto("/");
  await page.getByRole("button", { name: "Play Daily Word" }).waitFor({ timeout: 10_000 });

  // Return
  await page.getByRole("button", { name: "Play Daily Word" }).click();
  await page.getByRole("heading", { name: "Daily Word" }).waitFor({ timeout: 10_000 });

  // The typed letter should still be there
  await expect(page.getByTestId("tile-0-0")).toContainText("A", { timeout: 5_000 });
});

test("Daily Word — submitted row colors persist after page reload", async ({ page }) => {
  await injectDailyWordState(page, {
    _v: 1,
    puzzle_id: "2026-05-03:en",
    word_length: 5,
    language: "en",
    rows: [
      {
        tiles: [
          { letter: "s", status: "correct" },
          { letter: "t", status: "absent" },
          { letter: "o", status: "absent" },
          { letter: "r", status: "present" },
          { letter: "e", status: "absent" },
        ],
        submitted: true,
      },
      ...Array.from({ length: 5 }, () => ({
        tiles: Array.from({ length: 5 }, () => ({ letter: "", status: "empty" as const })),
        submitted: false,
      })),
    ],
    current_row: 1,
    keyboard_state: { s: "correct", t: "absent", o: "absent", r: "present", e: "absent" },
    is_complete: false,
    won: false,
    completed_at: null,
  });

  await page.getByRole("button", { name: "Play Daily Word" }).click();
  await page.getByRole("heading", { name: "Daily Word" }).waitFor({ timeout: 10_000 });

  // First tile should be labeled as correct
  await expect(page.getByTestId("tile-0-0")).toBeVisible({ timeout: 5_000 });
  await expect(page.getByTestId("tile-0-0")).toHaveAttribute("aria-label", /correct/i, {
    timeout: 3_000,
  });

  // Reload
  await page.reload();
  await page.getByRole("button", { name: "Play Daily Word" }).waitFor({ timeout: 10_000 });
  await page.getByRole("button", { name: "Play Daily Word" }).click();
  await page.getByRole("heading", { name: "Daily Word" }).waitFor({ timeout: 10_000 });

  // Tile should still show correct status
  await expect(page.getByTestId("tile-0-0")).toHaveAttribute("aria-label", /correct/i, {
    timeout: 5_000,
  });
});

test("Daily Word — completed win state shows win modal after reload", async ({ page }) => {
  await injectDailyWordState(page, WIN_STATE);
  await page.getByRole("button", { name: "Play Daily Word" }).click();
  await page.getByRole("heading", { name: "Daily Word" }).waitFor({ timeout: 10_000 });
  await expect(page.getByText("Brilliant!")).toBeVisible({ timeout: 5_000 });

  await page.reload();
  await page.getByRole("button", { name: "Play Daily Word" }).waitFor({ timeout: 10_000 });
  await page.getByRole("button", { name: "Play Daily Word" }).click();
  await page.getByRole("heading", { name: "Daily Word" }).waitFor({ timeout: 10_000 });
  await expect(page.getByText("Brilliant!")).toBeVisible({ timeout: 5_000 });
});
