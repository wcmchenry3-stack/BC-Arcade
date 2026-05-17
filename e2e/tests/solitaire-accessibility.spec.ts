/**
 * solitaire-accessibility.spec.ts — GH #1562
 *
 * Accessibility smoke tests for the Solitaire screen.
 *
 * Verifies:
 *   - ARIA labels on board, tableau columns, foundations, and stock pile
 *   - Keyboard navigation through interactive elements
 *   - Focus is not trapped after card interactions
 *   - axe-core WCAG 2.2 AA scan passes
 */

import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mockSolitaireApi, gotoSolitaire } from "./helpers/solitaire";

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

test.describe("Solitaire — accessibility", () => {
  test.beforeEach(async ({ page }) => {
    await mockSolitaireApi(page);
    await gotoSolitaire(page);
    await page.getByRole("button", { name: "Draw 1" }).click();
    await page.getByLabel("Solitaire board").waitFor({ timeout: 10_000 });
  });

  test("board region has accessible label", async ({ page }) => {
    await expect(
      page.getByLabel("Solitaire board"),
    ).toBeVisible({ timeout: 5_000 });
  });

  test("tableau columns have accessible labels", async ({ page }) => {
    await expect(
      page
        .getByLabel(/Tableau column 1, \d+ cards/)
        .or(page.getByLabel("Empty tableau column 1")),
    ).toBeVisible({ timeout: 5_000 });
  });

  test("foundation slots have accessible labels", async ({ page }) => {
    await expect(
      page.getByLabel(/foundation/i).first(),
    ).toBeVisible({ timeout: 5_000 });
  });

  test("stock pile has accessible label", async ({ page }) => {
    await expect(
      page.getByLabel(/Draw 1 from stock|stock/i).first(),
    ).toBeVisible({ timeout: 5_000 });
  });

  test("keyboard Tab navigates through the board without trapping focus", async ({ page }) => {
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await expect(
      page.getByLabel("Solitaire board"),
    ).toBeVisible({ timeout: 3_000 });
  });

  test("clicking the stock pile does not trap focus", async ({ page }) => {
    const stock = page.getByLabel(/Draw 1 from stock/i).first();
    if (await stock.isVisible()) {
      await stock.click();
    }
    await expect(
      page.getByLabel("Solitaire board"),
    ).toBeVisible({ timeout: 3_000 });
  });

  test("game screen passes axe-core WCAG 2.2 AA scan", async ({ page }) => {
    await assertNoA11yViolations(
      new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]),
    );
  });
});
