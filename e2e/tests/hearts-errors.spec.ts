/**
 * hearts-errors.spec.ts — GH #1563
 *
 * Error-path coverage for Hearts.
 *
 * Covers:
 *   - Navigation (back to Home)
 *   - Invalid input: pass-phase confirm button disabled with < 3 cards selected
 *   - Server error display: 500 on hearts API — game hand still renders
 *   - Graceful recovery: hand area visible and playable after server error
 *   - Corrupted localStorage fallback
 */

import { test, expect } from "@playwright/test";
import { mockHeartsApi, gotoHearts, injectHeartsState } from "./helpers/hearts";
import { installEntitlementsMock } from "./helpers/api-mock";

test.describe("Hearts — error paths", () => {
  // ---------------------------------------------------------------------------
  // Navigation
  // ---------------------------------------------------------------------------

  test("navigating away from Hearts returns to Home", async ({ page }) => {
    await mockHeartsApi(page);
    await gotoHearts(page);

    await page.goto("/");
    await expect(page.getByText("BC Arcade").first()).toBeVisible({
      timeout: 10_000,
    });
  });

  // ---------------------------------------------------------------------------
  // Invalid input rejection
  // ---------------------------------------------------------------------------

  test("pass-phase confirm button is disabled when fewer than 3 cards are selected", async ({
    page,
  }) => {
    await mockHeartsApi(page);
    await installEntitlementsMock(page);
    await page.goto("/");
    await page.evaluate(() => localStorage.removeItem("hearts_game"));
    await page.getByRole("button", { name: "Play Hearts" }).click();
    await page
      .getByRole("heading", { name: "Hearts", exact: true })
      .waitFor({ timeout: 10_000 });
    // Dismiss difficulty picker to start fresh game
    await page.getByRole("button", { name: "Start Game" }).click();

    await expect(page.getByLabel("Your hand, 13 cards")).toBeVisible({
      timeout: 5_000,
    });

    // Select only 1 card — confirm should remain disabled
    const handArea = page.getByLabel("Your hand, 13 cards");
    await handArea.getByRole("button").first().click();

    const confirmBtn = page.getByRole("button", {
      name: "Confirm — pass 3 selected cards",
    });
    await expect(confirmBtn).toBeDisabled({ timeout: 3_000 });
  });

  test("pass-phase confirm button is disabled when 0 cards are selected", async ({
    page,
  }) => {
    await mockHeartsApi(page);
    await installEntitlementsMock(page);
    await page.goto("/");
    await page.evaluate(() => localStorage.removeItem("hearts_game"));
    await page.getByRole("button", { name: "Play Hearts" }).click();
    await page
      .getByRole("heading", { name: "Hearts", exact: true })
      .waitFor({ timeout: 10_000 });
    await page.getByRole("button", { name: "Start Game" }).click();

    await expect(page.getByLabel("Your hand, 13 cards")).toBeVisible({
      timeout: 5_000,
    });

    // No cards selected — confirm must be disabled immediately
    const confirmBtn = page.getByRole("button", {
      name: "Confirm — pass 3 selected cards",
    });
    await expect(confirmBtn).toBeDisabled({ timeout: 3_000 });
  });

  // ---------------------------------------------------------------------------
  // Server error display
  // ---------------------------------------------------------------------------

  test("hearts API 500 — game still loads and hand renders", async ({ page }) => {
    await page.route("**/hearts/**", async (route) => {
      await route.fulfill({ status: 500, body: "Internal Server Error" });
    });
    await installEntitlementsMock(page);
    await page.goto("/");
    await page.evaluate(() => localStorage.removeItem("hearts_game"));
    await page.getByRole("button", { name: "Play Hearts" }).click();
    await page
      .getByRole("heading", { name: "Hearts", exact: true })
      .waitFor({ timeout: 10_000 });
    await page.getByRole("button", { name: "Start Game" }).click();

    // Despite API 500, game logic runs client-side — hand is dealt
    await expect(page.getByLabel("Your hand, 13 cards")).toBeVisible({
      timeout: 5_000,
    });
  });

  // ---------------------------------------------------------------------------
  // Graceful recovery
  // ---------------------------------------------------------------------------

  test("trick area remains visible after hearts API 500", async ({ page }) => {
    await page.route("**/hearts/**", async (route) => {
      await route.fulfill({ status: 500, body: "Internal Server Error" });
    });
    await installEntitlementsMock(page);
    await page.goto("/");
    await page.evaluate(() => localStorage.removeItem("hearts_game"));
    await page.getByRole("button", { name: "Play Hearts" }).click();
    await page
      .getByRole("heading", { name: "Hearts", exact: true })
      .waitFor({ timeout: 10_000 });
    await page.getByRole("button", { name: "Start Game" }).click();

    // Both the hand and the trick area remain accessible for play
    await expect(page.getByLabel("Your hand, 13 cards")).toBeVisible({
      timeout: 5_000,
    });
    await expect(page.getByLabel("Current trick")).toBeVisible({
      timeout: 5_000,
    });
  });

  test("corrupted hearts_game localStorage — fresh game loads with difficulty picker", async ({
    page,
  }) => {
    await mockHeartsApi(page);
    await installEntitlementsMock(page);
    await page.goto("/");
    await page.evaluate(() =>
      localStorage.setItem("hearts_game", "not-valid-json{{{"),
    );
    await page.goto("/");
    await page.getByRole("button", { name: "Play Hearts" }).click();
    await page
      .getByRole("heading", { name: "Hearts", exact: true })
      .waitFor({ timeout: 10_000 });

    // Corrupted state is discarded — difficulty picker appears for a fresh game
    await expect(
      page.getByRole("radiogroup", { name: "Opponent Style" }),
    ).toBeVisible({ timeout: 5_000 });
  });
});
