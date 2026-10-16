/**
 * daily-word-tile-letters.spec.ts — GH #3149
 *
 * A typed "I" sat in the DOM but painted nothing until the guess was
 * submitted. `toContainText` (used by the gameplay spec) passes in that state,
 * so these assert on what is actually drawn: for every letter, in an
 * unsubmitted tile, the glyph's text box lies inside the tile on one line and
 * the tile paints glyph pixels.
 */

import { test, expect, type Locator } from "@playwright/test";
import { gotoDailyWord } from "./helpers/daily_word";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

/** The glyph's laid-out box, relative to the tile it sits in. */
async function glyphGeometry(tile: Locator) {
  return tile.evaluate((el) => {
    const tileRect = el.getBoundingClientRect();
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const node = walker.nextNode();
    if (!node) return null;
    const range = document.createRange();
    range.selectNodeContents(node);
    const rects = Array.from(range.getClientRects());
    return {
      lines: rects.length,
      inside: rects.every(
        (r) =>
          r.width > 0 &&
          r.height > 0 &&
          r.left >= tileRect.left &&
          r.right <= tileRect.right &&
          r.top >= tileRect.top &&
          r.bottom <= tileRect.bottom,
      ),
    };
  });
}

/** True when hiding the glyph changes the tile's pixels, i.e. it was painted. */
async function paintsGlyph(tile: Locator) {
  const shown = await tile.screenshot({ animations: "disabled" });
  await tile.evaluate((el) => {
    for (const n of el.querySelectorAll<HTMLElement>("*"))
      n.style.setProperty("color", "transparent", "important");
  });
  const hidden = await tile.screenshot({ animations: "disabled" });
  await tile.evaluate((el) => {
    for (const n of el.querySelectorAll<HTMLElement>("*"))
      n.style.removeProperty("color");
  });
  return !shown.equals(hidden);
}

test.describe("Daily Word — typed letters are visible before submit", () => {
  test.beforeEach(async ({ page }) => {
    await gotoDailyWord(page);
  });

  test("every letter A–Z paints inside an unsubmitted tile", async ({
    page,
  }) => {
    const tile = page.getByTestId("tile-0-0");
    for (const letter of ALPHABET) {
      await page.getByRole("button", { name: letter, exact: true }).click();
      await expect(tile).toHaveText(letter, { timeout: 3_000 });

      expect(
        await glyphGeometry(tile),
        `${letter} laid out in its tile`,
      ).toEqual({
        lines: 1,
        inside: true,
      });
      expect(await paintsGlyph(tile), `${letter} painted`).toBe(true);

      await page.getByRole("button", { name: "Delete", exact: true }).click();
      await expect(tile).toHaveText("", { timeout: 3_000 });
    }
  });

  test("S P I R E shows all five letters before Enter", async ({ page }) => {
    for (const letter of ["S", "P", "I", "R", "E"]) {
      await page.getByRole("button", { name: letter, exact: true }).click();
    }
    for (const [i, letter] of ["S", "P", "I", "R", "E"].entries()) {
      const tile = page.getByTestId(`tile-0-${i}`);
      await expect(tile).toHaveText(letter);
      expect(await paintsGlyph(tile), `${letter} painted`).toBe(true);
    }
  });
});
