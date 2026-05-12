import { Page } from "@playwright/test";
import { installEntitlementsMock } from "./api-mock";

const API_BASE = "http://localhost:8000";
const STORAGE_KEY = "sudoku_game";

export async function mockSudokuApi(page: Page): Promise<void> {
  await page.route(`${API_BASE}/sudoku/**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ scores: [] }),
    });
  });
}

export async function gotoSudoku(page: Page): Promise<void> {
  await installEntitlementsMock(page);
  await page.goto("/");
  await page.evaluate((key) => localStorage.removeItem(key), STORAGE_KEY);
  await page.getByRole("button", { name: "Play Sudoku" }).click();
  await page
    .getByRole("heading", { name: "Sudoku", exact: true })
    .waitFor({ timeout: 10_000 });
}

export async function injectSudokuState(
  page: Page,
  partial: Record<string, unknown>,
): Promise<void> {
  await installEntitlementsMock(page);
  await page.goto("/");
  await page.evaluate(
    ([key, state]) =>
      localStorage.setItem(key as string, JSON.stringify(state)),
    [STORAGE_KEY, partial] as const,
  );
  await page.goto("/");
}
