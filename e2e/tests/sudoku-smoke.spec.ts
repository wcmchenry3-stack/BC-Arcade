import { test, expect } from "@playwright/test";
import { mockSudokuApi, gotoSudoku } from "./helpers/sudoku";

test.describe("Sudoku — smoke tests", () => {
  test.beforeEach(async ({ page }) => {
    await mockSudokuApi(page);
    await gotoSudoku(page);
  });

  test("navigates from Home to Sudoku screen", async ({ page }) => {
    await expect(
      page.getByRole("heading", { name: "Sudoku", exact: true }),
    ).toBeVisible();
  });

  test("pre-game difficulty selector is visible on first load", async ({ page }) => {
    await expect(
      page.getByRole("radiogroup", { name: "Difficulty" }),
    ).toBeVisible({ timeout: 5_000 });
  });
});
