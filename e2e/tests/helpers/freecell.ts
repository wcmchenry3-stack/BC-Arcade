import { Page } from "@playwright/test";

const API_BASE = "http://localhost:8000";
const STORAGE_KEY = "freecell_game";

export async function mockFreecellApi(page: Page): Promise<void> {
  await page.route(`${API_BASE}/freecell/**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ scores: [] }),
    });
  });
}

export async function gotoFreecell(page: Page): Promise<void> {
  await page.goto("/");
  await page.evaluate((key) => localStorage.removeItem(key), STORAGE_KEY);
  await page.getByRole("button", { name: "Play FreeCell" }).click();
  await page
    .getByRole("heading", { name: "FreeCell", exact: true })
    .waitFor({ timeout: 10_000 });
}

export async function injectFreecellState(
  page: Page,
  partial: Record<string, unknown>,
): Promise<void> {
  await page.goto("/");
  await page.evaluate(
    ([key, state]) =>
      localStorage.setItem(key as string, JSON.stringify(state)),
    [STORAGE_KEY, partial] as const,
  );
  await page.goto("/");
}
