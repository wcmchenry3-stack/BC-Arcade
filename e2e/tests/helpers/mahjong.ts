/**
 * Shared helpers for Mahjong e2e tests.
 */

import { Page } from "@playwright/test";

const API_BASE = "http://localhost:8000";

/** Mock all mahjong API endpoints so tests don't depend on a running backend. */
export async function mockMahjongApi(page: Page): Promise<void> {
  await page.route(`${API_BASE}/mahjong/**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ scores: [] }),
    });
  });
}

/** Navigate from Home to Mahjong and wait for the board canvas to be ready. */
export async function gotoMahjong(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: "Play Mahjong Solitaire" }).click();
  await page
    .getByRole("heading", { name: "Mahjong Solitaire", exact: true })
    .waitFor({ timeout: 10_000 });
  // If there is no saved game, the layout select screen is shown first.
  // Pick the Turtle layout (the only one unlocked by default) to reach the board.
  try {
    await page
      .getByRole("button", { name: "Turtle", exact: true })
      .waitFor({ timeout: 2_000 });
    await page.getByRole("button", { name: "Turtle", exact: true }).click();
  } catch {
    // No layout select — a saved game was resumed automatically.
  }
  await page
    .getByRole("img", { name: /Mahjong Solitaire/i })
    .waitFor({ timeout: 15_000 });
}

/** Inject a MahjongState snapshot into localStorage and reload the home page. */
export async function injectMahjongState(
  page: Page,
  partial: Record<string, unknown>,
): Promise<void> {
  await page.goto("/");
  await page.evaluate(
    ([key, state]) =>
      localStorage.setItem(key as string, JSON.stringify(state)),
    ["mahjong_game", partial] as const,
  );
  await page.goto("/");
}

/** Inject a MahjongProgress snapshot into localStorage and reload the home page. */
export async function injectMahjongProgress(
  page: Page,
  progress: Record<string, unknown>,
): Promise<void> {
  await page.goto("/");
  await page.evaluate(
    ([key, data]) =>
      localStorage.setItem(key as string, JSON.stringify(data)),
    ["@mahjong/progress", progress] as const,
  );
  await page.goto("/");
}
