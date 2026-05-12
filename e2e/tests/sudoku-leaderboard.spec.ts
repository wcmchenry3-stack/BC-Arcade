import { test, expect } from "./fixtures";
import { injectSudokuState } from "./helpers/sudoku";

const SOL = "123456789456789123789123456231564897564897231897231564312645978645978312978312645";

// Puzzle marks only the last cell (row 9, col 9, index 80) as empty.
// Entering digit 5 there fills the final cell and completes the puzzle.
const PUZ = `${SOL.slice(0, 80)}0`;

type Cell = { value: number; given: boolean; notes: number[]; isError: boolean };

const NEAR_WIN_GRID: Cell[][] = Array.from({ length: 9 }, (_, r) =>
  Array.from({ length: 9 }, (_, c) => {
    const idx = r * 9 + c;
    if (idx === 80) return { value: 0, given: false, notes: [], isError: false };
    return { value: parseInt(SOL[idx]), given: true, notes: [], isError: false };
  }),
);

const NEAR_WIN_STATE = {
  _v: 1 as const,
  variant: "classic" as const,
  difficulty: "easy" as const,
  puzzle: PUZ,
  solution: SOL,
  grid: NEAR_WIN_GRID,
  selectedRow: null,
  selectedCol: null,
  notesMode: false,
  errorCount: 0,
  isComplete: false,
  undoStack: [],
};

test.describe("Sudoku — leaderboard", () => {
  test("PATCH /sudoku/score intercepted and confirmation shown after submit", async ({
    page,
  }) => {
    let capturedBody: Record<string, unknown> | null = null;

    await page.route("**/sudoku/**", async (route) => {
      if (route.request().method() === "PATCH") {
        capturedBody = JSON.parse(route.request().postData() ?? "{}");
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ player_name: "Tester", score: 500, rank: 1 }),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ scores: [] }),
        });
      }
    });

    await injectSudokuState(page, NEAR_WIN_STATE);
    await page.getByRole("button", { name: "Play Sudoku" }).click();
    await page
      .getByRole("heading", { name: "Sudoku", exact: true })
      .waitFor({ timeout: 10_000 });

    // Enter the final digit to complete the puzzle and trigger the win modal.
    const lastCell = page.getByRole("button", {
      name: "Cell row 9, column 9, empty",
    });
    await expect(lastCell).toBeVisible({ timeout: 5_000 });
    await lastCell.click();
    await page.getByRole("button", { name: "Enter digit 5" }).click();

    // Win modal appears.
    await expect(page.getByText("You Solved It!")).toBeVisible({ timeout: 5_000 });

    await page.getByLabel("Your name").fill("Tester");

    const submitBtn = page.getByRole("button", { name: "Submit Score" });
    await expect(submitBtn).toBeEnabled({ timeout: 2_000 });
    await submitBtn.click();

    await expect(
      page.getByText("Saved! Score submitted."),
    ).toBeVisible({ timeout: 5_000 });

    expect(capturedBody).not.toBeNull();
    expect(capturedBody!["player_name"]).toBe("Tester");
  });

  test("Submit Score button is disabled when name field is empty", async ({ page }) => {
    await page.route("**/sudoku/**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ scores: [] }),
      });
    });

    await injectSudokuState(page, NEAR_WIN_STATE);
    await page.getByRole("button", { name: "Play Sudoku" }).click();
    await page
      .getByRole("heading", { name: "Sudoku", exact: true })
      .waitFor({ timeout: 10_000 });

    const lastCell = page.getByRole("button", {
      name: "Cell row 9, column 9, empty",
    });
    await expect(lastCell).toBeVisible({ timeout: 5_000 });
    await lastCell.click();
    await page.getByRole("button", { name: "Enter digit 5" }).click();

    await expect(page.getByText("You Solved It!")).toBeVisible({ timeout: 5_000 });

    await expect(
      page.getByRole("button", { name: "Submit Score" }),
    ).toBeDisabled({ timeout: 2_000 });
  });
});
