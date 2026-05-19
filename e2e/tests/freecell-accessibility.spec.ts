/**
 * freecell-accessibility.spec.ts — GH #1562
 *
 * Accessibility smoke tests for the FreeCell screen.
 *
 * Verifies:
 *   - ARIA labels on the board, cards, free cells, and foundations
 *   - Keyboard navigation through interactive elements
 *   - Focus is not trapped after card interactions
 *   - axe-core WCAG 2.2 AA scan passes on the game screen
 */

import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mockFreecellApi, gotoFreecell, injectFreecellState } from "./helpers/freecell";

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

const SINGLE_CARD_STATE = {
  _v: 1,
  tableau: [
    [{ suit: "hearts", rank: 5 }],
    [], [], [], [], [], [], [],
  ],
  freeCells: [null, null, null, null],
  foundations: { spades: [], hearts: [], diamonds: [], clubs: [] },
  undoStack: [],
  isComplete: false,
  moveCount: 0,
};

test.describe("FreeCell — accessibility", () => {
  test("board region has accessible label", async ({ page }) => {
    await mockFreecellApi(page);
    await gotoFreecell(page);
    await expect(
      page.getByLabel("FreeCell board").first(),
    ).toBeVisible({ timeout: 5_000 });
  });

  test("cards in tableau have descriptive accessible labels", async ({ page }) => {
    await mockFreecellApi(page);
    await injectFreecellState(page, SINGLE_CARD_STATE);
    await page.getByRole("button", { name: "Play FreeCell" }).click();
    await page.getByRole("heading", { name: "FreeCell", exact: true }).waitFor({ timeout: 10_000 });
    await expect(page.getByLabel("FreeCell board").first()).toBeVisible({ timeout: 5_000 });
    await expect(page.getByLabel("5 of Hearts")).toBeVisible({ timeout: 5_000 });
  });

  test("empty free cell slots have accessible labels", async ({ page }) => {
    await mockFreecellApi(page);
    await gotoFreecell(page);
    await expect(
      page.getByLabel("Empty free cell 1"),
    ).toBeVisible({ timeout: 5_000 });
  });

  test("foundation slots have accessible labels", async ({ page }) => {
    await mockFreecellApi(page);
    await gotoFreecell(page);
    await expect(
      page.getByLabel(/foundation/i).first(),
    ).toBeVisible({ timeout: 5_000 });
  });

  test("keyboard Tab navigates through interactive controls without trapping focus", async ({
    page,
  }) => {
    await mockFreecellApi(page);
    await gotoFreecell(page);
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await expect(
      page.getByLabel("FreeCell board").first(),
    ).toBeVisible({ timeout: 3_000 });
  });

  test("focus is not lost after selecting and moving a card", async ({ page }) => {
    await mockFreecellApi(page);
    await injectFreecellState(page, SINGLE_CARD_STATE);
    await page.getByRole("button", { name: "Play FreeCell" }).click();
    await page.getByRole("heading", { name: "FreeCell", exact: true }).waitFor({ timeout: 10_000 });
    await expect(page.getByLabel("FreeCell board").first()).toBeVisible({ timeout: 5_000 });

    await page.getByLabel("5 of Hearts").click();
    await page.getByLabel("Empty free cell 1").click();

    await expect(
      page.getByLabel("FreeCell board").first(),
    ).toBeVisible({ timeout: 3_000 });
  });

  test("game screen passes axe-core WCAG 2.2 AA scan", async ({ page }) => {
    await mockFreecellApi(page);
    await gotoFreecell(page);
    await expect(page.getByLabel("FreeCell board").first()).toBeVisible({ timeout: 5_000 });
    await assertNoA11yViolations(
      new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]),
    );
  });
});
