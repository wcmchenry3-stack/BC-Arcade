/**
 * solitaire-card-move.spec.ts — GH #1246, updated for smart single-tap (#2039)
 *
 * Covers the three solitaire card-move flows tested on Playwright/web:
 *   1. waste → tableau  (K♥ on empty board auto-moves in one tap)
 *   2. tableau → foundation  (A♠ auto-moves to foundation in one tap)
 *   3. multi-card run  (Q♣-J♥ run auto-moves onto K♦ in one tap on run base)
 *
 * Smart single-tap (#2039): an unambiguous first tap auto-executes the move
 * without a selection step. Boards with multiple equal-priority destinations
 * still use the select + second-tap flow (see solitaire-tableau-move.spec.ts).
 *
 * All backend calls are intercepted — no running backend required.
 *
 * Board states are injected via localStorage before navigation so the
 * pre-game draw-mode modal is bypassed (saved game is restored directly).
 */

import { test, expect } from "@playwright/test";
import { mockSolitaireApi, injectSolitaireState } from "./helpers/solitaire";

// ---------------------------------------------------------------------------
// Shared stock filler — keeps structural card counts valid without cluttering
// test state with 50+ manually listed cards.
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Test 1: waste → tableau
// Board:  waste = [K♥]   tableau col 0 = empty   stock = rest of deck
// Tap:    K♥ (waste) → empty col 0
// Expect: col 0 now has 1 card, move counter = 1
// ---------------------------------------------------------------------------
test("solitaire drag: waste → tableau (K♥ onto empty column)", async ({
  page,
}) => {
  const STATE = {
    _v: 1,
    drawMode: 1,
    tableau: [[], [], [], [], [], [], []],
    foundations: { spades: [], hearts: [], diamonds: [], clubs: [] },
    stock: stockCards(["hearts-13"]),
    waste: [{ suit: "hearts", rank: 13, faceUp: true }],
    score: 0,
    undoStack: [],
    isComplete: false,
    recycleCount: 0,
    events: [],
    startedAt: null,
    accumulatedMs: 0,
  };

  await mockSolitaireApi(page);
  await injectSolitaireState(page, STATE);

  await page.getByRole("button", { name: "Play Solitaire" }).click();
  await page
    .getByRole("heading", { name: "Solitaire", exact: true })
    .waitFor({ timeout: 10_000 });
  await page.getByLabel("Solitaire board").waitFor({ timeout: 10_000 });

  // Verify starting layout.
  await expect(page.getByLabel("K of Hearts")).toBeVisible({ timeout: 5_000 });
  await expect(page.getByLabel("Empty tableau column 1")).toBeVisible({
    timeout: 3_000,
  });

  // Smart tap: K♥ is a king with 7 empty columns → single unambiguous destination
  // (first empty column). One tap auto-executes the move.
  await page.getByLabel("K of Hearts").click();

  // Column 1 now has 1 card; move counter increments.
  await expect(page.getByLabel("Tableau column 1, 1 cards")).toBeVisible({
    timeout: 3_000,
  });
  await expect(page.getByText("Moves: 1")).toBeVisible({ timeout: 3_000 });
});

