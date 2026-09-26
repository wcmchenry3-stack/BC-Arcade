/**
 * Mocks for the result card of a game on the session boards (#2632, #2677).
 *
 * The card no longer submits anything: it reads where the synced game ranks
 * with GET /games/{id}/rank, and a display name the player types is sent with
 * PUT /players/me. `legacyPattern` records any call to the game's old
 * per-game leaderboard routes, which were removed in #2644 (they answer 404
 * here, as on the server): the app must not make one.
 */

import type { Page } from "@playwright/test";

export interface SessionBoardCalls {
  /** Game ids whose rank the card asked for. */
  rankLookups: string[];
  /** "METHOD path" of every call to the removed per-game routes. */
  legacyCalls: string[];
}

export async function routeSessionBoard(
  page: Page,
  { legacyPattern, rank = 1 }: { legacyPattern: string; rank?: number },
): Promise<SessionBoardCalls> {
  const calls: SessionBoardCalls = { rankLookups: [], legacyCalls: [] };
  await page.route("**/games/*/rank", async (route) => {
    const parts = new URL(route.request().url()).pathname.split("/");
    calls.rankLookups.push(decodeURIComponent(parts[parts.length - 2] ?? ""));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ranked: true, rank, is_best: true, reason: null }),
    });
  });
  await page.route("**/players/me", async (route) => {
    const body = JSON.parse(route.request().postData() ?? "{}");
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ display_name: body.display_name ?? null }),
    });
  });
  await page.route(legacyPattern, async (route) => {
    const request = route.request();
    calls.legacyCalls.push(
      `${request.method()} ${new URL(request.url()).pathname}`,
    );
    await route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ detail: "Not Found" }),
    });
  });
  return calls;
}
