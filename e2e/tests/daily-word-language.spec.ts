/**
 * daily-word-language.spec.ts — GH #3153
 *
 * Daily Word puzzle language follows the app language (`getLanguage()` in
 * todayMeta.ts). Native store builds hold the Hindi puzzle back; web (what
 * Playwright runs) keeps every language, as with locales. So this spec covers
 * the web side: Hindi selects the Hindi puzzle and the Devanagari keyboard,
 * English the English puzzle and QWERTY. The native-store fallback to English
 * cannot be reached from web; Jest covers it (todayMeta.test.ts,
 * DailyWordScreen.test.tsx).
 */

import { test, expect, type Page } from "@playwright/test";
import { installEntitlementsMock } from "./helpers/api-mock";
import { mockDailyWordApi } from "./helpers/daily_word";

/** Mock /today to answer per requested language, recording each request. */
async function mockTodayByLang(page: Page): Promise<string[]> {
  await installEntitlementsMock(page);
  await mockDailyWordApi(page);
  const langs: string[] = [];
  await page.route("**/daily-word/today**", async (route) => {
    const lang =
      new URL(route.request().url()).searchParams.get("lang") ?? "en";
    langs.push(lang);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ puzzle_id: `2026-05-03:${lang}`, word_length: 5 }),
    });
  });
  return langs;
}

test.describe("Daily Word — puzzle language (web)", () => {
  test("English app language requests the English puzzle with the QWERTY keyboard", async ({
    page,
  }) => {
    const langs = await mockTodayByLang(page);
    await page.goto("/");
    await page.getByRole("button", { name: "Play Daily Word" }).click();
    await expect(
      page.getByRole("button", { name: "Q", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "क", exact: true }),
    ).toHaveCount(0);
    expect(langs.length).toBeGreaterThan(0);
    expect(langs.every((l) => l === "en")).toBe(true);
  });

  test("Hindi app language requests the Hindi puzzle with the Devanagari keyboard", async ({
    page,
  }) => {
    const langs = await mockTodayByLang(page);
    await page.goto("/");
    await page.getByRole("tab", { name: "Settings" }).click();
    await page.getByTestId("lang-switcher-select").selectOption("hi");
    await page.getByRole("tab", { name: "लॉबी" }).click();
    await page.getByRole("button", { name: "डेली वर्ड खेलें" }).click();
    await expect(
      page.getByRole("button", { name: "क", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Q", exact: true }),
    ).toHaveCount(0);
    expect(langs.length).toBeGreaterThan(0);
    // Home may warm the English puzzle before the switch; the screen's request is the last.
    expect(langs.at(-1)).toBe("hi");
  });
});
