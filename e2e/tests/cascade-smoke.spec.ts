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
import AxeBuilder from "@axe-core/playwright";
import {
  dropAt,
  fastForward,
  getState,
  gotoCascade,
  openCascade,
  setSeed,
  setupWin,
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
    // #3701: a loss dims the pile and flashes the lid first; the card comes 1 s after the game
    // over. Wait for it (not just its first render) and check it is the loss card.
    const card = page.getByTestId("cascade-result");
    await expect(card).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("cascade-result-title")).toHaveText(
      "Game Over",
    );
  });

  // #3928: press, drag and release. A click is a tap and drops at once; a drag drops where it
  // was released; a drag that leaves the board drops nothing. Real mouse input, no test hook.
  test("aiming: a tap drops, a drag drops at the moved x, a drag off the board cancels", async ({
    page,
  }) => {
    await gotoCascade(page);
    await setSeed(page, 3928);
    const box = (await page.getByTestId("cascade-game-area").boundingBox())!;
    const at = (fx: number, fy = 0.45) => ({
      x: box.x + box.width * fx,
      y: box.y + box.height * fy,
    });
    const newest = async () => {
      const s = await getState(page);
      return s.fruits.reduce((a, b) => (b.id > a.id ? b : a), s.fruits[0]!);
    };

    // A tap at 30 % of the board: world x 120.
    await page.mouse.click(at(0.3).x, at(0.3).y);
    await expect.poll(async () => (await getState(page)).fruitCount).toBe(1);
    expect(Math.abs((await newest()).x - 120)).toBeLessThan(25);
    await page.waitForTimeout(1200); // the piece falls below the lid; the drop cooldown ends

    // A drag from 20 % to 80 %: it drops at world x 320, not where it was pressed.
    await page.mouse.move(at(0.2).x, at(0.2).y);
    await page.mouse.down();
    for (let i = 1; i <= 15; i++) {
      await page.mouse.move(at(0.2 + (0.6 * i) / 15).x, at(0.2).y);
    }
    await page.mouse.up();
    await expect.poll(async () => (await getState(page)).fruitCount).toBe(2);
    expect(Math.abs((await newest()).x - 320)).toBeLessThan(25);
    await page.waitForTimeout(1200);

    // A drag off the bottom of the board, released there: nothing drops.
    await page.mouse.move(at(0.5).x, at(0.5).y);
    await page.mouse.down();
    for (let i = 1; i <= 12; i++) {
      await page.mouse.move(at(0.5).x, at(0.5, 0.5 + (0.7 * i) / 12).y);
    }
    await page.mouse.up();
    await page.waitForTimeout(1000);
    expect((await getState(page)).fruitCount).toBe(2);
  });

  // #3934: keyboard aiming (web). Focus the board, Left / Right (Shift: bigger) move the aim, Space
  // drops at the moved x, Escape cancels. World x: the board is 400 wide, steps 16 and 64.
  test("keyboard: arrows aim, Space drops at the moved x, Escape cancels", async ({
    page,
  }) => {
    await gotoCascade(page);
    await setSeed(page, 3934);
    const board = page.getByTestId("cascade-game-area");
    const newest = async () => {
      const s = await getState(page);
      return s.fruits.reduce((a, b) => (b.id > a.id ? b : a), s.fruits[0]!);
    };

    // A keyboard focus (Tab) shows the ring; the page stays axe-clean with it.
    await board.focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    await expect(board).toBeFocused();
    await expect(page.getByTestId("cascade-focus-ring")).toBeVisible();
    const scan = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag22aa"])
      .analyze();
    expect(
      scan.violations.filter(
        (v) => v.impact === "critical" || v.impact === "serious",
      ),
    ).toEqual([]);

    // Escape cancels the aim: nothing drops.
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
    expect((await getState(page)).fruitCount).toBe(0);

    // Left x2 (16 each) and Shift+Left (64) from the centre (200): 104. Space drops there.
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("Shift+ArrowLeft");
    await page.keyboard.press("Space");
    await expect.poll(async () => (await getState(page)).fruitCount).toBe(1);
    expect(Math.abs((await newest()).x - 104)).toBeLessThan(25);
    await page.waitForTimeout(1200);

    // Right x2 and Enter: 232.
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Enter");
    await expect.poll(async () => (await getState(page)).fruitCount).toBe(2);
    expect(Math.abs((await newest()).x - 232)).toBeLessThan(25);
  });

  // #3934: a mouse focus shows no ring, a key press then does; the page never scrolls under keys.
  test("keyboard: a click then an arrow shows the ring, and the page does not scroll", async ({
    page,
  }) => {
    await gotoCascade(page);
    await setSeed(page, 3935);
    const board = page.getByTestId("cascade-game-area");
    const box = (await board.boundingBox())!;
    // A press and release off the aim, so nothing drops: click the board's top edge region.
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height + 60);
    await page.mouse.up();
    await expect(board).toBeFocused();
    await expect(page.getByTestId("cascade-focus-ring")).toHaveCount(0);
    const scrollY = () => page.evaluate(() => window.scrollY);
    const before = await scrollY();
    await page.keyboard.press("ArrowLeft");
    await expect(page.getByTestId("cascade-focus-ring")).toBeVisible();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Space");
    expect(await scrollY()).toBe(before);
  });

  // #3699: the win via the test hook: the celebration plays, and only then the win card.
  test("win via test hook: the celebration, then the win card", async ({
    page,
  }) => {
    await gotoCascade(page);
    await setupWin(page);
    await expect.poll(async () => (await getState(page)).won).toBe(true);
    // The card waits for the celebration (about 2.1 s, #2201): not up straight after the win.
    const title = page.getByTestId("cascade-result-title");
    await expect(title).toBeHidden();
    await expect(title).toBeVisible({ timeout: 8_000 });
    await expect(title).toHaveText("You Win!");
    const card = page.getByTestId("cascade-result");
    await expect(card.getByText("Time", { exact: true })).toBeVisible();
    // #3700: a win shows the merge score and the time bonus; the four-stat card leaves out Merges.
    await expect(card.getByText("Merge score", { exact: true })).toBeVisible();
    await expect(card.getByText("Time bonus", { exact: true })).toBeVisible();
    await expect(card.getByText("Merges", { exact: true })).toHaveCount(0);

    // Play Again starts a fresh game.
    await card.getByRole("button", { name: "Play Again" }).click();
    await expect(title).toBeHidden();
    await expect
      .poll(async () => {
        const s = await getState(page);
        return [s.won, s.gameOver, s.fruitCount];
      })
      .toEqual([false, false, 0]);
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
