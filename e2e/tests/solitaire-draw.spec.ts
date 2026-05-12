/**
 * solitaire-draw.spec.ts — GH #1143
 *
 * Draw mechanic: tap the stock pile, waste pile shows a face-up card,
 * and the move counter increments to 1.
 * All backend calls are intercepted — no running backend needed.
 */

import { test, expect } from "@playwright/test";
import { mockSolitaireApi, gotoSolitaire } from "./helpers/solitaire";

test("tap stock: waste shows face-up card and moves counter increments", async ({
  page,
}) => {
  await mockSolitaireApi(page);
  await gotoSolitaire(page);
  // Dismiss the pre-game draw-mode modal.
  await page.getByRole("button", { name: "Draw 1" }).click();
  await page.getByLabel("Solitaire board").waitFor({ timeout: 10_000 });

  // Confirm waste is empty before drawing.
  await expect(page.getByLabel("Empty waste pile")).toBeVisible({
    timeout: 5_000,
  });

  // Tap the stock pile to draw one card.
  await page.getByLabel(/Draw 1 from stock/).click();

  // Waste pile should now show a face-up card (any rank/suit).
  await expect(
    page.getByLabel(/of (?:Spades|Hearts|Diamonds|Clubs)$/).first(),
  ).toBeVisible({ timeout: 3_000 });

  // Move counter increments to 1.
  await expect(page.getByLabel("Moves: 1")).toBeVisible({ timeout: 3_000 });
});
