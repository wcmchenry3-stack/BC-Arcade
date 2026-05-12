/**
 * sort-accessibility.spec.ts — GH #1255
 *
 * WCAG 2.2 AA axe-core scan on level-select and gameplay screens; bottle
 * accessible labels; undo aria-disabled state.
 */

import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mockSortApi, gotoSort, injectSortProgress } from "./helpers/sort";

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

test.describe("Sort Puzzle — accessibility", () => {
  test("level-select screen passes axe-core WCAG 2.2 AA scan", async ({ page }) => {
    await mockSortApi(page);
    await gotoSort(page);
    await assertNoA11yViolations(
      new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]),
    );
  });

  test("gameplay screen passes axe-core WCAG 2.2 AA scan", async ({ page }) => {
    await mockSortApi(page);
    await gotoSort(page);
    await page.getByRole("button", { name: "Level 1" }).click();
    await expect(page.getByLabel("Sort Puzzle board")).toBeVisible({ timeout: 5_000 });
    await assertNoA11yViolations(
      new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]),
    );
  });

  test("board region has accessible label", async ({ page }) => {
    await mockSortApi(page);
    await gotoSort(page);
    await page.getByRole("button", { name: "Level 1" }).click();
    await expect(page.getByLabel("Sort Puzzle board")).toBeVisible({ timeout: 5_000 });
  });

  test("bottles have descriptive accessible labels", async ({ page }) => {
    await mockSortApi(page);
    await gotoSort(page);
    await page.getByRole("button", { name: "Level 1" }).click();
    await expect(page.getByLabel("Sort Puzzle board")).toBeVisible({ timeout: 5_000 });

    // Filled bottles describe content
    await expect(
      page.getByRole("button", { name: "Bottle 1, 4 of 4 filled" }),
    ).toBeVisible({ timeout: 3_000 });
    // Empty bottles are labelled as empty
    await expect(
      page.getByRole("button", { name: "Bottle 3, empty" }),
    ).toBeVisible({ timeout: 3_000 });
  });

  test("selected bottle label announces selected state", async ({ page }) => {
    await mockSortApi(page);
    await gotoSort(page);
    await page.getByRole("button", { name: "Level 1" }).click();
    await expect(page.getByLabel("Sort Puzzle board")).toBeVisible({ timeout: 5_000 });

    await page.getByRole("button", { name: "Bottle 1, 4 of 4 filled" }).click();
    await expect(
      page.getByRole("button", {
        name: "Bottle 1 selected — tap another bottle to pour",
      }),
    ).toBeVisible({ timeout: 3_000 });
  });

  test("solved bottle label announces complete state", async ({ page }) => {
    await mockSortApi(page);
    await injectSortProgress(page, {
      unlockedLevel: 1,
      currentLevelId: 1,
      currentState: {
        bottles: [["red", "red", "red", "red"], ["blue"], [], []],
        moveCount: 3,
        undosUsed: 0,
        isComplete: false,
        selectedBottleIndex: null,
      },
    });
    await page.getByRole("button", { name: "Play Sort Puzzle" }).click();
    await page.getByText("Choose a Level").waitFor({ timeout: 10_000 });
    await page.getByRole("button", { name: "Continue Level 1" }).click();
    await expect(page.getByLabel("Sort Puzzle board")).toBeVisible({ timeout: 5_000 });
    await expect(
      page.getByRole("button", { name: "Bottle 1, complete" }),
    ).toBeVisible({ timeout: 3_000 });
  });

  test("undo button has aria-disabled when history is empty", async ({ page }) => {
    await mockSortApi(page);
    await gotoSort(page);
    await page.getByRole("button", { name: "Level 1" }).click();
    await expect(page.getByLabel("Sort Puzzle board")).toBeVisible({ timeout: 5_000 });

    const undoBtn = page.getByRole("button", { name: "Undo" });
    await expect(undoBtn).toBeDisabled({ timeout: 3_000 });
  });
});
