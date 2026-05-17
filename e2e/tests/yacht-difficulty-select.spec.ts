/**
 * yacht-difficulty-select.spec.ts
 *
 * GH #1602 — VS mode picker shown on fresh Yacht game start.
 *
 * Verifies that:
 *   - The picker presents Solo and VS Computer buttons
 *   - The AI Difficulty radio group (Easy / Medium / Hard) is visible
 *   - Medium is selected by default
 *   - Solo dismisses the picker and starts a solo game
 *   - VS Computer (with a chosen difficulty) starts a VS game
 */

import { test, expect } from "./fixtures";

test.describe("Yacht — VS mode picker (#1602)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => localStorage.removeItem("yacht_game_v2"));
    await page.goto("/");
    await page.getByRole("button", { name: "Play Yacht" }).click();
  });

  test("shows Solo and VS Computer buttons", async ({ page }) => {
    await expect(page.getByRole("button", { name: /^Solo$/i })).toBeVisible();
    await expect(
      page.getByRole("button", { name: /^VS Computer$/i }),
    ).toBeVisible();
  });

  test("shows AI Difficulty radio group", async ({ page }) => {
    await expect(
      page.getByRole("radiogroup", { name: /AI Difficulty/i }),
    ).toBeVisible();
  });

  test("difficulty radios Easy, Medium, Hard are all present", async ({
    page,
  }) => {
    await expect(page.getByRole("radio", { name: /^Easy$/i })).toBeVisible();
    await expect(page.getByRole("radio", { name: /^Medium$/i })).toBeVisible();
    await expect(page.getByRole("radio", { name: /^Hard$/i })).toBeVisible();
  });

  test("Medium is selected by default", async ({ page }) => {
    await expect(page.getByRole("radio", { name: /^Medium$/i })).toBeChecked();
  });

  test("Solo dismisses the picker and starts a solo game", async ({ page }) => {
    await page.getByRole("button", { name: /^Solo$/i }).click();
    await expect(page.getByText("Round 1 / 13")).toBeVisible();
    // Picker must be gone
    await expect(
      page.getByRole("button", { name: /^VS Computer$/i }),
    ).not.toBeVisible();
  });

  test("VS Computer starts a VS game after selecting Easy", async ({ page }) => {
    await page.getByRole("radio", { name: /^Easy$/i }).click();
    await page.getByRole("button", { name: /^VS Computer$/i }).click();
    await expect(page.getByText("Round 1 / 13")).toBeVisible();
  });

  test("VS Computer with default Medium difficulty starts a VS game", async ({
    page,
  }) => {
    await page.getByRole("button", { name: /^VS Computer$/i }).click();
    await expect(page.getByText("Round 1 / 13")).toBeVisible();
  });
});
