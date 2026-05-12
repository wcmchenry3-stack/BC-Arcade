/**
 * daily-word-errors.spec.ts — GH #1254
 *
 * Error states: load failure, guess 422, guess 500.
 */

import { test, expect } from "@playwright/test";
import { installEntitlementsMock } from "./helpers/api-mock";

test.describe("Daily Word — errors", () => {
  test("GET /today returns 500 — load-error message shown", async ({ page }) => {
    await installEntitlementsMock(page);

    await page.route("**/daily-word/**", async (route) => {
      await route.fulfill({ status: 500, body: "Internal Server Error" });
    });

    await page.goto("/");
    await page.evaluate(() => localStorage.removeItem("daily_word_state_v1"));
    await page.getByRole("button", { name: "Play Daily Word" }).click();
    await page.getByRole("heading", { name: "Daily Word" }).waitFor({ timeout: 10_000 });

    await expect(page.getByText("Could not load today's puzzle")).toBeVisible({ timeout: 5_000 });
  });

  test("POST /guess returns 422 — Not in word list toast shown", async ({ page }) => {
    await installEntitlementsMock(page);

    await page.route("**/daily-word/**", async (route) => {
      const url = route.request().url();
      const method = route.request().method();
      if (url.includes("/daily-word/today")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ puzzle_id: "2026-05-03:en", word_length: 5 }),
        });
      } else if (url.includes("/daily-word/guess") && method === "POST") {
        await route.fulfill({
          status: 422,
          contentType: "application/json",
          body: JSON.stringify({ detail: "not_a_word" }),
        });
      } else {
        await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
      }
    });

    await page.goto("/");
    await page.evaluate(() => localStorage.removeItem("daily_word_state_v1"));
    await page.getByRole("button", { name: "Play Daily Word" }).click();
    await page.getByRole("heading", { name: "Daily Word" }).waitFor({ timeout: 10_000 });

    for (const letter of ["Z", "Z", "Z", "Z", "Z"]) {
      await page.getByRole("button", { name: letter }).click();
    }
    await page.getByRole("button", { name: "Enter" }).click();
    await expect(page.getByText("Not in word list")).toBeVisible({ timeout: 3_000 });
  });

  test("POST /guess returns 500 — could not submit toast shown", async ({ page }) => {
    await installEntitlementsMock(page);

    await page.route("**/daily-word/**", async (route) => {
      const url = route.request().url();
      const method = route.request().method();
      if (url.includes("/daily-word/today")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ puzzle_id: "2026-05-03:en", word_length: 5 }),
        });
      } else if (url.includes("/daily-word/guess") && method === "POST") {
        await route.fulfill({ status: 500, body: "Server Error" });
      } else {
        await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
      }
    });

    await page.goto("/");
    await page.evaluate(() => localStorage.removeItem("daily_word_state_v1"));
    await page.getByRole("button", { name: "Play Daily Word" }).click();
    await page.getByRole("heading", { name: "Daily Word" }).waitFor({ timeout: 10_000 });

    for (const letter of ["C", "R", "A", "N", "E"]) {
      await page.getByRole("button", { name: letter }).click();
    }
    await page.getByRole("button", { name: "Enter" }).click();
    await expect(page.getByText("Could not submit your guess")).toBeVisible({ timeout: 3_000 });
  });
});
