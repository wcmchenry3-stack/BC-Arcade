/**
 * solitaire-tableau-move.spec.ts — GH #1143, updated for tap-to-select (#2128)
 *
 * Tableau-to-tableau move: inject a board with 7♥ on column 1 and
 * 8♠ on column 2. Two taps: first selects 7♥, second on 8♠ executes move.
 * (Smart single-tap auto-move was reverted in #2128.)
 *
 * All backend calls are intercepted — no running backend needed.
 */

import { test, expect } from "@playwright/test";
import { mockSolitaireApi, injectSolitaireState } from "./helpers/solitaire";

// 7♥ is alone in column 1; 8♠ is the face-up top of column 2.
// All other 50 cards sit in the stock so the state is structurally valid.
const r = (rank: number) => rank;
function stockCards() {
  const suits = ["spades", "hearts", "diamonds", "clubs"] as const;
  const ranks = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13] as const;
  const used = new Set(["hearts-7", "spades-9", "spades-8"]);
  return suits.flatMap((suit) =>
    ranks
      .filter((rank) => !used.has(`${suit}-${rank}`))
      .map((rank) => ({ suit, rank, faceUp: false })),
  );
}

const TABLEAU_MOVE_STATE = {
  _v: 1,
  drawMode: 1,
  tableau: [
    [{ suit: "hearts", rank: r(7), faceUp: true }],
    [
      { suit: "spades", rank: r(9), faceUp: false },
      { suit: "spades", rank: r(8), faceUp: true },
    ],
    [],
    [],
    [],
    [],
    [],
  ],
  foundations: { spades: [], hearts: [], diamonds: [], clubs: [] },
  stock: stockCards(),
  waste: [],
  score: 0,
  undoStack: [],
  isComplete: false,
  recycleCount: 0,
  events: [],
};

test("tableau-to-tableau: move 7♥ from column 1 onto 8♠ in column 2", async ({
  page,
}) => {
  await mockSolitaireApi(page);
  await injectSolitaireState(page, TABLEAU_MOVE_STATE);

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
    timeout: 5_000,
  });

  // Tap 1: select 7♥. Tap 2: place onto 8♠ in column 2.
  await page.getByLabel("7 of Hearts").click();
  await page.getByLabel("8 of Spades").click();

  // Column 1 is now empty; column 2 gained one card (now 3).
  await expect(page.getByLabel("Empty tableau column 1")).toBeVisible({
    timeout: 3_000,
  });
  await expect(page.getByLabel("Tableau column 2, 3 cards")).toBeVisible({
    timeout: 3_000,
  });
});
