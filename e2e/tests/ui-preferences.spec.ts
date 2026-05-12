/**
 * ui-preferences.spec.ts
 *
 * E2E tests for the theme mode segmented control and language switcher, both
 * of which live on the Settings tab (the lobby redesign in #309/#326 moved
 * them off Home).
 *
 * Theme: a System / Light / Dark segmented control (#710) — verifies the
 * clicked segment becomes the selected one and persists across tab navigation.
 * Selection is read from aria-checked because RN Web 0.21 does not render
 * accessibilityState to ARIA attributes.
 *
 * Language: switching to a non-English locale changes visible UI copy in the
 * lobby. On web, LanguageSwitcher.web.tsx renders a native <select>, so tests
 * use .selectOption() directly. The testID is used instead of the aria-label
 * because the label localizes, which broke the round-trip test historically.
 */

import { test, expect, type Page } from "./fixtures";

async function gotoSettings(page: Page) {
  await page.goto("/");
  // BottomTabBar exposes each tab with role=tab; initial load is English so
  // "Settings" is valid here — only mid-test locale switches change the label.
  await page.getByRole("tab", { name: "Settings" }).click();
  await expect(page.getByTestId("theme-mode-segmented")).toBeVisible();
}

test.describe("Theme mode segmented control", () => {
  test.beforeEach(async ({ page }) => {
    await gotoSettings(page);
  });

  test("all three theme modes are visible in Settings", async ({ page }) => {
    await expect(page.getByTestId("theme-mode-segmented")).toBeVisible();
    await expect(page.getByTestId("theme-mode-system")).toBeVisible();
    await expect(page.getByTestId("theme-mode-light")).toBeVisible();
    await expect(page.getByTestId("theme-mode-dark")).toBeVisible();
  });

  test("clicking a theme mode marks it selected", async ({ page }) => {
    await page.getByTestId("theme-mode-light").click();
    await expect(page.getByTestId("theme-mode-light")).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await expect(page.getByTestId("theme-mode-dark")).toHaveAttribute(
      "aria-checked",
      "false",
    );

    await page.getByTestId("theme-mode-dark").click();
    await expect(page.getByTestId("theme-mode-dark")).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await expect(page.getByTestId("theme-mode-light")).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });

  test("theme mode persists across tab navigation", async ({ page }) => {
    await page.getByTestId("theme-mode-light").click();
    await expect(page.getByTestId("theme-mode-light")).toHaveAttribute(
      "aria-checked",
      "true",
    );

    await page.getByRole("tab", { name: "Lobby" }).click();
    await page.getByRole("tab", { name: "Settings" }).click();

    await expect(page.getByTestId("theme-mode-light")).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });
});

test.describe("Language switcher", () => {
  test.beforeEach(async ({ page }) => {
    await gotoSettings(page);
  });

  test("language switcher is visible in Settings", async ({ page }) => {
    await expect(page.getByTestId("lang-switcher-select")).toBeVisible();
  });

  test("switching to Spanish shows Spanish UI copy", async ({ page }) => {
    await page.getByTestId("lang-switcher-select").selectOption("es");

    await page.getByRole("tab", { name: "Lobby" }).click();
    await expect(page.getByRole("button", { name: "Jugar Yacht" })).toBeVisible(
      {
        timeout: 3000,
      },
    );
  });

  test("switching to German shows German UI copy", async ({ page }) => {
    await page.getByTestId("lang-switcher-select").selectOption("de");

    await page.getByRole("tab", { name: "Lobby" }).click();
    await expect(
      page.getByRole("button", { name: "Yacht spielen" }),
    ).toBeVisible({
      timeout: 3000,
    });
  });

  test("switching language and back to English restores English copy", async ({
    page,
  }) => {
    await page.getByTestId("lang-switcher-select").selectOption("es");

    await page.getByRole("tab", { name: "Lobby" }).click();
    await expect(page.getByRole("button", { name: "Jugar Yacht" })).toBeVisible(
      {
        timeout: 3000,
      },
    );

    // Back to Settings — UI is now in Spanish so the tab label is "Ajustes".
    // BottomTabBar uses t("nav.settings") so the accessible name localizes.
    await page.getByRole("tab", { name: "Ajustes" }).click();
    await page.getByTestId("lang-switcher-select").selectOption("en");

    await page.getByRole("tab", { name: "Lobby" }).click();
    await expect(page.getByRole("button", { name: "Play Yacht" })).toBeVisible({
      timeout: 3000,
    });
  });
});
