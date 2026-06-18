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

// Board designed for two-tap error coverage (#2037 smart-tap rework).
//
// 2♠ (col 0) has two equally-ranked destinations (3♥ col 1, 3♦ col 2) so the
// first tap enters selection state instead of auto-moving.  4♠ (col 3) is an
// invalid destination for 2♠ (same colour — black on black).
//
// Error test flow:
//   tap 2♠ → ambiguous → selection
//   tap 4♠ → invalid (same colour) → counter stays 0, selection preserved
//   tap 3♥  → valid move → counter becomes 1
const BOARD_STATE = {
  _v: 1,
  tableau: [
    [{ suit: "spades", rank: 2 }],
    [{ suit: "hearts", rank: 3 }],
    [{ suit: "diamonds", rank: 3 }],
    [{ suit: "spades", rank: 4 }],
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

    // 2♠ has two equal-priority destinations → first tap enters selection.
    // 4♠ is an invalid destination (same colour — black on black).
    await page.getByLabel("2 of Spades").click();
    await page.getByLabel("4 of Spades").click();

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

    // 2♠ ambiguous → selection; 4♠ is invalid (same colour) → counter stays 0.
    await page.getByLabel("2 of Spades").click();
    await page.getByLabel("4 of Spades").click();
    await expect(page.getByText("Moves: 0")).toBeVisible({ timeout: 3_000 });

    // 2♠ remains selected — tap a valid destination to confirm recovery.
    await page.getByLabel("3 of Hearts").click();

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
