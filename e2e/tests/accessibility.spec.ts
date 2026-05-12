/**
 * accessibility.spec.ts
 *
 * WCAG 2.2 AA accessibility audit using axe-core via @axe-core/playwright.
 *
 * Checks each main screen for zero critical or serious axe violations.
 * This supplements the existing unit-level accessibility attributes and
 * provides end-to-end assurance in the real rendered DOM.
 */

import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { installYachtGameMock, installEntitlementsMock } from "./helpers/api-mock";

const API_BASE = "http://localhost:8000";

/** Run axe on the current page and assert no critical/serious violations. */
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
    expect.soft(criticalOrSerious).toHaveLength(0); // soft so all violations are reported
    throw new Error(`Accessibility violations found:\n${summary}`);
  }
}

test.describe("Accessibility — Home screen", () => {
  test("no critical/serious axe violations on Home", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("BC Arcade").first()).toBeVisible();

    await assertNoA11yViolations(
      new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]),
    );
  });
});

test.describe("Accessibility — Yacht game screen", () => {
  test("no critical/serious axe violations on Game screen (pre-roll)", async ({
    page,
  }) => {
    await installEntitlementsMock(page);
    await installYachtGameMock(page);
    await page.goto("/");

    await page.getByRole("button", { name: "Play Yacht" }).click();
    await expect(page.getByText("Round 1 / 13")).toBeVisible();

    await assertNoA11yViolations(
      new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]),
    );
  });

  test("no critical/serious axe violations on Game screen (post-roll)", async ({
    page,
  }) => {
    await installEntitlementsMock(page);
    await installYachtGameMock(page);
    await page.goto("/");

    await page.getByRole("button", { name: "Play Yacht" }).click();
    await page.getByRole("button", { name: /Roll/i }).click();

    await assertNoA11yViolations(
      new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]),
    );
  });
});

test.describe("Accessibility — Cascade screen", () => {
  test.beforeEach(async ({ page }) => {
    await installEntitlementsMock(page);
    await page.route(`${API_BASE}/cascade/**`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ scores: [] }),
      });
    });
  });

  test("no critical/serious axe violations on Cascade screen", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Play Cascade" }).click();
    await expect(
      page.getByRole("heading", { name: "Cascade", exact: true }),
    ).toBeVisible({ timeout: 10000 });

    await assertNoA11yViolations(
      new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        // Canvas elements are exempt from color-contrast checks on their drawn content
        .exclude("canvas"),
    );
  });
});
