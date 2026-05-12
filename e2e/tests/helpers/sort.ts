import { Page } from "@playwright/test";
import { installEntitlementsMock } from "./api-mock";

const STORAGE_KEY = "@sort/progress";

// Two-level mock puzzle set used across all sort e2e specs.
// Level 1: 4 bottles, red + blue (2 empty for workspace).
// Level 2: 4 bottles, green + yellow.
export const MOCK_LEVELS = {
  levels: [
    {
      id: 1,
      bottles: [
        ["red", "red", "blue", "blue"],
        ["blue", "blue", "red", "red"],
        [],
        [],
      ],
    },
    {
      id: 2,
      bottles: [
        ["green", "green", "yellow", "yellow"],
        ["yellow", "yellow", "green", "green"],
        [],
        [],
      ],
    },
  ],
};

export async function mockSortApi(page: Page): Promise<void> {
  await page.route("**/sort/**", async (route) => {
    const url = route.request().url();
    const method = route.request().method();

    if (url.includes("/sort/levels")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(MOCK_LEVELS),
      });
    } else if (url.includes("/sort/score") && method === "POST") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ player_name: "Tester", level_reached: 1, rank: 1 }),
      });
    } else if (url.includes("/sort/scores")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ scores: [] }),
      });
    } else {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({}),
      });
    }
  });
}

// Navigate from Home to the Sort Puzzle level-select screen.
// Callers must call mockSortApi(page) first so the /sort/levels request
// is intercepted when the screen mounts.
export async function gotoSort(page: Page): Promise<void> {
  await installEntitlementsMock(page);
  await page.goto("/");
  await page.evaluate((key) => localStorage.removeItem(key), STORAGE_KEY);
  await page.getByRole("button", { name: "Play Sort Puzzle" }).click();
  await page.getByText("Choose a Level").waitFor({ timeout: 10_000 });
}

// Inject a SortProgress value into localStorage, then reload to home so the
// caller can navigate to the sort screen with the injected state active.
// Callers must call mockSortApi(page) first.
export async function injectSortProgress(
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
