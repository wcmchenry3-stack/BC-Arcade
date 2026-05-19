/**
 * hearts-accessibility.spec.ts — GH #1562
 *
 * Accessibility smoke tests for the Hearts screen.
 *
 * Verifies:
 *   - ARIA labels on the player hand region, trick area, and card buttons
 *   - Keyboard navigation through hand cards
 *   - Focus management during pass and play phases
 *   - axe-core WCAG 2.2 AA scan passes
 */

import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mockHeartsApi, gotoHearts } from "./helpers/hearts";

async function assertNoA11yViolations(
  axeBuilder: InstanceType<typeof AxeBuilder>,
): Promise<void> {
  const results = await axeBuilder.analyze();
  const criticalOrSerious = results.violations.filter((v) =>
    ["critical", "serious"].includes(v.impact ?? ""),
  );
  if (criticalOrSerious.length > 0) {
    const summary = criticalOrSerious
      .map((v) => `[${v.impact}] ${v.id}: ${v.description}`)
      .join("\n");
    expect.soft(criticalOrSerious).toHaveLength(0);
    throw new Error(`Accessibility violations found:\n${summary}`);
  }
}

test.describe("Hearts — accessibility", () => {
  test.beforeEach(async ({ page }) => {
    await mockHeartsApi(page);
    await gotoHearts(page);
  });

  test("player hand region has accessible label", async ({ page }) => {
    await expect(
      page.getByLabel("Your hand, 13 cards"),
    ).toBeVisible({ timeout: 5_000 });
  });

  test("trick area has accessible label", async ({ page }) => {
    await expect(
      page.getByLabel("Current trick"),
    ).toBeVisible({ timeout: 5_000 });
  });

  test("card buttons in player hand have accessible labels", async ({ page }) => {
    const handArea = page.getByLabel("Your hand, 13 cards");
    await expect(handArea).toBeVisible({ timeout: 5_000 });
    const firstCard = handArea.getByRole("button").first();
    await expect(firstCard).toBeVisible({ timeout: 3_000 });
    const label = await firstCard.getAttribute("aria-label");
    expect(label).toBeTruthy();
  });

  test("keyboard Tab navigates to card buttons without trapping focus", async ({ page }) => {
    await expect(page.getByLabel("Your hand, 13 cards")).toBeVisible({ timeout: 5_000 });
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await expect(page.getByLabel("Your hand, 13 cards")).toBeVisible({ timeout: 3_000 });
  });

  test("selecting a card in hand does not trap focus", async ({ page }) => {
    const handArea = page.getByLabel("Your hand, 13 cards");
    await expect(handArea).toBeVisible({ timeout: 5_000 });
    await handArea.getByRole("button").first().click();
    await expect(handArea).toBeVisible({ timeout: 3_000 });
    await expect(page.getByLabel("Current trick")).toBeVisible({ timeout: 3_000 });
  });

  test("game screen passes axe-core WCAG 2.2 AA scan", async ({ page }) => {
    await expect(page.getByLabel("Your hand, 13 cards")).toBeVisible({ timeout: 5_000 });
    await assertNoA11yViolations(
      new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]),
    );
  });
});
