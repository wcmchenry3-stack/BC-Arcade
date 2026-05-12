/**
 * freecell-card-move.spec.ts — GH #1145
 *
 * Card-move mechanic: tap a tableau card to select it, tap an empty free cell
 * slot, and confirm the move counter increments to 1.
 * All backend calls are intercepted — no running backend needed.
 */

import { test, expect } from "@playwright/test";
import { mockFreecellApi, injectFreecellState } from "./helpers/freecell";

// One card (5♥) in tableau column 0; free cells and foundations empty.
const CARD_MOVE_STATE = {
  _v: 1,
  tableau: [
    [{ suit: "hearts", rank: 5 }],
    [], [], [], [], [], [], [],
  ],
  freeCells: [null, null, null, null],
  foundations: { spades: [], hearts: [], diamonds: [], clubs: [] },
  undoStack: [],
  isComplete: false,
  moveCount: 0,
};

test("tap tableau card then tap free cell: card moves and counter increments", async ({
  page,
}) => {
  await mockFreecellApi(page);
  await injectFreecellState(page, CARD_MOVE_STATE);

  await page.getByRole("button", { name: "Play FreeCell" }).click();
  await page
    .getByRole("heading", { name: "FreeCell", exact: true })
    .waitFor({ timeout: 10_000 });

  await expect(page.getByLabel("FreeCell board").first()).toBeVisible({ timeout: 5_000 });

  // Tap 5♥ in the tableau to select it.
  await page.getByLabel("5 of Hearts").click();

  // Tap the empty free cell slot (cell 1 = index 0).
  await page.getByLabel("Empty free cell 1").click();

  // Move counter increments to 1.
  await expect(page.getByText("Moves: 1")).toBeVisible({ timeout: 3_000 });
});
