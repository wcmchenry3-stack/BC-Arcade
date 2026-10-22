/**
 * hearts-leaderboard.spec.ts — GH #1142, #2506, #2629
 *
 * Result card + leaderboard: inject the last trick of a hand with West
 * already at 100 and the human holding the last card. Playing it starts the
 * game's session (with the opponent style as `ai_difficulty`) and ends the
 * game. The finished game syncs itself (`POST /games`, `PATCH
 * /games/{id}/complete`) and the card shows where it ranks
 * (`GET /games/{id}/rank`) under the player's display name — or asks for
 * one once when none is set. Nothing goes to `POST /hearts/score` (#2629),
 * which was removed in #2644.
 * A finished game resumed from storage shows the card without sending
 * anything.
 *
 * final_score recorded = Math.max(0, 100 − cumulativeScores[0]).
 * The human discards ♥5 onto East's winning ♦9 and ends on 45: 55.
 *
 * No running backend is needed: the routes this spec depends on (the game
 * sync included) are intercepted with page.route(), and any other call
 * fails, which the app handles like being offline.
 */

import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";
import { injectHeartsState } from "./helpers/hearts";
import {
  LEADERBOARD_GAME_OVER_STATE as GAME_OVER_STATE,
  LEADERBOARD_LAST_TRICK_STATE as LAST_TRICK_STATE,
} from "./helpers/heartsFixtures";

const DISPLAY_NAME_KEY = "player_display_name";

interface Traffic {
  /** Requests to the removed Hearts routes (`/hearts/...`, #2644). */
  hearts: string[];
  /** `POST /games` bodies. */
  creates: Record<string, unknown>[];
  /** `PATCH /games/{id}/complete` bodies. */
  completes: Record<string, unknown>[];
  /** `GET /games/{id}/rank` calls. */
  ranks: string[];
}

/** Intercepts the game sync, rank and player routes, and records any `/hearts/` call. */
async function routeApi(page: Page): Promise<Traffic> {
  const traffic: Traffic = {
    hearts: [],
    creates: [],
    completes: [],
    ranks: [],
  };
  const json = (body: unknown) => ({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
  await page.route("**/hearts/**", async (route) => {
    traffic.hearts.push(`${route.request().method()} ${route.request().url()}`);
    await route.fulfill({ ...json({ detail: "Not Found" }), status: 404 });
  });
  // /players/me as the server behaves since #2778: a join (PUT, no body)
  // assigns a generated name, GET reads it, DELETE leaves. The name is
  // "Tester" so a device that already holds that name keeps it.
  let boardName: string | null = null;
  await page.route("**/players/me", async (route) => {
    const method = route.request().method();
    if (method === "PUT") boardName = "Tester";
    if (method === "DELETE") boardName = null;
    await route.fulfill(json({ display_name: boardName }));
  });
  await page.route("**/games**", async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    const body = JSON.parse(req.postData() ?? "{}");
    if (req.method() === "POST" && path.endsWith("/games")) {
      traffic.creates.push(body);
      await route.fulfill(json({ id: body.id }));
    } else if (req.method() === "PATCH" && path.endsWith("/complete")) {
      traffic.completes.push(body);
      await route.fulfill(json({ id: path.split("/").slice(-2)[0] }));
    } else if (req.method() === "GET" && path.endsWith("/rank")) {
      traffic.ranks.push(path);
      await route.fulfill(
        json({ rank: 1, is_best: true, ranked: true, reason: null }),
      );
    } else {
      await route.fulfill(json({}));
    }
  });
  return traffic;
}

/** Opens a saved game, optionally under a display name. */
async function openGame(
  page: Page,
  state: Record<string, unknown>,
  displayName?: string,
): Promise<void> {
  await injectHeartsState(page, state);
  if (displayName) {
    await page.evaluate(([key, name]) => localStorage.setItem(key, name), [
      DISPLAY_NAME_KEY,
      displayName,
    ] as const);
    await page.goto("/");
  }
  await page.getByRole("button", { name: "Play Hearts" }).click();
  await page
    .getByRole("heading", { name: "Hearts", exact: true })
    .waitFor({ timeout: 10_000 });
}

/** Plays the human's last card, which ends the game. */
async function finishGame(page: Page, displayName?: string): Promise<void> {
  await openGame(page, LAST_TRICK_STATE, displayName);
  await page.getByTestId("hearts-hand-card-0").getByRole("button").click();
  await expect(page.getByTestId("hearts-result")).toBeVisible({
    timeout: 15_000,
  });
}

test.describe("Hearts — result card + leaderboard", () => {
  test("shows the game's rank under the saved display name with no name entry", async ({
    page,
  }) => {
    const traffic = await routeApi(page);
    await finishGame(page, "Tester");

    const card = page.getByTestId("hearts-result");
    await expect(card.getByText("You Win!")).toBeVisible();
    await expect(
      card.getByText("West reached 100 · lowest score wins"),
    ).toBeVisible();
    await expect(card.getByTestId("hearts-final-standings")).toBeVisible();
    await expect(
      page.getByText("Saved as Tester · #1 on the leaderboard"),
    ).toBeVisible({ timeout: 15_000 });

    expect(traffic.creates).toHaveLength(1);
    expect(traffic.creates[0]).toMatchObject({
      game_type: "hearts",
      // The saved "schemer" game resumes as conservative in a store build (#3158).
      metadata: { ai_difficulty: "conservative" },
    });
    expect(traffic.completes).toHaveLength(1);
    expect(traffic.completes[0]).toMatchObject({
      outcome: "win",
      final_score: 55,
      result: { final_score: 55, vs_result: "win" },
    });
    // The play clock's active time (#2629), never 0.
    expect(traffic.completes[0].duration_ms).toBeGreaterThan(0);
    expect(traffic.ranks).toEqual([`/games/${traffic.creates[0].id}/rank`]);
    expect(traffic.hearts).toEqual([]);

    await expect(
      card.getByRole("button", { name: "Play Again" }),
    ).toBeVisible();
    // One CPU, so nothing to change (#3489).
    await expect(
      card.getByRole("button", { name: "Change Difficulty" }),
    ).toHaveCount(0);
    await expect(card.getByRole("button", { name: "Home" })).toBeVisible();
  });

  test("asks the player to join once when not on the boards, then shows the rank", async ({
    page,
  }) => {
    const traffic = await routeApi(page);
    await finishGame(page);

    const join = page.getByRole("button", { name: "Join leaderboards" });
    await expect(join).toBeVisible({ timeout: 5_000 });

    await join.click();

    await expect(
      page.getByText("Saved as Tester · #1 on the leaderboard"),
    ).toBeVisible({ timeout: 15_000 });
    expect(traffic.hearts).toEqual([]);
  });

  test("a finished game resumed from storage shows the card without sending anything", async ({
    page,
  }) => {
    const traffic = await routeApi(page);
    await openGame(page, GAME_OVER_STATE, "Tester");

    await expect(page.getByTestId("hearts-result")).toBeVisible({
      timeout: 5_000,
    });
    await page.waitForTimeout(1_000);
    expect(traffic.hearts).toEqual([]);
    expect(traffic.completes).toEqual([]);
  });
});
