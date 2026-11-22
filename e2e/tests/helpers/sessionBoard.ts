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
  {
    legacyPattern,
    rank = 1,
    playerName = null,
  }: {
    legacyPattern: string;
    rank?: number;
    /**
     * The name the server already holds for this player (#3790), or null when
     * the player isn't on the boards. Pass the name a test plants on the
     * device: the app's launch refresh (GET /players/me) treats the server as
     * the source of truth and forgets a device name the server doesn't hold.
     */
    playerName?: string | null;
  },
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
  // /players/me as the server behaves since #2778: a join (PUT, no body)
  // assigns a generated name ("Tester" here), GET reads it, DELETE leaves.
  // Joining again keeps the current name, as on the server. The board starts
  // with `playerName`, so the server agrees with a name the test planted on
  // the device (#3790).
  let boardName: string | null = playerName;
  await page.route("**/players/me", async (route) => {
    const method = route.request().method();
    if (method === "PUT") boardName ??= "Tester";
    if (method === "DELETE") boardName = null;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ display_name: boardName }),
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
