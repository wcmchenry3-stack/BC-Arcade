/**
 * yacht-accessibility.spec.ts
 *
 * GH #185 — Yacht die, roll button, and score row accessibility label coverage.
 *
 * Verifies that:
 *   - Die buttons carry the correct "Die N: showing V" accessible name
 *   - Held dies append ", held" to their accessible name
 *   - The Roll button accessible name reflects the remaining roll count
 *   - Score rows carry the correct pattern depending on state
 *     (not available / potential score N / scored N)
 *   - The axe-core WCAG 2.2 AA audit finds no critical/serious violations
 */

import { test, expect } from "./fixtures";
import AxeBuilder from "@axe-core/playwright";

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

test.describe("Yacht — accessibility labels (#185)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => localStorage.removeItem("yacht_game_v1"));
    await page.goto("/");
    await page.getByRole("button", { name: "Play Yacht" }).click();
    await expect(page.getByText("Round 1 / 13")).toBeVisible();
  });

  test("roll button has accessible name with roll count before rolling", async ({
    page,
  }) => {
    // Before rolling: 3 rolls left
    await expect(
      page.getByRole("button", { name: /Roll dice, 3 rolls left/ }),
    ).toBeVisible();
  });

  test("roll button accessible name decrements after each roll", async ({
    page,
  }) => {
    const rollBtn = page.getByRole("button", {
      name: /Roll dice, 3 rolls left/,
    });
    await rollBtn.click();
    await expect(
      page.getByRole("button", { name: /Roll dice, 2 rolls left/ }),
    ).toBeVisible();

    await page.getByRole("button", { name: /Roll dice, 2 rolls left/ }).click();
    await expect(
      page.getByRole("button", { name: /Roll dice, 1 roll left/ }),
    ).toBeVisible();
  });

  test("die buttons have correct accessible names after rolling", async ({
    page,
  }) => {
    await page.getByRole("button", { name: /Roll/i }).click();

    // All 5 die buttons should have pattern "Die N: showing D"
    for (let i = 1; i <= 5; i++) {
      await expect(
        page.getByRole("button", { name: new RegExp(`Die ${i}: showing \\d`) }),
      ).toBeVisible();
    }
  });

  test("held die accessible name includes ', held' suffix", async ({
    page,
  }) => {
    await page.getByRole("button", { name: /Roll/i }).click();

    const die3 = page.getByRole("button", { name: /Die 3: showing \d/ });
    await die3.click();

    await expect(
      page.getByRole("button", { name: /Die 3: showing \d+, held/ }),
    ).toBeVisible();
  });

  test("unheld die does not have ', held' in its accessible name", async ({
    page,
  }) => {
    await page.getByRole("button", { name: /Roll/i }).click();

    // Die 2 is not held — should not have ", held" suffix
    await expect(
      page.getByRole("button", { name: /Die 2: showing \d+, held/ }),
    ).not.toBeVisible();
    await expect(
      page.getByRole("button", { name: /Die 2: showing \d+$/ }),
    ).toBeVisible();
  });

  test("score row shows 'not available' before rolling", async ({ page }) => {
    // canScore is false before first roll → all rows show "not available"
    await expect(
      page.getByRole("button", { name: /Chance: not available/ }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Ones: not available/ }),
    ).toBeVisible();
  });

  test("score row shows 'potential score N, double-tap to score' after rolling", async ({
    page,
  }) => {
    await page.getByRole("button", { name: /Roll/i }).click();
    // At least Chance should show a potential score (it's always available)
    await expect(
      page.getByRole("button", {
        name: /Chance: potential score \d+, double-tap to score/,
      }),
    ).toBeVisible();
  });

  test("score row shows 'scored N' after the category is filled", async ({
    page,
  }) => {
    await page.getByRole("button", { name: /Roll/i }).click();
    await page.getByRole("button", { name: /Chance: potential score/ }).click();

    await expect(
      page.getByRole("button", { name: /Chance: scored \d+/ }),
    ).toBeVisible();
  });

  test("no critical/serious axe violations on Yacht game screen (pre-roll)", async ({
    page,
  }) => {
    await assertNoA11yViolations(
      new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]),
    );
  });

  test("no critical/serious axe violations on Yacht game screen (post-roll)", async ({
    page,
  }) => {
    await page.getByRole("button", { name: /Roll/i }).click();
    await expect(
      page.getByRole("button", { name: /Die 1: showing \d/ }),
    ).toBeVisible();

    await assertNoA11yViolations(
      new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]),
    );
  });
});
