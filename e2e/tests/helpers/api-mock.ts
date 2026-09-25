/**
 * Reusable API mock helpers.
 *
 * The app calls http://localhost:8000 (EXPO_PUBLIC_API_URL default).
 * Helpers use page.route() to intercept these calls so tests are hermetic.
 *
 * Yacht runs entirely on the client (`frontend/src/game/yacht/engine.ts`) and
 * reports through the generic `/games` session pipeline, so it needs no mock
 * here. The old server-side `/yacht/new`, `/yacht/roll`, `/yacht/score` and
 * `/yacht/possible-scores` mocks were removed with #2630: nothing called them.
 */

import { Page, Route } from "@playwright/test";

const API_BASE = "http://localhost:8000";

/**
 * Install a mock for GET /entitlements that grants all premium game access.
 * Must be called before page.goto("/") so the route is registered when the
 * EntitlementProvider mounts.
 */
export async function installEntitlementsMock(page: Page): Promise<void> {
  const b64url = (s: string): string =>
    Buffer.from(s)
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=/g, "");

  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64url(
    JSON.stringify({
      sub: "e2e-test",
      entitled_games: ["blackjack", "cascade", "hearts", "starswarm", "mahjong"],
      iat: 1000000000,
      exp: 9999999999,
    }),
  );
  const token = `${header}.${payload}.e2e-sig`;

  await page.route(`${API_BASE}/entitlements`, async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        token,
        expires_at: "2286-11-20T17:46:39.000Z",
      }),
    });
  });
}
