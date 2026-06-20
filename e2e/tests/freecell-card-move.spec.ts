/**
 * freecell-card-move.spec.ts — GH #1145, updated for tap-to-select (#2128)
 *
 * Tap-to-select: first tap selects a card, second tap on a valid destination
 * executes the move. (Smart single-tap auto-move was reverted in #2128.)
 *
 * All backend calls are intercepted — no running backend needed.
 */

import { test, expect } from "@playwright/test";
import { mockFreecellApi, injectFreecellState } from "./helpers/freecell";

// One card (5♥) in tableau column 0; all free cells empty.
const CARD_MOVE_STATE = {
  _v: 1,
  tableau: [[{ suit: "hearts", rank: 5 }], [], [], [], [], [], [], []],
  freeCells: [null, null, null, null],
  foundations: { spades: [], hearts: [], diamonds: [], clubs: [] },
  undoStack: [],
  isComplete: false,
  moveCount: 0,
};

test("tap-to-select: two taps move a tableau card to a free cell", async ({
  page,
}) => {
  await mockFreecellApi(page);
  await injectFreecellState(page, CARD_MOVE_STATE);

  await page.getByRole("button", { name: "Play FreeCell" }).click();
  await page
    .getByRole("heading", { name: "FreeCell", exact: true })
    .waitFor({ timeout: 10_000 });

  await expect(page.getByLabel("FreeCell board").first()).toBeVisible({
    timeout: 5_000,
  });

  // Tap 1: select 5♥. Tap 2: send to the first empty free cell.
  await page.getByLabel("5 of Hearts").click();
  await page.getByLabel("Empty free cell 1").click();

  await expect(page.getByText("Moves: 1")).toBeVisible({ timeout: 3_000 });
});
