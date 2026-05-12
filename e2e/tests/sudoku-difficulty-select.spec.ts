import { test, expect } from "@playwright/test";
import { mockSudokuApi, gotoSudoku } from "./helpers/sudoku";

test.describe("Sudoku — difficulty select", () => {
  test("selecting Easy and starting renders the 9×9 grid with pre-filled clue cells", async ({
    page,
  }) => {
    await mockSudokuApi(page);
    await gotoSudoku(page);

    await page.getByRole("radio", { name: "Easy" }).click();
    await page.getByRole("button", { name: "Start" }).click();

    await page.getByLabel("Sudoku board").waitFor({ timeout: 10_000 });

    // At least one pre-filled clue cell (given digit 1–9) should be visible.
    await expect(
      page
        .getByRole("button", { name: /Cell row \d+, column \d+, [1-9]/ })
        .first(),
    ).toBeVisible({ timeout: 5_000 });
  });
});
