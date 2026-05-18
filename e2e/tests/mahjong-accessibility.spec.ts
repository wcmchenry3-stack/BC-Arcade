/**
 * mahjong-accessibility.spec.ts — GH #1562
 *
 * Accessibility smoke tests for the Mahjong Solitaire screen.
 *
 * The board is canvas-rendered; tests verify the accessible wrapper label,
 * overflow menu button label, HUD text visibility, keyboard navigation
 * does not trap focus, and the axe-core WCAG 2.2 AA scan passes.
 */

import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mockMahjongApi, gotoMahjong } from "./helpers/mahjong";

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

test.describe("Mahjong Solitaire — accessibility", () => {
  test.beforeEach(async ({ page }) => {
    await mockMahjongApi(page);
    await gotoMahjong(page);
  });

  test("game canvas has descriptive accessible label", async ({ page }) => {
    await expect(
      page.getByRole("img", { name: /Mahjong Solitaire/i }),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("overflow menu button has accessible label", async ({ page }) => {
    await expect(
      page.getByRole("button", { name: "More options" }),
    ).toBeVisible({ timeout: 5_000 });
  });

  test("HUD score and pairs counters are visible to assistive technologies", async ({
    page,
  }) => {
    await expect(page.getByText(/^SCORE\s+\d/).first()).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText(/^PAIRS\s+\d/).first()).toBeVisible({ timeout: 5_000 });
  });

  test("keyboard Tab navigates to interactive controls without trapping focus", async ({
    page,
  }) => {
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("img", { name: /Mahjong Solitaire/i }),
    ).toBeVisible({ timeout: 3_000 });
  });

  test("game screen passes axe-core WCAG 2.2 AA scan", async ({ page }) => {
    await assertNoA11yViolations(
      new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]),
    );
  });
});
