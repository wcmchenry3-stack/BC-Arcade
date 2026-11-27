/**
 * mahjong-motion.spec.ts — #3613
 *
 * The board's motion never holds up play: a tap during a match's flight and burst is taken at
 * once, and a tap during the deal-in lands the deal and still counts.
 *
 * Tiles are found by where they sit on the board, as a fraction of the board canvas's box
 * (the camera refits and moves the canvas as the board clears, so the box is read at the
 * instant of each click: `tapAt`, or `tapLive`, which reads it inside the page). The
 * fractions come from the app's own layout (`calculateMahjongLayout` for the Turtle on a
 * 390 x 844 phone), at the centre of each tile's face, which is about 6% of the board wide.
 */

import { test, expect, type Page } from "@playwright/test";
import { gotoMahjong, injectMahjongState } from "./helpers/mahjong";

const BOARD = /Mahjong Solitaire/i;

/** Two free pairs, each tile alone on its row end: circles at the top, bamboos below. */
const FOUR_TILES = [
  { id: 0, suit: "circles", rank: 1, faceId: 17, col: 0, row: 0, layer: 0 },
  { id: 1, suit: "circles", rank: 1, faceId: 17, col: 8, row: 0, layer: 0 },
  { id: 2, suit: "bamboos", rank: 2, faceId: 27, col: 0, row: 2, layer: 0 },
  { id: 3, suit: "bamboos", rank: 2, faceId: 27, col: 8, row: 2, layer: 0 },
];
/** Where they sit: the board is the Turtle's (its layout), so they are in its top-left. */
const FOUR_AT: Record<number, { fx: number; fy: number }> = {
  0: { fx: 0.053, fy: 0.178 },
  1: { fx: 0.353, fy: 0.178 },
  2: { fx: 0.053, fy: 0.37 },
  3: { fx: 0.353, fy: 0.37 },
};
/** The Turtle's leftmost tile, always free (its fraction of the board). */
const TURTLE_LEFT = { fx: 0.053, fy: 0.561 };

async function tapAt(
  page: Page,
  at: { fx: number; fy: number },
): Promise<void> {
  const box = (await page.getByRole("img", { name: BOARD }).boundingBox())!;
  await page.mouse.click(box.x + at.fx * box.width, box.y + at.fy * box.height);
}

/**
 * A real click on the board at `at`, aimed at the live canvas box. The camera eases toward the
 * remaining tiles for ~350 ms after a match (auto-fit; the board grows ~1.9x here), so a box
 * measured earlier is stale: the target is computed in the page from the box as it is now, as
 * the app's own hit test maps it, then clicked through the browser's input pipeline
 * (`page.mouse.click`), so the event's `timeStamp`, and `data-tap-ms`, include any time the
 * input waited behind a busy main thread. A synthetic `dispatchEvent` would hide that.
 */
async function tapLive(
  page: Page,
  at: { fx: number; fy: number },
): Promise<void> {
  const { x, y } = await page.evaluate(
    ({ fx, fy, label }) => {
      const canvas = Array.from(document.querySelectorAll("canvas")).find((c) =>
        new RegExp(label, "i").test(c.getAttribute("aria-label") ?? ""),
      )!;
      const r = canvas.getBoundingClientRect();
      return { x: r.left + fx * r.width, y: r.top + fy * r.height };
    },
    { ...at, label: BOARD.source },
  );
  await page.mouse.click(x, y);
}

test.describe("Mahjong — motion never holds up play (#3613)", () => {
  test("a tap during a match's burst is taken at once", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await injectMahjongState(page, {
      _v: 2,
      dealId: "E2E1",
      currentLayoutId: "turtle",
      tiles: FOUR_TILES,
      pairsRemoved: 0,
      score: 0,
      shufflesLeft: 3,
      selected: null,
      undoStack: [],
      isComplete: false,
      isDeadlocked: false,
      startedAt: null,
      accumulatedMs: 0,
    });
    await gotoMahjong(page);
    await expect(page.getByText(/^PAIRS\s+0\//).first()).toBeVisible({
      timeout: 5_000,
    });

    // A match, then the next pair at once: within 100 ms, while the first still flies. The
    // camera refits after the match, so each tap reads the live box (see `tapLive`).
    await tapLive(page, FOUR_AT[0]!);
    await tapLive(page, FOUR_AT[1]!);
    await tapLive(page, FOUR_AT[2]!);
    // The app's own clock (#4098): Playwright's round trips are not the app's latency. The
    // canvas records, in test builds, the click event -> tap handled time and whether the
    // first match's burst was still flying at that tap.
    const board = page.getByRole("img", { name: BOARD });
    await expect(board).toHaveAttribute("data-tap-seq", "3");
    expect(await board.getAttribute("data-tap-burst")).toBe("true");
    expect(Number(await board.getAttribute("data-tap-ms"))).toBeLessThan(100);
    await tapLive(page, FOUR_AT[3]!);

    // Both pairs count; the result card follows the win cascade.
    await expect(page.getByText(/^PAIRS\s+2\//).first()).toBeVisible({
      timeout: 3_000,
    });
    await expect(page.getByTestId("mahjong-result")).toBeVisible({
      timeout: 5_000,
    });
  });

  test("a tap during the deal-in lands the deal and still counts", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await page.evaluate(() => localStorage.removeItem("mahjong_game"));
    // The layout picker deals a fresh Turtle, which drops in.
    await gotoMahjong(page);
    await tapAt(page, TURTLE_LEFT);
    // The tap selected a tile: the clock, which waits for the first move, now runs.
    await expect(page.getByText(/^TIME\s+0:0[1-9]$/).first()).toBeVisible({
      timeout: 4_000,
    });
  });
});
