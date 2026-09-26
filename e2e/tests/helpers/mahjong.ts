/**
 * Shared helpers for Mahjong e2e tests.
 */

import { Page } from "@playwright/test";
import { installEntitlementsMock } from "./api-mock";

/** Navigate from Home to Mahjong and wait for the board canvas to be ready. */
export async function gotoMahjong(page: Page): Promise<void> {
  await installEntitlementsMock(page);
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
  await installEntitlementsMock(page);
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
  await installEntitlementsMock(page);
  await page.goto("/");
  await page.evaluate(
    ([key, data]) => localStorage.setItem(key as string, JSON.stringify(data)),
    // Key must match PROGRESS_KEY in frontend/src/game/mahjong/storage.ts
    ["@mahjong/progress", progress] as const,
  );
  await page.goto("/");
}

/** Inject a MahjongState and MahjongProgress snapshot in a single navigation cycle. */
export async function injectMahjongFull(
  page: Page,
  state: Record<string, unknown>,
  progress: Record<string, unknown>,
): Promise<void> {
  await installEntitlementsMock(page);
  await page.goto("/");
  await page.evaluate(
    ([gameState, progressData]) => {
      localStorage.setItem("mahjong_game", JSON.stringify(gameState));
      // Key must match PROGRESS_KEY in frontend/src/game/mahjong/storage.ts
      localStorage.setItem("@mahjong/progress", JSON.stringify(progressData));
    },
    [state, progress] as const,
  );
  await page.goto("/");
}
