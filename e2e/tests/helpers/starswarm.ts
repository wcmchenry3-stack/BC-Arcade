import { Page } from "@playwright/test";
import { installEntitlementsMock } from "./api-mock";

const API_BASE = "http://localhost:8000";

export async function mockStarswarmApi(page: Page): Promise<void> {
  await page.route(`${API_BASE}/starswarm/**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ scores: [] }),
    });
  });
}

export async function gotoStarswarm(page: Page): Promise<void> {
  await installEntitlementsMock(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Play Star Swarm" }).click();
  await page
    .getByRole("heading", { name: "Star Swarm", exact: true })
    .waitFor({ timeout: 10_000 });
}

/** Star Swarm has no localStorage state; this is a no-op placeholder for parity. */
export async function injectStarswarmState(
  page: Page,
  _partial: Record<string, unknown>,
): Promise<void> {
  await page.goto("/");
}
