/**
 * starswarm-persistence.spec.ts — GH #1147
 *
 * StarSwarm has no localStorage state — it is stateless by design.
 * injectStarswarmState is a no-op placeholder for API parity with other games.
 *
 * These tests verify the clean-start guarantee: no stale game-over state
 * carries over between sessions or page navigations.
 *
 * All backend calls are intercepted — no running backend needed.
 */

import { test, expect } from "./fixtures";
import {
  mockStarswarmApi,
  injectStarswarmState,
} from "./helpers/starswarm";

test.describe("Star Swarm — persistence (stateless)", () => {
  test.beforeEach(async ({ page }) => {
    await mockStarswarmApi(page);
  });

  test("game canvas is present on initial load with no stale state", async ({ page }) => {
    await injectStarswarmState(page, { score: 500, wave: 3 });
    await page.getByRole("button", { name: "Play Star Swarm" }).click();
    await page
      .getByRole("heading", { name: "Star Swarm", exact: true })
      .waitFor({ timeout: 10_000 });

    await expect(
      page.getByRole("img", { name: /Star Swarm game/i }),
    ).toBeVisible({ timeout: 5_000 });
    // No stale game-over overlay from a previous session
    await expect(
      page.getByRole("button", { name: /Start a new game/i }),
    ).not.toBeVisible({ timeout: 2_000 });
  });

  test("game starts fresh after navigating away and back", async ({ page }) => {
    await injectStarswarmState(page, {});
    await page.getByRole("button", { name: "Play Star Swarm" }).click();
    await page
      .getByRole("heading", { name: "Star Swarm", exact: true })
      .waitFor({ timeout: 10_000 });
    await expect(
      page.getByRole("img", { name: /Star Swarm game/i }),
    ).toBeVisible({ timeout: 5_000 });

    await page.goto("/");
    await page.getByText("BC Arcade").first().waitFor({ timeout: 5_000 });

    await page.getByRole("button", { name: "Play Star Swarm" }).click();
    await page
      .getByRole("heading", { name: "Star Swarm", exact: true })
      .waitFor({ timeout: 10_000 });

    await expect(
      page.getByRole("img", { name: /Star Swarm game/i }),
    ).toBeVisible({ timeout: 5_000 });
    // No stale game-over state persisted across navigation
    await expect(
      page.getByRole("button", { name: /Start a new game/i }),
    ).not.toBeVisible({ timeout: 2_000 });
  });
});