// ---------------------------------------------------------------------------
// Test 2: tableau → foundation
// Board:  col 0 = [A♠(fu)]   foundations all empty   stock = rest
// Tap:    A♠ (col 0) → empty Spades foundation  (select then tap)
// Expect: spades foundation gains 1 card; col 0 becomes empty
// ---------------------------------------------------------------------------
test("solitaire drag: tableau → foundation (A♠ to Spades foundation)", async ({
  page,
}) => {
  const STATE = {
    _v: 1,
    drawMode: 1,
    tableau: [
      [{ suit: "spades", rank: 1, faceUp: true }],
      [],
      [],
      [],
      [],
      [],
      [],
    ],
    foundations: { spades: [], hearts: [], diamonds: [], clubs: [] },
    stock: stockCards(["spades-1"]),
    waste: [],
    score: 0,
    undoStack: [],
    isComplete: false,
    recycleCount: 0,
    events: [],
    startedAt: null,
    accumulatedMs: 0,
  };

  await mockSolitaireApi(page);
  await injectSolitaireState(page, STATE);

  await page.getByRole("button", { name: "Play Solitaire" }).click();
  await page
    .getByRole("heading", { name: "Solitaire", exact: true })
    .waitFor({ timeout: 10_000 });
  await page.getByLabel("Solitaire board").waitFor({ timeout: 10_000 });

  await expect(page.getByLabel("A of Spades")).toBeVisible({ timeout: 5_000 });

  // Smart tap: A♠ is the top card with an empty spades foundation → unambiguous
  // foundation move. One tap auto-executes; no second tap to foundation needed.
  await page.getByLabel("A of Spades").click();

  // Col 0 is now empty; foundation updated.
  await expect(page.getByLabel("Empty tableau column 1")).toBeVisible({
    timeout: 3_000,
  });
  await expect(page.getByText("Moves: 1")).toBeVisible({ timeout: 3_000 });
});

// ---------------------------------------------------------------------------
// Test 3: multi-card tableau run
// Board:  col 0 = [K♦(fu)]   col 1 = [Q♣(fu), J♥(fu)]   stock = rest
// Tap:    Q♣ at col 1 index 0 → K♦ in col 0 (moves Q♣+J♥ as a run)
// Expect: col 0 has 3 cards; col 1 becomes empty
// ---------------------------------------------------------------------------
test("solitaire drag: multi-card run (Q♣-J♥ onto K♦)", async ({ page }) => {
  const STATE = {
    _v: 1,
    drawMode: 1,
    tableau: [
      [{ suit: "diamonds", rank: 13, faceUp: true }],
      [
        { suit: "clubs", rank: 12, faceUp: true },
        { suit: "hearts", rank: 11, faceUp: true },
      ],
      [],
      [],
      [],
      [],
      [],
    ],
    foundations: { spades: [], hearts: [], diamonds: [], clubs: [] },
    stock: stockCards(["diamonds-13", "clubs-12", "hearts-11"]),
    waste: [],
    score: 0,
    undoStack: [],
    isComplete: false,
    recycleCount: 0,
    events: [],
    startedAt: null,
    accumulatedMs: 0,
  };

  await mockSolitaireApi(page);
  await injectSolitaireState(page, STATE);

  await page.getByRole("button", { name: "Play Solitaire" }).click();
  await page
    .getByRole("heading", { name: "Solitaire", exact: true })
    .waitFor({ timeout: 10_000 });
  await page.getByLabel("Solitaire board").waitFor({ timeout: 10_000 });

  // Verify starting column counts.
  await expect(page.getByLabel("Tableau column 1, 1 cards")).toBeVisible({
    timeout: 5_000,
  });
  await expect(page.getByLabel("Tableau column 2, 2 cards")).toBeVisible({
    timeout: 3_000,
  });

  // Smart tap: click the base of the run (Q♣ at index 0). Q♣ is buried under
  // J♥ — its visible stripe is the top ~28px (FACE_UP_OFFSET); click within
  // that stripe so J♥'s SVG rect doesn't intercept. K♦ in col 1 is the single
  // valid non-empty destination → one tap auto-moves Q♣+J♥ as a run.
  await page.getByLabel("Q of Clubs").click({ position: { x: 26, y: 10 } });

  // Col 1 now has 3 cards (K♦, Q♣, J♥); col 2 is empty.
  await expect(page.getByLabel("Tableau column 1, 3 cards")).toBeVisible({
    timeout: 3_000,
  });
  await expect(page.getByLabel("Empty tableau column 2")).toBeVisible({
    timeout: 3_000,
  });
  await expect(page.getByText("Moves: 1")).toBeVisible({ timeout: 3_000 });
});
