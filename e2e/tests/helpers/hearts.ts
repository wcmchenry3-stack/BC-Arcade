import { Page } from "@playwright/test";
import { installEntitlementsMock } from "./api-mock";

const STORAGE_KEY = "hearts_game";

export async function gotoHearts(page: Page): Promise<void> {
  await installEntitlementsMock(page);
  await page.goto("/");
  await page.evaluate((key) => localStorage.removeItem(key), STORAGE_KEY);
  await page.getByRole("button", { name: "Play Hearts" }).click();
  await page
    .getByRole("heading", { name: "Hearts", exact: true })
    .waitFor({ timeout: 10_000 });
  // No pre-game screen (#3489): a fresh Hearts screen deals the table at once.
  await page.getByLabel("Your hand, 13 cards").waitFor({ timeout: 10_000 });
}

export async function injectHeartsState(
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
