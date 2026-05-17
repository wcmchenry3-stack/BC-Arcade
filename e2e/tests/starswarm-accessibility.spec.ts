/**
 * starswarm-accessibility.spec.ts — GH #1562
 *
 * Accessibility smoke tests for the Star Swarm screen.
 *
 * Star Swarm is canvas-rendered; tests verify the canvas accessible label,
 * the game heading role, keyboard interaction does not trap or lose focus,
 * and the axe-core WCAG 2.2 AA scan passes.
 */

import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mockStarswarmApi, gotoStarswarm } from "./helpers/starswarm";

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

test.describe("Star Swarm — accessibility", () => {
  test.beforeEach(async ({ page }) => {
    await mockStarswarmApi(page);
    await gotoStarswarm(page);
  });

  test("game canvas has descriptive accessible label", async ({ page }) => {
    await expect(
      page.getByRole("img", { name: /Star Swarm game/i }),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("game screen heading has correct accessible text", async ({ page }) => {
    await expect(
      page.getByRole("heading", { name: "Star Swarm", exact: true }),
    ).toBeVisible({ timeout: 5_000 });
  });

  test("arrow key navigation does not trap focus", async ({ page }) => {
    await expect(
      page.getByRole("img", { name: /Star Swarm game/i }),
    ).toBeVisible({ timeout: 10_000 });
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowRight");
    await expect(
      page.getByRole("img", { name: /Star Swarm game/i }),
    ).toBeVisible({ timeout: 3_000 });
  });

  test("Tab key navigation does not trap focus on the canvas", async ({ page }) => {
    await expect(
      page.getByRole("img", { name: /Star Swarm game/i }),
    ).toBeVisible({ timeout: 10_000 });
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("img", { name: /Star Swarm game/i }),
    ).toBeVisible({ timeout: 3_000 });
  });

  test("game screen passes axe-core WCAG 2.2 AA scan", async ({ page }) => {
    await expect(
      page.getByRole("img", { name: /Star Swarm game/i }),
    ).toBeVisible({ timeout: 10_000 });
    await assertNoA11yViolations(
      new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]),
    );
  });
});
