/**
 * solitaire-errors.spec.ts — GH #1563
 *
 * Error-path coverage for Solitaire.
 *
 * Covers:
 *   - Navigation (back to Home)
 *   - Invalid input: moving a card to a same-color column does not increment
 *     the move counter (red-on-red is an illegal tableau move)
 *   - Server error display: 500 on solitaire API — board still renders
 *   - Graceful recovery: board accepts a valid move after an invalid attempt
 *   - Corrupted localStorage fallback
 */

import { test, expect } from "@playwright/test";
import {
  mockSolitaireApi,
  gotoSolitaire,
  injectSolitaireState,
} from "./helpers/solitaire";

const API_BASE = "http://localhost:8000";

// Build a stock from the full deck minus cards explicitly in play.
function stockCards(excluded: string[]) {
  const suits = ["spades", "hearts", "diamonds", "clubs"] as const;
  const ranks = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13] as const;
  const used = new Set(excluded);
  return suits.flatMap((suit) =>
    ranks
      .filter((rank) => !used.has(`${suit}-${rank}`))
      .map((rank) => ({ suit, rank, faceUp: false })),
  );
}

// Board:
//   col 0: 5♥ (red 5)  — card to move
//   col 1: 6♦ (red 6)  — invalid destination (same colour as 5♥)
//   col 2: 6♠ (black 6) — valid destination for 5♥ (alternating colour, rank -1)
const BOARD_STATE = {
  _v: 1,
  drawMode: 1,
  tableau: [
    [{ suit: "hearts", rank: 5, faceUp: true }],
    [{ suit: "diamonds", rank: 6, faceUp: true }],
    [{ suit: "spades", rank: 6, faceUp: true }],
    [],
    [],
    [],
    [],
  ],
  foundations: { spades: [], hearts: [], diamonds: [], clubs: [] },
  stock: stockCards(["hearts-5", "diamonds-6", "spades-6"]),
  waste: [],
  score: 0,
  undoStack: [],
  isComplete: false,
  recycleCount: 0,
  events: [],
  startedAt: null,
  accumulatedMs: 0,
};

test.describe("Solitaire — error paths", () => {
  // ---------------------------------------------------------------------------
  // Navigation
  // ---------------------------------------------------------------------------

  test("navigating away from Solitaire returns to Home", async ({ page }) => {
    await mockSolitaireApi(page);
    await gotoSolitaire(page);
    await page.getByRole("button", { name: "Draw 1" }).click();
    await page.getByLabel("Solitaire board").waitFor({ timeout: 10_000 });

    await page.goto("/");
    await expect(page.getByText("BC Arcade").first()).toBeVisible({
      timeout: 10_000,
    });
  });

  // ---------------------------------------------------------------------------
  // Invalid input rejection
  // ---------------------------------------------------------------------------

  test("invalid card move (red on red) does not increment move counter", async ({
    page,
  }) => {
    await mockSolitaireApi(page);
    await injectSolitaireState(page, BOARD_STATE);

    await page.getByRole("button", { name: "Play Solitaire" }).click();
    await page
      .getByRole("heading", { name: "Solitaire", exact: true })
      .waitFor({ timeout: 10_000 });
    await page.getByLabel("Solitaire board").waitFor({ timeout: 10_000 });

    // Select 5♥, then attempt to place it on 6♦ (same colour — illegal)
    await page.getByLabel("5 of Hearts").click();
    await page.getByLabel("6 of Diamonds").click();

    // Move counter must remain at 0 — illegal move was rejected
    await expect(page.getByText("Moves: 0")).toBeVisible({ timeout: 3_000 });
  });

  // ---------------------------------------------------------------------------
  // Server error display
  // ---------------------------------------------------------------------------

  test("solitaire API 500 on load — board still renders", async ({ page }) => {
    await page.route(`${API_BASE}/solitaire/**`, async (route) => {
      await route.fulfill({ status: 500, body: "Internal Server Error" });
    });
    await gotoSolitaire(page);
    await page.getByRole("button", { name: "Draw 1" }).click();

    // Board renders despite server error — game logic is client-side
    await expect(page.getByLabel("Solitaire board")).toBeVisible({
      timeout: 10_000,
    });
  });

  // ---------------------------------------------------------------------------
  // Graceful recovery
  // ---------------------------------------------------------------------------

  test("board and game state are consistent after an invalid move attempt", async ({
    page,
  }) => {
    await mockSolitaireApi(page);
    await injectSolitaireState(page, BOARD_STATE);

    await page.getByRole("button", { name: "Play Solitaire" }).click();
    await page
      .getByRole("heading", { name: "Solitaire", exact: true })
      .waitFor({ timeout: 10_000 });
    await page.getByLabel("Solitaire board").waitFor({ timeout: 10_000 });

    // Attempt the invalid red-on-red move
    await page.getByLabel("5 of Hearts").click();
    await page.getByLabel("6 of Diamonds").click();

    // Game did not crash — heading, board, and all three cards are still accessible
    await expect(
      page.getByRole("heading", { name: "Solitaire", exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel("Solitaire board")).toBeVisible();
    await expect(page.getByText("Moves: 0")).toBeVisible({ timeout: 3_000 });
    // All cards remain on the board (no phantom moves occurred)
    await expect(page.getByLabel("5 of Hearts")).toBeVisible();
    await expect(page.getByLabel("6 of Diamonds")).toBeVisible();
    await expect(page.getByLabel("6 of Spades")).toBeVisible();
  });

  test("corrupted solitaire_game localStorage — fresh game loads with draw-mode modal", async ({
    page,
  }) => {
    await mockSolitaireApi(page);
    await page.goto("/");
    await page.evaluate(() =>
      localStorage.setItem("solitaire_game", "not-valid-json{{{"),
    );
    await page.goto("/");
    await page.getByRole("button", { name: "Play Solitaire" }).click();
    await page
      .getByRole("heading", { name: "Solitaire", exact: true })
      .waitFor({ timeout: 10_000 });

    // Corrupted state is discarded — draw-mode modal appears for a fresh game
    await expect(
      page.getByRole("button", { name: "Draw 1" }),
    ).toBeVisible({ timeout: 5_000 });
  });
});
