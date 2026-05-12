/**
 * solitaire-persistence.spec.ts — GH #1143
 *
 * Persistence: inject a mid-game state with a known card (5♥) in the waste
 * pile, navigate to Solitaire, verify the card is visible, navigate away,
 * return, and confirm the waste card is still the same.
 *
 * All backend calls are intercepted — no running backend needed.
 */

import { test, expect } from "@playwright/test";
import { mockSolitaireApi, injectSolitaireState } from "./helpers/solitaire";

// 5♥ is the top waste card; stock has the remaining 51 cards face-down.
function remainingStock() {
  const suits = ["spades", "hearts", "diamonds", "clubs"] as const;
  const ranks = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13] as const;
  return suits.flatMap((suit) =>
    ranks
      .filter((rank) => !(suit === "hearts" && rank === 5))
      .map((rank) => ({ suit, rank, faceUp: false })),
  );
}

const PERSIST_STATE = {
  _v: 1,
  drawMode: 1,
  tableau: [[], [], [], [], [], [], []],
  foundations: { spades: [], hearts: [], diamonds: [], clubs: [] },
  stock: remainingStock(),
  waste: [{ suit: "hearts", rank: 5, faceUp: true }],
  score: 0,
  undoStack: [],
  isComplete: false,
  recycleCount: 0,
  events: [],
};

test("waste card persists after navigating away and back", async ({ page }) => {
  await mockSolitaireApi(page);
  await injectSolitaireState(page, PERSIST_STATE);

  await page.getByRole("button", { name: "Play Solitaire" }).click();
  await page
    .getByRole("heading", { name: "Solitaire", exact: true })
    .waitFor({ timeout: 10_000 });

  // Injected state puts 5♥ on top of the waste.
  await expect(page.getByLabel("5 of Hearts")).toBeVisible({ timeout: 5_000 });

  // Navigate away — SolitaireScreen saves state on blur/unmount.
  await page.goto("/");
  await page.getByText("BC Arcade").first().waitFor();

  // Return to Solitaire.
  await page.getByRole("button", { name: "Play Solitaire" }).click();
  await page
    .getByRole("heading", { name: "Solitaire", exact: true })
    .waitFor({ timeout: 10_000 });

  // Waste card should be the same after resume.
  await expect(page.getByLabel("5 of Hearts")).toBeVisible({ timeout: 5_000 });
});
