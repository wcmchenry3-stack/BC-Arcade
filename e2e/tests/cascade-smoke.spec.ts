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
import { installEntitlementsMock } from "./helpers/api-mock";
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

const BACK_TO_HOME = "Go back to home screen";

/**
 * Records, per canvas element, every context type requested through getContext(), without
 * creating a context itself (calling getContext("2d") from a test would create one, and would
 * return null on a WebGL canvas, so it cannot tell the two apart without side effects).
 */
async function recordCanvasContextRequests(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const requests = new Map<HTMLCanvasElement, string[]>();
    (
      window as unknown as { __canvasContextRequests: () => string[][] }
    ).__canvasContextRequests = () => Array.from(requests.values());
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      type: string,
      ...rest: unknown[]
    ) {
      const list = requests.get(this) ?? [];
      list.push(type);
      requests.set(this, list);
      return (original as (...a: unknown[]) => unknown).call(
        this,
        type,
        ...rest,
      );
    } as typeof original;
  });
}

function canvasContextRequests(page: Page): Promise<string[][]> {
  return page.evaluate(() =>
    (
      window as unknown as { __canvasContextRequests: () => string[][] }
    ).__canvasContextRequests(),
  );
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
    await installEntitlementsMock(page);
    const wasm = trackWasmRequests(page);
    // The lobby prefetches the Cascade route chunk (but not CanvasKit); wait for that request so
    // "no .wasm in the lobby" below is checked after the point it could have been requested.
    const routeChunk = page.waitForRequest((req) =>
      /CascadeRoute[^/]*\.js$/.test(new URL(req.url()).pathname),
    );

    await page.goto("/");
    await expect(
      page.getByRole("button", { name: "Play Cascade" }),
    ).toBeVisible();
    await routeChunk;
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

  for (const [name, open] of [
    ["Mahjong", gotoMahjong],
    [
      "Star Swarm",
      async (page: Page) => {
        await gotoStarswarm(page);
        // Star Swarm opens on a ship/difficulty modal that covers the header's back button.
        await page.getByRole("button", { name: "Start Game" }).click();
        await page
          .getByRole("img", { name: /Star Swarm game/i })
          .waitFor({ timeout: 15_000 });
      },
    ],
  ] as const) {
    test(`${name} keeps its Canvas 2D canvas and never loads CanvasKit, and Cascade still opens after it in the same session`, async ({
      page,
    }) => {
      await installEntitlementsMock(page);
      await recordCanvasContextRequests(page);
      const wasm = trackWasmRequests(page);

      await open(page);
      // What this proves: this game's canvas still gets a Canvas 2D context and Skia did not take
      // over any canvas on the page (CanvasKit asks for WebGL). The recorder only observes
      // getContext() calls, so checking does not itself create a context on a canvas.
      await expect
        .poll(async () => (await canvasContextRequests(page)).flat())
        .toContain("2d");
      expect(
        (await canvasContextRequests(page))
          .flat()
          .filter((type) => type.startsWith("webgl")),
      ).toEqual([]);
      expect(wasm).toHaveLength(0);
      expect(await hasCanvasKit(page)).toBe(false);

      // Same page session (no page.goto): back to the lobby in-app, then open Cascade. Cascade's
      // Skia must bind to CanvasKit only after it has loaded, even though another game ran first.
      await page.getByRole("button", { name: BACK_TO_HOME }).first().click();
      await expect(
        page.getByRole("button", { name: "Play Cascade" }),
      ).toBeVisible();
      await page.getByRole("button", { name: "Play Cascade" }).click();
      await waitForCascadeBoard(page);

      expect(await hasCanvasKit(page)).toBe(true);
      expect(wasm).toHaveLength(1);
    });
  }

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
