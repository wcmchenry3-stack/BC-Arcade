/**
 * freecell-card-move.spec.ts — GH #1145, updated for smart single-tap (#2037)
 *
 * Single-tap smart auto-move: tapping a card with exactly one best destination
 * on the priority ladder (foundation > non-empty tableau > empty col > free cell)
 * executes the move immediately without a second tap.
 *
 * All backend calls are intercepted — no running backend needed.
 */

import { test, expect } from "@playwright/test";
import { mockFreecellApi, injectFreecellState } from "./helpers/freecell";

// One card (5♥) in tableau column 0; all free cells empty; no valid non-empty
// tableau or empty-column destination (rank 5 ≠ 13).
// Priority ladder: foundation (no), non-empty tableau (none), empty col (no —
// rank 5), free cell (yes — first available) → auto-moves to free cell 1.
const CARD_MOVE_STATE = {
  _v: 1,
  tableau: [[{ suit: "hearts", rank: 5 }], [], [], [], [], [], [], []],
  freeCells: [null, null, null, null],
  foundations: { spades: [], hearts: [], diamonds: [], clubs: [] },
  undoStack: [],
  isComplete: false,
  moveCount: 0,
};

test("single tap on a tableau card auto-moves it via the priority ladder", async ({
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

  // Single tap on 5♥ → auto-move to first free cell (no second tap needed).
  await page.getByLabel("5 of Hearts").click();

  // Move counter increments immediately — no second tap required.
  await expect(page.getByText("Moves: 1")).toBeVisible({ timeout: 3_000 });
});
