/**
 * mahjong-motion.spec.ts — #3613
 *
 * The board's motion never holds up play: a tap during a match's flight and burst is taken at
 * once, and a tap during the deal-in lands the deal and still counts.
 *
 * Tiles are found by where they sit on the board, as a fraction of the board canvas's box
 * (taken again before each tap, since the camera moves the canvas as the board clears). The
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

    // A match, then the next pair at once: within 100 ms, while the first still flies.
    await tapAt(page, FOUR_AT[0]!);
    await tapAt(page, FOUR_AT[1]!);
    const matched = Date.now();
    await tapAt(page, FOUR_AT[2]!);
    expect(Date.now() - matched).toBeLessThan(100);
    await tapAt(page, FOUR_AT[3]!);

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
