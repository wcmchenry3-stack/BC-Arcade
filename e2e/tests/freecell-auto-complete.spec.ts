/**
 * freecell-auto-complete.spec.ts — GH #3566
 *
 * FreeCell offers an Auto-Complete button when every remaining card can reach a
 * foundation, and never starts the run by itself (not on resume). Tapping the button
 * runs the finish with the board locked, then the result card shows.
 *
 * The board: diamonds and clubs home, spades A to 9 and hearts A to J home; the other
 * spades (K Q J 10) in column 0 and the K♥ Q♥ in column 1, each column in order, so
 * six direct foundation plays finish the game.
 *
 * No running backend is needed: the session routes are intercepted and any other call
 * fails, which the app handles like being offline.
 */

import { test, expect } from "@playwright/test";
import { injectFreecellState } from "./helpers/freecell";
import { routeSessionBoard } from "./helpers/sessionBoard";

const pile = (suit: string, upTo: number) =>
  Array.from({ length: upTo }, (_, i) => ({ suit, rank: i + 1 }));
const col = (suit: string, ranks: number[]) =>
  ranks.map((rank) => ({ suit, rank }));

const AUTO_COMPLETABLE_STATE = {
  _v: 1,
  tableau: [
    col("spades", [13, 12, 11, 10]),
    col("hearts", [13, 12]),
    [],
    [],
    [],
    [],
    [],
    [],
  ],
  freeCells: [null, null, null, null],
  foundations: {
    spades: pile("spades", 9),
    hearts: pile("hearts", 11),
    diamonds: pile("diamonds", 13),
    clubs: pile("clubs", 13),
  },
  undoStack: [],
  isComplete: false,
  moveCount: 41,
};

test.describe("FreeCell — Auto-Complete button (#3566)", () => {
  test("offers the button without starting, and a tap finishes the game", async ({
    page,
  }) => {
    await routeSessionBoard(page, { legacyPattern: "**/freecell/**" });
    await injectFreecellState(page, AUTO_COMPLETABLE_STATE);
    await page.getByRole("button", { name: "Play FreeCell" }).click();
    await page
      .getByRole("heading", { name: "FreeCell", exact: true })
      .waitFor({ timeout: 10_000 });

    const button = page.getByRole("button", { name: "Auto-Complete" });
    await expect(button).toBeVisible({ timeout: 5_000 });

    // Nothing runs by itself: the board stays as it was resumed.
    await page.waitForTimeout(1_500);
    await expect(page.getByLabel("Moves: 41", { exact: true })).toBeVisible();
    await expect(button).toBeVisible();
    await expect(page.getByTestId("freecell-result")).not.toBeVisible();

    await button.click();

    // Hidden while the run goes, then the game is won: 41 + 6 plays.
    await expect(button).not.toBeVisible();
    const result = page.getByTestId("freecell-result");
    await expect(result).toBeVisible({ timeout: 15_000 });
    await expect(result.getByText("Completed in 47 moves")).toBeVisible();
    await expect(button).not.toBeVisible();
  });
});
