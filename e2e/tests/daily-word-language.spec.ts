/**
 * daily-word-language.spec.ts — GH #3153
 *
 * Daily Word puzzle language follows the app language, gated by build flavour
 * (`getLanguage()` in todayMeta.ts). Playwright runs against an *internal*
 * build (EXPO_PUBLIC_TEST_HOOKS=1), where the Hindi puzzle is deliberately
 * still reachable, so this spec covers the flag-on side: Hindi selects the
 * Hindi puzzle and the Devanagari keyboard. The flag-off side (store build:
 * `hi` falls back to the English puzzle and QWERTY keyboard) cannot be
 * reached from e2e without a store-build web export; it is covered by Jest
 * (todayMeta.test.ts, DailyWordScreen.test.tsx).
 */

import { test, expect } from "@playwright/test";
import { installEntitlementsMock } from "./helpers/api-mock";
import { mockDailyWordApi } from "./helpers/daily_word";

test.describe("Daily Word — puzzle language (internal build)", () => {
  test("English app language requests the English puzzle with the QWERTY keyboard", async ({
    page,
  }) => {
    await installEntitlementsMock(page);
    await mockDailyWordApi(page);
    const todayUrls: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes("/daily-word/today")) todayUrls.push(r.url());
    });
    await page.goto("/");
    await page.getByRole("button", { name: "Play Daily Word" }).click();
    await expect(
      page.getByRole("button", { name: "A", exact: true }),
    ).toBeVisible();
    expect(todayUrls.length).toBeGreaterThan(0);
    expect(todayUrls.every((u) => u.includes("lang=en"))).toBe(true);
  });

  test("Hindi app language (flag on) requests the Hindi puzzle with the Devanagari keyboard", async ({
    page,
  }) => {
    await installEntitlementsMock(page);
    await mockDailyWordApi(page);
    const todayUrls: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes("/daily-word/today")) todayUrls.push(r.url());
    });
    await page.goto("/");
    await page.getByRole("tab", { name: "Settings" }).click();
    await page.getByTestId("lang-switcher-select").selectOption("hi");
    await page.getByRole("tab", { name: "लॉबी" }).click();
    await page.getByRole("button", { name: "डेली वर्ड खेलें" }).click();
    await expect(
      page.getByRole("button", { name: "क", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "A", exact: true }),
    ).toHaveCount(0);
    expect(todayUrls.some((u) => u.includes("lang=hi"))).toBe(true);
  });
});
