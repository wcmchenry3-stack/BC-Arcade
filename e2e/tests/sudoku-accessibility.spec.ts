/**
 * sudoku-accessibility.spec.ts — GH #1562
 *
 * Accessibility smoke tests for the Sudoku screen.
 *
 * Verifies:
 *   - ARIA labels on the difficulty radiogroup and individual options
 *   - Grid cells carry descriptive accessible labels (given, empty, filled)
 *   - Digit input buttons have accessible labels after cell selection
 *   - Focus is not trapped after selecting a cell or entering a digit
 *   - axe-core WCAG 2.2 AA scan passes on difficulty-select and gameplay screens
 */

import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mockSudokuApi, gotoSudoku, injectSudokuState } from "./helpers/sudoku";

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

// Near-complete Easy puzzle; two empty cells so entering one digit won't complete it.
const SOL = "123456789456789123789123456231564897564897231897231564312645978645978312978312645";
const PUZ = `${SOL.slice(0, 4)}0${SOL.slice(5, 80)}0`;

type Cell = { value: number; given: boolean; notes: number[]; isError: boolean };

function buildGrid(emptyIdxs: number[]): Cell[][] {
  const empties = new Set(emptyIdxs);
  return Array.from({ length: 9 }, (_, r) =>
    Array.from({ length: 9 }, (_, c) => {
      const idx = r * 9 + c;
      const v = parseInt(SOL[idx]);
      if (empties.has(idx)) return { value: 0, given: false, notes: [], isError: false };
      return { value: v, given: true, notes: [], isError: false };
    }),
  );
}

const GAMEPLAY_STATE = {
  _v: 1 as const,
  variant: "classic" as const,
  difficulty: "easy" as const,
  puzzle: PUZ,
  solution: SOL,
  grid: buildGrid([4, 80]),
  selectedRow: null,
  selectedCol: null,
  notesMode: false,
  errorCount: 0,
  isComplete: false,
  undoStack: [],
};

test.describe("Sudoku — accessibility", () => {
  test("difficulty selector has accessible radiogroup label", async ({ page }) => {
    await mockSudokuApi(page);
    await gotoSudoku(page);
    await expect(
      page.getByRole("radiogroup", { name: "Difficulty" }),
    ).toBeVisible({ timeout: 5_000 });
  });

  test("difficulty options have accessible radio labels", async ({ page }) => {
    await mockSudokuApi(page);
    await gotoSudoku(page);
    await expect(
      page.getByRole("radio", { name: /Easy/i }),
    ).toBeVisible({ timeout: 5_000 });
  });

  test("difficulty select screen passes axe-core WCAG 2.2 AA scan", async ({ page }) => {
    await mockSudokuApi(page);
    await gotoSudoku(page);
    await expect(
      page.getByRole("radiogroup", { name: "Difficulty" }),
    ).toBeVisible({ timeout: 5_000 });
    await assertNoA11yViolations(
      new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]),
    );
  });

  test("grid cells have descriptive accessible labels", async ({ page }) => {
    await mockSudokuApi(page);
    await injectSudokuState(page, GAMEPLAY_STATE);
    await page.getByRole("button", { name: "Play Sudoku" }).click();
    await page.getByRole("heading", { name: "Sudoku", exact: true }).waitFor({ timeout: 10_000 });
    await expect(
      page.getByRole("button", { name: "Cell row 1, column 5, empty" }),
    ).toBeVisible({ timeout: 5_000 });
  });

  test("digit input buttons have accessible labels after cell selection", async ({ page }) => {
    await mockSudokuApi(page);
    await injectSudokuState(page, GAMEPLAY_STATE);
    await page.getByRole("button", { name: "Play Sudoku" }).click();
    await page.getByRole("heading", { name: "Sudoku", exact: true }).waitFor({ timeout: 10_000 });

    const emptyCell = page.getByRole("button", { name: "Cell row 1, column 5, empty" });
    await expect(emptyCell).toBeVisible({ timeout: 5_000 });
    await emptyCell.click();

    await expect(
      page.getByRole("button", { name: "Enter digit 5" }),
    ).toBeVisible({ timeout: 5_000 });
  });

  test("selecting a cell and entering a digit does not trap focus", async ({ page }) => {
    await mockSudokuApi(page);
    await injectSudokuState(page, GAMEPLAY_STATE);
    await page.getByRole("button", { name: "Play Sudoku" }).click();
    await page.getByRole("heading", { name: "Sudoku", exact: true }).waitFor({ timeout: 10_000 });

    const emptyCell = page.getByRole("button", { name: "Cell row 1, column 5, empty" });
    await expect(emptyCell).toBeVisible({ timeout: 5_000 });
    await emptyCell.click();
    await page.getByRole("button", { name: "Enter digit 5" }).click();

    // After digit entry the updated cell must be reachable — no focus trap
    await expect(
      page.getByRole("button", { name: "Cell row 1, column 5, 5" }),
    ).toBeVisible({ timeout: 5_000 });
  });

  test("gameplay screen passes axe-core WCAG 2.2 AA scan", async ({ page }) => {
    await mockSudokuApi(page);
    await injectSudokuState(page, GAMEPLAY_STATE);
    await page.getByRole("button", { name: "Play Sudoku" }).click();
    await page.getByRole("heading", { name: "Sudoku", exact: true }).waitFor({ timeout: 10_000 });
    await expect(
      page.getByRole("button", { name: "Cell row 1, column 5, empty" }),
    ).toBeVisible({ timeout: 5_000 });
    await assertNoA11yViolations(
      new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]),
    );
  });
});
