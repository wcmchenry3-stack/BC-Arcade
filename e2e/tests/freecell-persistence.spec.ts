/**
 * freecell-persistence.spec.ts — GH #1145
 *
 * Persistence: inject a mid-game state where one move has already been made
 * (move counter = 1, 5♥ in free cell 0), navigate to FreeCell, verify the
 * move counter, navigate away, return, and confirm the counter is still 1.
 *
 * All backend calls are intercepted — no running backend needed.
 */

import { test, expect } from "@playwright/test";
import { mockFreecellApi, injectFreecellState } from "./helpers/freecell";

// One move has been made: 5♥ was moved from the tableau to free cell 0.
const PERSIST_STATE = {
  _v: 1,
  tableau: [[], [], [], [], [], [], [], []],
  freeCells: [{ suit: "hearts", rank: 5 }, null, null, null],
  foundations: { spades: [], hearts: [], diamonds: [], clubs: [] },
  undoStack: [],
  isComplete: false,
  moveCount: 1,
};

test("move counter persists after navigating away and back", async ({ page }) => {
  await mockFreecellApi(page);
  await injectFreecellState(page, PERSIST_STATE);

  await page.getByRole("button", { name: "Play FreeCell" }).click();
  await page
    .getByRole("heading", { name: "FreeCell", exact: true })
    .waitFor({ timeout: 10_000 });

  // Injected state has moveCount = 1.
  await expect(page.getByText("Moves: 1")).toBeVisible({ timeout: 5_000 });

  // Navigate away — FreeCellScreen saves state on state change.
  await page.goto("/");
  await page.getByText("BC Arcade").first().waitFor();

  // Return to FreeCell.
  await page.getByRole("button", { name: "Play FreeCell" }).click();
  await page
    .getByRole("heading", { name: "FreeCell", exact: true })
    .waitFor({ timeout: 10_000 });

  // Move counter should still be 1 after resume.
  await expect(page.getByText("Moves: 1")).toBeVisible({ timeout: 5_000 });
});
