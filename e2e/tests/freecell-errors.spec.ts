/**
 * freecell-errors.spec.ts — GH #1563
 *
 * Error-path coverage for FreeCell.
 *
 * Covers:
 *   - Navigation (back to Home)
 *   - Invalid input: moving a card to a wrong-rank tableau slot does not
 *     increment the move counter
 *   - Server error display: 500 on freecell API — board still renders
 *   - Graceful recovery: board remains usable after an invalid move attempt
 *   - Corrupted localStorage fallback
 */

import { test, expect } from "@playwright/test";
import {
  mockFreecellApi,
  gotoFreecell,
  injectFreecellState,
} from "./helpers/freecell";

const API_BASE = "http://localhost:8000";

// Board: 5♥ in column 0, 3♣ in column 1, free cells empty.
// FreeCell rule: a card may only be placed on a card that is one rank higher
// and the opposite colour. 5♥ (red) needs a black 6; placing it on 3♣
// (wrong rank) is illegal.
const BOARD_STATE = {
  _v: 1,
  tableau: [
    [{ suit: "hearts", rank: 5 }],
    [{ suit: "clubs", rank: 3 }],
    [],
    [],
    [],
    [],
    [],
    [],
  ],
  freeCells: [null, null, null, null],
  foundations: { spades: [], hearts: [], diamonds: [], clubs: [] },
  undoStack: [],
  isComplete: false,
  moveCount: 0,
};

test.describe("FreeCell — error paths", () => {
  // ---------------------------------------------------------------------------
  // Navigation
  // ---------------------------------------------------------------------------

  test("navigating away from FreeCell returns to Home", async ({ page }) => {
    await mockFreecellApi(page);
    await gotoFreecell(page);

    await page.goto("/");
    await expect(page.getByText("BC Arcade").first()).toBeVisible({
      timeout: 10_000,
    });
  });

  // ---------------------------------------------------------------------------
  // Invalid input rejection
  // ---------------------------------------------------------------------------

  test("moving a card to a wrong-rank tableau slot does not increment move counter", async ({
    page,
  }) => {
    await mockFreecellApi(page);
    await injectFreecellState(page, BOARD_STATE);

    await page.getByRole("button", { name: "Play FreeCell" }).click();
    await page
      .getByRole("heading", { name: "FreeCell", exact: true })
      .waitFor({ timeout: 10_000 });
    await page.getByLabel("FreeCell board").first().waitFor({ timeout: 5_000 });

    // Select 5♥ then attempt to place it on 3♣ (wrong rank — illegal)
    await page.getByLabel("5 of Hearts").click();
    await page.getByLabel("3 of Clubs").click();

    // Move counter must remain at 0 — illegal move was rejected
    await expect(page.getByText("Moves: 0")).toBeVisible({ timeout: 3_000 });
  });

  // ---------------------------------------------------------------------------
  // Server error display
  // ---------------------------------------------------------------------------

  test("freecell API 500 on load — board still renders", async ({ page }) => {
    await page.route(`${API_BASE}/freecell/**`, async (route) => {
      await route.fulfill({ status: 500, body: "Internal Server Error" });
    });
    await gotoFreecell(page);

    // Board renders despite server error — game logic is client-side
    await expect(page.getByLabel("FreeCell board").first()).toBeVisible({
      timeout: 5_000,
    });
    await expect(page.getByText(/Moves:\s*\d+/)).toBeVisible({
      timeout: 5_000,
    });
  });

  // ---------------------------------------------------------------------------
  // Graceful recovery
  // ---------------------------------------------------------------------------

  test("board is usable after an invalid move attempt", async ({ page }) => {
    await mockFreecellApi(page);
    await injectFreecellState(page, BOARD_STATE);

    await page.getByRole("button", { name: "Play FreeCell" }).click();
    await page
      .getByRole("heading", { name: "FreeCell", exact: true })
      .waitFor({ timeout: 10_000 });
    await page.getByLabel("FreeCell board").first().waitFor({ timeout: 5_000 });

    // Attempt an invalid move (wrong rank)
    await page.getByLabel("5 of Hearts").click();
    await page.getByLabel("3 of Clubs").click();
    await expect(page.getByText("Moves: 0")).toBeVisible({ timeout: 3_000 });

    // 5♥ remains selected after the failed move — go straight to the free cell
    await page.getByLabel("Empty free cell 1").click();

    // Move counter increments — game recovered from the failed attempt
    await expect(page.getByText("Moves: 1")).toBeVisible({ timeout: 3_000 });
  });

  test("corrupted freecell_game localStorage — fresh game loads", async ({
    page,
  }) => {
    await mockFreecellApi(page);
    // Inject corrupted storage before navigating; do NOT call gotoFreecell
    // because it clears the storage key before loading.
    await page.goto("/");
    await page.evaluate(() =>
      localStorage.setItem("freecell_game", "not-valid-json{{{"),
    );
    await page.goto("/");
    await page.getByRole("button", { name: "Play FreeCell" }).click();
    await page
      .getByRole("heading", { name: "FreeCell", exact: true })
      .waitFor({ timeout: 10_000 });

    // Corrupted state is discarded — a fresh board renders
    await expect(page.getByLabel("FreeCell board").first()).toBeVisible({
      timeout: 5_000,
    });
    await expect(page.getByText(/Moves:\s*0/)).toBeVisible({ timeout: 5_000 });
  });
});
