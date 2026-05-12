/**
 * Shared helpers for Cascade e2e tests.
 *
 * Requires EXPO_PUBLIC_TEST_HOOKS=1 in the frontend build (set in CI and
 * locally via `EXPO_PUBLIC_TEST_HOOKS=1 npx expo export --platform web`).
 *
 * All window.__cascade_* hooks are registered in CascadeScreen.tsx and
 * GameCanvas.web.tsx and are no-ops / undefined in production builds.
 */

import { Page } from "@playwright/test";
import { installEntitlementsMock } from "./api-mock";

const API_BASE = "http://localhost:8000";

export interface CascadeState {
  score: number;
  fruitCount: number;
  dangerRatio: number;
  gameOver: boolean;
  nextFruitTier: number;
  fruits: Array<{ id: number; tier: number; x: number; y: number }>;
}

/** Mock leaderboard endpoint so tests don't depend on a running backend. */
export async function mockLeaderboard(page: Page): Promise<void> {
  await page.route(`${API_BASE}/cascade/**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ scores: [] }),
    });
  });
}

/** Navigate from Home to Cascade and wait for the canvas to be ready. */
export async function gotoCascade(page: Page): Promise<void> {
  await installEntitlementsMock(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Play Cascade" }).click();
  await page
    .getByRole("heading", { name: "Cascade", exact: true })
    .waitFor({ timeout: 10_000 });
  // Rapier WASM may take a moment to initialise — wait for the canvas label
  await page
    .getByRole("img", { name: /Cascade game/i })
    .waitFor({ timeout: 15_000 });
  // The canvas DOM mounts before Rapier WASM finishes async init; without
  // this wait the first spawnTierAt() calls can silently no-op because
  // engineRef is still null, causing flaky first-run failures (#375).
  await page.waitForFunction(
    () =>
      (
        window as { __cascade_isReady?: () => boolean }
      ).__cascade_isReady?.() === true,
    undefined,
    { timeout: 15_000 },
  );
}

/** Read the current engine state exposed by the test hook. */
export async function getState(page: Page): Promise<CascadeState> {
  return page.evaluate(
    () =>
      (
        window as { __cascade_getState?: () => CascadeState }
      ).__cascade_getState?.() ?? {
        score: 0,
        fruitCount: 0,
        dangerRatio: 0,
        gameOver: false,
        nextFruitTier: 0,
        fruits: [],
      },
  );
}

/**
 * Seed the fruit-spawn RNG for a reproducible queue.
 * Must be called before the first drop of a session.
 */
export async function setSeed(page: Page, seed: number): Promise<void> {
  await page.evaluate(
    (s) =>
      (
        window as { __cascade_setSeed?: (n: number) => void }
      ).__cascade_setSeed?.(s),
    seed,
  );
}

/**
 * Programmatically drop the next fruit at canvas x-coordinate `x`.
 * Bypasses the 200 ms droppingRef lock so tests can drop rapidly.
 */
export async function dropAt(page: Page, x: number): Promise<void> {
  await page.evaluate(
    (xPos) =>
      (window as { __cascade_dropAt?: (x: number) => void }).__cascade_dropAt?.(
        xPos,
      ),
    x,
  );
}

/**
 * Fast-forward the physics simulation by `ms` milliseconds without
 * waiting for real time. Useful for settling fruits before assertions.
 */
export async function fastForward(page: Page, ms: number): Promise<void> {
  await page.evaluate(
    (millis) =>
      (
        window as { __cascade_fastForward?: (ms: number) => void }
      ).__cascade_fastForward?.(millis),
    ms,
  );
}

/**
 * Immediately trigger game-over (skips danger-line buildup).
 * Useful for testing the game-over overlay and restart flow.
 */
export async function triggerGameOver(page: Page): Promise<void> {
  await page.evaluate(() =>
    (
      window as { __cascade_triggerGameOver?: () => void }
    ).__cascade_triggerGameOver?.(),
  );
}

/**
 * Spawn a fruit of a specific tier at canvas x-coordinate `x`, bypassing
 * the queue entirely. Enables deterministic merge/score tests.
 */
export async function spawnTierAt(
  page: Page,
  tier: number,
  x: number,
): Promise<void> {
  await page.evaluate(
    ([t, xPos]) =>
      (
        window as { __cascade_spawnTierAt?: (tier: number, x: number) => void }
      ).__cascade_spawnTierAt?.(t, xPos),
    [tier, x] as const,
  );
}
