/**
 * starswarm-game-over.spec.ts — #2516
 *
 * Star Swarm's end of run: the shared result card, the automatic leaderboard
 * submission under the player's display name, Play Again / Change Difficulty,
 * and a Best that survives a reload.
 *
 * Reaching game over by real play isn't practical here, so the run is ended
 * through the `__starswarm_endRun(score, wave)` test hook (EXPO_PUBLIC_TEST_HOOKS
 * builds only), which drives the screen's real game-over path.
 *
 * API endpoints are mocked so tests are hermetic.
 */

import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";
import { gotoStarswarm } from "./helpers/starswarm";

const DISPLAY_NAME_KEY = "player_display_name";

/** Intercepts the Star Swarm API; returns the POST /starswarm/score bodies. */
async function routeStarswarmApi(
  page: Page,
): Promise<Record<string, unknown>[]> {
  const posts: Record<string, unknown>[] = [];
  await page.route("**/starswarm/**", async (route) => {
    if (route.request().method() === "POST") {
      const body = JSON.parse(route.request().postData() ?? "{}");
      posts.push(body);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          scores: [{ ...body, timestamp: "", rank: 3 }],
        }),
      });
    } else {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ scores: [] }),
      });
    }
  });
  return posts;
}

/** Opens Star Swarm, optionally under a display name, and starts a run. */
async function startRun(page: Page, displayName?: string): Promise<void> {
  if (displayName) {
    await page.goto("/");
    await page.evaluate(([key, name]) => localStorage.setItem(key, name), [
      DISPLAY_NAME_KEY,
      displayName,
    ] as const);
  }
  await gotoStarswarm(page);
  await page.getByTestId("starswarm-start-game").click();
  await expect(page.getByTestId("starswarm-start-game")).not.toBeVisible();
}

async function endRun(page: Page, score: number, wave: number): Promise<void> {
  await page.evaluate(
    ([s, w]) =>
      (
        globalThis as unknown as {
          __starswarm_endRun: (score: number, wave: number) => void;
        }
      ).__starswarm_endRun(s, w),
    [score, wave] as const,
  );
  await expect(page.getByTestId("starswarm-result")).toBeVisible({
    timeout: 5_000,
  });
}

test.describe("Star Swarm — result card", () => {
  test("charge-shot button is absent during active play (#981 removal)", async ({
    page,
  }) => {
    await routeStarswarmApi(page);
    await gotoStarswarm(page);
    await expect(
      page.getByRole("img", { name: /Star Swarm game/i }),
    ).toBeVisible({
      timeout: 10_000,
    });
    await expect(
      page.getByRole("button", { name: /Charge shot/i }),
    ).not.toBeAttached();
  });

  test("ending a run shows the card with score, wave and actions", async ({
    page,
  }) => {
    await routeStarswarmApi(page);
    await startRun(page);
    await endRun(page, 4200, 7);

    const card = page.getByTestId("starswarm-result");
    await expect(card.getByText("Game Over")).toBeVisible();
    await expect(card.getByText("Reached wave 7")).toBeVisible();
    await expect(card.getByText("4,200").first()).toBeVisible();
    await expect(
      card.getByRole("button", { name: "Play Again" }),
    ).toBeVisible();
    await expect(
      card.getByRole("button", { name: "Change Difficulty" }),
    ).toBeVisible();
    await expect(card.getByRole("button", { name: "Home" })).toBeVisible();
    // The old in-canvas NEW GAME button is gone.
    await expect(
      page.getByRole("button", { name: /Start a new game/i }),
    ).not.toBeAttached();
  });

  test("submits the run under the display name", async ({ page }) => {
    const posts = await routeStarswarmApi(page);
    await startRun(page, "Tester");
    await endRun(page, 4200, 7);

    await expect(
      page.getByText("Saved as Tester · #3 on the leaderboard"),
    ).toBeVisible({
      timeout: 10_000,
    });
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({
      player_id: "Tester",
      score: 4200,
      wave_reached: 7,
      difficulty_tier: expect.any(String),
    });
  });

  test("Play Again starts a new run; Change Difficulty opens the picker", async ({
    page,
  }) => {
    await routeStarswarmApi(page);
    await startRun(page);
    await endRun(page, 4200, 7);

    await page
      .getByTestId("starswarm-result")
      .getByRole("button", { name: "Play Again" })
      .click();
    await expect(page.getByTestId("starswarm-result")).not.toBeVisible();
    await expect(page.getByTestId("starswarm-start-game")).not.toBeVisible();

    await endRun(page, 100, 1);
    await page
      .getByTestId("starswarm-result")
      .getByRole("button", { name: "Change Difficulty" })
      .click();
    await expect(page.getByTestId("starswarm-result")).not.toBeVisible();
    await expect(page.getByTestId("starswarm-start-game")).toBeVisible();
  });

  test("Best survives a reload", async ({ page }) => {
    await routeStarswarmApi(page);
    await startRun(page);
    await endRun(page, 4200, 7);
    await expect(
      page.getByTestId("starswarm-result").getByText("New best"),
    ).toBeVisible();

    await page.goto("/");
    await startRun(page);
    await endRun(page, 100, 1);
    const card = page.getByTestId("starswarm-result");
    await expect(card.getByText("New best")).not.toBeVisible();
    await expect(card.getByText("4,200")).toBeVisible(); // Best
  });
});
