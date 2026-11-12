/**
 * cascade-smoke.spec.ts — #2960 (epic #3033)
 *
 * Cascade on web draws with the same Skia code as iOS and Android, through Skia's web runtime
 * (CanvasKit, WebAssembly). The Cascade route loads it lazily when the screen opens, from this
 * origin (never a CDN), with a loading state and a readable, retryable error.
 *
 * This is the smoke path the design-review demos record from: open, drop, merge, game over.
 * Game over comes from the `__cascade_triggerGameOver` test hook (EXPO_PUBLIC_TEST_HOOKS=1
 * builds only), which runs the screen's real game-over path; merges come from
 * `__cascade_spawnTierAt`, which drops a chosen tier so a merge is deterministic.
 *
 * No backend is needed: the app's API calls fail, which it handles like being offline.
 */

import { test, expect } from "./fixtures";
import type { Page, Request } from "@playwright/test";
import {
  dropAt,
  fastForward,
  getState,
  gotoCascade,
  openCascade,
  setSeed,
  spawnTierAt,
  triggerGameOver,
  waitForCascadeBoard,
} from "./helpers/cascade";
import { gotoMahjong } from "./helpers/mahjong";
import { gotoStarswarm } from "./helpers/starswarm";

const WASM = /canvaskit[^/]*\.wasm$/;

/** Records every request for CanvasKit's `.wasm`. */
function trackWasmRequests(page: Page): Request[] {
  const requests: Request[] = [];
  page.on("request", (req) => {
    if (WASM.test(new URL(req.url()).pathname)) requests.push(req);
  });
  return requests;
}

function hasCanvasKit(page: Page): Promise<boolean> {
  return page.evaluate(
    () => (globalThis as { CanvasKit?: unknown }).CanvasKit !== undefined,
  );
}

test.describe("Cascade on web (CanvasKit)", () => {
  test("loads CanvasKit from this origin only when Cascade opens", async ({
    page,
    baseURL,
  }) => {
    const wasm = trackWasmRequests(page);

    await page.goto("/");
    await expect(
      page.getByRole("button", { name: "Play Cascade" }),
    ).toBeVisible();
    // The lobby (and every other screen) never loads Skia's web runtime.
    expect(wasm).toHaveLength(0);
    expect(await hasCanvasKit(page)).toBe(false);

    await page.getByRole("button", { name: "Play Cascade" }).click();
    await waitForCascadeBoard(page);

    expect(await hasCanvasKit(page)).toBe(true);
    expect(wasm).toHaveLength(1);
    expect(new URL(wasm[0]!.url()).origin).toBe(new URL(baseURL!).origin);
    const response = await wasm[0]!.response();
    expect(response?.status()).toBe(200);
  });

  test("Mahjong and Star Swarm keep their Canvas 2D canvases and never load CanvasKit", async ({
    page,
  }) => {
    const wasm = trackWasmRequests(page);
    for (const open of [gotoMahjong, gotoStarswarm]) {
      await open(page);
      // A canvas whose context is Canvas 2D (getContext("2d") is null on a WebGL canvas).
      await expect
        .poll(() =>
          page.evaluate(() =>
            Array.from(document.querySelectorAll("canvas")).some(
              (c) => c.getContext("2d") !== null,
            ),
          ),
        )
        .toBe(true);
    }
    expect(wasm).toHaveLength(0);
    expect(await hasCanvasKit(page)).toBe(false);
  });

  test("drop, merge and game over", async ({ page }) => {
    await gotoCascade(page);
    await setSeed(page, 2960);

    // A drop from the queue lands on the board.
    await dropAt(page, 120);
    await fastForward(page, 1500);
    await expect
      .poll(async () => (await getState(page)).fruitCount)
      .toBeGreaterThan(0);

    // Two of the smallest tier at the same spot merge and score.
    await spawnTierAt(page, 0, 260);
    await spawnTierAt(page, 0, 260);
    await fastForward(page, 2000);
    await expect
      .poll(async () => (await getState(page)).score)
      .toBeGreaterThan(0);

    await triggerGameOver(page);
    await expect.poll(async () => (await getState(page)).gameOver).toBe(true);
    await expect(page.getByTestId("cascade-result")).toBeVisible();
  });

  test("a failed CanvasKit download shows an error, and Retry recovers", async ({
    page,
  }) => {
    await page.route(WASM, (route) => route.abort("failed"));
    await openCascade(page);

    const error = page.getByTestId("cascade-web-error");
    await expect(error).toBeVisible({ timeout: 15_000 });
    await expect(error.getByRole("alert")).toBeVisible();
    expect(await hasCanvasKit(page)).toBe(false);

    await page.unroute(WASM);
    await error.getByRole("button").click();
    await waitForCascadeBoard(page);
    expect(await hasCanvasKit(page)).toBe(true);
  });
});
