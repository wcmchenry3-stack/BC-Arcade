/**
 * daily-word-motion.spec.ts — #3664
 *
 * The motion between a guess and its result: a refused guess shakes its row, a win dances and
 * sparkles before the card, a loss flips the answer in before the card, and the next row can be
 * typed while the last one is still turning over.
 */

import { test, expect, type Page } from "@playwright/test";
import {
  FRESH_STATE,
  injectDailyWordState,
  mockDailyWordApi,
} from "./helpers/daily_word";
import type { DailyWordState } from "../../frontend/src/game/daily_word/types";
import { installEntitlementsMock } from "./helpers/api-mock";

async function type(page: Page, word: string): Promise<void> {
  for (const ch of word) await page.getByTestId(`daily-word-key-${ch}`).click();
}

async function openFresh(
  page: Page,
  guessTiles?: Array<{ letter: string; status: string }>,
): Promise<void> {
  await installEntitlementsMock(page);
  await mockDailyWordApi(page, { guessTiles });
  await page.goto("/");
  await page.evaluate(() => localStorage.removeItem("daily_word_state_v1"));
  await page.getByRole("button", { name: "Play Daily Word" }).click();
  await page.getByTestId("tile-0-0").waitFor({ timeout: 10_000 });
}

const resultTitle = (page: Page) => page.getByTestId("daily-word-result-title");

test.describe("Daily Word — motion (#3664)", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
  });

  test("a refused guess shakes the row being typed", async ({ page }) => {
    await openFresh(page);
    await type(page, "cr");
    const row = page.getByTestId("daily-word-row-0");
    // Sample the row's transform for half a second from the moment Enter is pressed.
    const moved = row.evaluate(
      (el) =>
        new Promise<number>((resolve) => {
          let max = 0;
          const t0 = performance.now();
          const tick = () => {
            const m = new DOMMatrixReadOnly(getComputedStyle(el).transform);
            max = Math.max(max, Math.abs(m.m41));
            if (performance.now() - t0 < 500) requestAnimationFrame(tick);
            else resolve(max);
          };
          tick();
        }),
    );
    await page.getByTestId("daily-word-key-enter").click();
    expect(await moved).toBeGreaterThan(2);
    // It settles back in place.
    await expect
      .poll(() =>
        row.evaluate(
          (el) => new DOMMatrixReadOnly(getComputedStyle(el).transform).m41,
        ),
      )
      .toBe(0);
  });

  test("a win sparkles before the card, which follows the celebration", async ({
    page,
  }) => {
    await openFresh(
      page,
      [..."crane"].map((letter) => ({ letter, status: "correct" })),
    );
    await type(page, "crane");
    await page.getByTestId("daily-word-key-enter").click();
    await expect(page.getByTestId("daily-word-win-sparkles")).toBeVisible({
      timeout: 3_000,
    });
    // The card is held back while the row dances and the sparks fly.
    await expect(resultTitle(page)).toBeHidden();
    await expect(resultTitle(page).getByText("You Win!")).toBeVisible({
      timeout: 5_000,
    });
  });

  test("a loss flips the answer in before the card", async ({ page }) => {
    // Five rows used; the sixth guess loses.
    const fiveDown: DailyWordState = {
      ...FRESH_STATE,
      rows: FRESH_STATE.rows.map((row, i) =>
        i < 5
          ? {
              tiles: Array.from("store", (letter) => ({
                letter,
                status: "absent" as const,
              })),
              submitted: true,
            }
          : row,
      ),
      current_row: 5,
    };
    await injectDailyWordState(page, fiveDown);
    // The sixth guess is new (a repeat is refused); the answer is something else again.
    await mockDailyWordApi(page, { answer: "plumb" });
    await page.getByRole("button", { name: "Play Daily Word" }).click();
    await page.getByTestId("tile-5-0").waitFor({ timeout: 10_000 });
    await type(page, "crane");
    await page.getByTestId("daily-word-key-enter").click();
    const answer = page.getByTestId("daily-word-answer-row");
    await expect(answer).toBeVisible({ timeout: 3_000 });
    await expect(answer).toHaveAccessibleName(/plumb/i);
    await expect(resultTitle(page)).toBeHidden();
    await expect(resultTitle(page).getByText("You Lose")).toBeVisible({
      timeout: 5_000,
    });
  });

  test("the next row can be typed while the last one turns over", async ({
    page,
  }) => {
    await openFresh(page);
    await type(page, "crane");
    await page.getByTestId("daily-word-key-enter").click();
    // Straight away, before the row has finished turning.
    await page.getByTestId("tile-0-4").waitFor();
    await expect
      .poll(async () => {
        await type(page, "s");
        return page.getByTestId("tile-1-0").textContent();
      })
      .toMatch(/s/i);
  });
});
