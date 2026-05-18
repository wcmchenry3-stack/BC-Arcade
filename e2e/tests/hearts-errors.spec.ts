/**
 * hearts-errors.spec.ts — GH #1563
 *
 * Error-path coverage for Hearts.
 *
 * Covers:
 *   - Navigation (back to Home)
 *   - Invalid input: pass-phase confirm button disabled with < 3 cards selected
 *   - Server error display: 500 on hearts API — game hand still renders
 *   - Graceful recovery: hand area and trick area visible after server error
 *   - Corrupted localStorage fallback
 */

import { test, expect } from "@playwright/test";
import { mockHeartsApi, gotoHearts } from "./helpers/hearts";
import { installEntitlementsMock } from "./helpers/api-mock";

const API_BASE = "http://localhost:8000";

/** Navigate to Hearts and start a fresh game, bypassing the difficulty picker. */
async function startFreshHearts(
  page: Parameters<Parameters<typeof test>[1]>[0],
): Promise<void> {
  await installEntitlementsMock(page);
  await page.goto("/");
  await page.evaluate(() => localStorage.removeItem("hearts_game"));
  await page.getByRole("button", { name: "Play Hearts" }).click();
  await page
    .getByRole("heading", { name: "Hearts", exact: true })
    .waitFor({ timeout: 10_000 });
  await page.getByRole("button", { name: "Start Game" }).click();
  await page.getByLabel("Your hand, 13 cards").waitFor({ timeout: 5_000 });
}

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
  // Invalid input rejection — shared setup via nested describe
  // ---------------------------------------------------------------------------

  test.describe("pass-phase confirm button", () => {
    test.beforeEach(async ({ page }) => {
      await mockHeartsApi(page);
      await startFreshHearts(page);
    });

    test("is disabled when 0 cards are selected", async ({ page }) => {
      // aria-label includes the dynamic count, e.g. "Confirm — pass 0 selected cards"
      const confirmBtn = page.getByRole("button", {
        name: /Confirm — pass \d+ selected cards/,
      });
      await expect(confirmBtn).toBeDisabled({ timeout: 3_000 });
    });

    test("is disabled when fewer than 3 cards are selected", async ({
      page,
    }) => {
      // Select only 1 card — confirm must remain disabled
      await page.getByLabel("Your hand, 13 cards").getByRole("button").first().click();

      // aria-label includes the dynamic count, e.g. "Confirm — pass 1 selected cards"
      const confirmBtn = page.getByRole("button", {
        name: /Confirm — pass \d+ selected cards/,
      });
      await expect(confirmBtn).toBeDisabled({ timeout: 3_000 });
    });
  });

  // ---------------------------------------------------------------------------
  // Server error display — shared setup via nested describe
  // ---------------------------------------------------------------------------

  test.describe("hearts API 500", () => {
    test.beforeEach(async ({ page }) => {
      await page.route(`${API_BASE}/hearts/**`, async (route) => {
        await route.fulfill({ status: 500, body: "Internal Server Error" });
      });
      await startFreshHearts(page);
    });

    test("game still loads and hand renders despite server error", async ({
      page,
    }) => {
      // Game logic runs client-side — hand is dealt even with a backend 500
      await expect(page.getByLabel("Your hand, 13 cards")).toBeVisible({
        timeout: 5_000,
      });
    });

    // -------------------------------------------------------------------------
    // Graceful recovery
    // -------------------------------------------------------------------------

    test("trick area remains visible — game is fully playable after server error", async ({
      page,
    }) => {
      await expect(page.getByLabel("Your hand, 13 cards")).toBeVisible({
        timeout: 5_000,
      });
      await expect(page.getByLabel("Current trick")).toBeVisible({
        timeout: 5_000,
      });
    });
  });

  // ---------------------------------------------------------------------------
  // Corrupted localStorage fallback
  // ---------------------------------------------------------------------------

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
