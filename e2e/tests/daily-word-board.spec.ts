/**
 * daily-word-board.spec.ts — #3663
 *
 * The board fills the space above the keyboard on a phone, and the keyboard reveals with the
 * tiles: a key keeps its colour until the tile for its letter has turned over.
 */

import { test, expect, type Page } from "@playwright/test";
import { gotoDailyWord, mockDailyWordApi } from "./helpers/daily_word";
import { installEntitlementsMock } from "./helpers/api-mock";

async function keyColour(page: Page, letter: string): Promise<string> {
  return page
    .getByTestId(`daily-word-key-${letter}`)
    .evaluate((el) => getComputedStyle(el).backgroundColor);
}

async function type(page: Page, word: string): Promise<void> {
  for (const ch of word) await page.getByTestId(`daily-word-key-${ch}`).click();
}

test.describe("Daily Word — board and keyboard reveal (#3663)", () => {
  test("on a 390 x 844 phone the tiles are at least 56 px and centred above the keyboard", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoDailyWord(page);
    const tile = (await page.getByTestId("tile-0-0").boundingBox())!;
    expect(tile.width).toBeGreaterThanOrEqual(56);
    expect(tile.height).toBeGreaterThanOrEqual(56);
    // Centred in the area above the keyboard: equal space above and below the grid.
    const area = (await page
      .getByTestId("daily-word-board-area")
      .boundingBox())!;
    const top = tile.y - area.y;
    const last = (await page.getByTestId("tile-5-0").boundingBox())!;
    const bottomGap = area.y + area.height - (last.y + last.height);
    expect(Math.abs(top - bottomGap)).toBeLessThanOrEqual(16); // the area's 12 px bottom pad
  });

  test("a key keeps its colour until its tile has flipped", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    // The guess's last letter is correct: its tile turns last, ~550 ms after Enter.
    await mockDailyWordApi(page, {
      guessTiles: [
        { letter: "c", status: "absent" },
        { letter: "r", status: "absent" },
        { letter: "a", status: "absent" },
        { letter: "n", status: "absent" },
        { letter: "e", status: "correct" },
      ],
    });
    await installEntitlementsMock(page);
    await page.goto("/");
    await page.evaluate(() => localStorage.removeItem("daily_word_state_v1"));
    await page.getByRole("button", { name: "Play Daily Word" }).click();
    await page.getByTestId("tile-0-0").waitFor({ timeout: 10_000 });
    await type(page, "crane");
    const before = await keyColour(page, "e");
    await page.getByTestId("daily-word-key-enter").click();
    // Right after Enter (well before the last tile turns), E still has its old colour.
    expect(await keyColour(page, "e")).toBe(before);
    // Once the row has flipped, it shows the result.
    await expect
      .poll(() => keyColour(page, "e"), { timeout: 3_000 })
      .not.toBe(before);
  });
});
