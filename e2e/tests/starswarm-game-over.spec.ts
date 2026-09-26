/**
 * starswarm-game-over.spec.ts — #2516
 *
 * Star Swarm's end of run: the shared result card, the run recorded with its
 * score and its rank on the tier's board under the player's display name
 * (#2626), Play Again / Change Difficulty, and a Best that survives a reload.
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

const API_BASE = "http://localhost:8000";

interface RoutedApi {
  /** Bodies posted to the removed POST /starswarm/score (#2644) — the app sends none (#2626). */
  legacyPosts: Record<string, unknown>[];
  /** PATCH /games/{id}/complete bodies, as SyncWorker uploads them. */
  completions: Record<string, unknown>[];
  /** Game ids the result card asked GET /games/{id}/rank about. */
  rankRequests: string[];
}

/**
 * Intercepts the removed Star Swarm routes (#2644) and the session pipeline: the run's
 * games row (create, events, complete), its rank, and the display name.
 */
async function routeStarswarmApi(page: Page): Promise<RoutedApi> {
  const api: RoutedApi = { legacyPosts: [], completions: [], rankRequests: [] };
  const json = (body: unknown, status = 200) => ({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
  await page.route("**/starswarm/**", async (route) => {
    if (route.request().method() === "POST") {
      api.legacyPosts.push(JSON.parse(route.request().postData() ?? "{}"));
    }
    await route.fulfill(json({ detail: "Not Found" }, 404));
  });
  await page.route(new RegExp(`^${API_BASE}/games(/.*)?$`), async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    const rank = path.match(/^\/games\/([^/]+)\/rank$/);
    if (req.method() === "GET" && rank) {
      api.rankRequests.push(decodeURIComponent(rank[1]!));
      await route.fulfill(
        json({ rank: 3, is_best: true, ranked: true, reason: null }),
      );
      return;
    }
    if (req.method() === "PATCH" && path.endsWith("/complete")) {
      api.completions.push(JSON.parse(req.postData() ?? "{}"));
    }
    await route.fulfill(
      json({}, req.method() === "POST" && path === "/games" ? 201 : 200),
    );
  });
  await page.route("**/players/me", async (route) => {
    const body = JSON.parse(route.request().postData() ?? "{}");
    await route.fulfill(json({ display_name: body.display_name ?? null }));
  });
  return api;
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

  test("records the run with its score and shows its rank on the tier's board", async ({
    page,
  }) => {
    const api = await routeStarswarmApi(page);
    await startRun(page, "Tester");
    await endRun(page, 4200, 7);

    await expect(
      page.getByText("Saved as Tester · #3 on the leaderboard"),
    ).toBeVisible({
      timeout: 10_000,
    });
    // #2626: the run's games row is the entry — it carries the score, wave and tier.
    expect(api.completions).toHaveLength(1);
    expect(api.completions[0]).toMatchObject({
      final_score: 4200,
      outcome: "completed",
      result: {
        outcome: "completed",
        wave_reached: 7,
        difficulty_tier: expect.any(String),
      },
    });
    expect(api.rankRequests).toHaveLength(1);
    // Nothing goes to the removed POST /starswarm/score.
    expect(api.legacyPosts).toHaveLength(0);
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
