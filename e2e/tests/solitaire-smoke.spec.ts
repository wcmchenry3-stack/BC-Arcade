/**
 * solitaire-smoke.spec.ts — GH #1143
 *
 * Smoke tests: navigation, 7 tableau columns render, stock pile visible.
 * All backend calls are intercepted — no running backend needed.
 */

import { test, expect } from "@playwright/test";
import { mockSolitaireApi, gotoSolitaire } from "./helpers/solitaire";

test.describe("Solitaire — smoke tests", () => {
  test.beforeEach(async ({ page }) => {
    await mockSolitaireApi(page);
    await gotoSolitaire(page);
    // Choose Draw 1 to dismiss the pre-game modal and deal a fresh board.
    await page.getByRole("button", { name: "Draw 1" }).click();
    await page
      .getByLabel("Solitaire board")
      .waitFor({ timeout: 10_000 });
  });

  test("navigates from Home to Solitaire screen", async ({ page }) => {
    await expect(
      page.getByRole("heading", { name: "Solitaire", exact: true }),
    ).toBeVisible();
  });

  test("7 tableau columns render after deal", async ({ page }) => {
    for (let col = 1; col <= 7; col++) {
      await expect(
        page
          .getByLabel(`Tableau column ${col}, ${col} cards`)
          .or(page.getByLabel(`Empty tableau column ${col}`)),
      ).toBeVisible({ timeout: 5_000 });
    }
  });

  test("stock pile is visible", async ({ page }) => {
    await expect(
      page.getByLabel(/Draw 1 from stock/),
    ).toBeVisible({ timeout: 5_000 });
  });
});
