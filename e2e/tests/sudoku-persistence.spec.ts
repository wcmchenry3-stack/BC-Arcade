import { test, expect } from "./fixtures";
import { mockSudokuApi, injectSudokuState } from "./helpers/sudoku";

const SOL = "123456789456789123789123456231564897564897231897231564312645978645978312978312645";

// Puzzle marks row 1 col 5 (index 4) and row 9 col 9 (index 80) as empty.
const PUZ = `${SOL.slice(0, 4)}0${SOL.slice(5, 80)}0`;

type Cell = { value: number; given: boolean; notes: number[]; isError: boolean };

// Row 1 col 5 (index 4) is user-filled with 5; row 9 col 9 (index 80) stays empty.
const GRID: Cell[][] = Array.from({ length: 9 }, (_, r) =>
  Array.from({ length: 9 }, (_, c) => {
    const idx = r * 9 + c;
    if (idx === 4) return { value: 5, given: false, notes: [], isError: false };
    if (idx === 80) return { value: 0, given: false, notes: [], isError: false };
    return { value: parseInt(SOL[idx]), given: true, notes: [], isError: false };
  }),
);

const PERSIST_STATE = {
  _v: 1 as const,
  variant: "classic" as const,
  difficulty: "easy" as const,
  puzzle: PUZ,
  solution: SOL,
  grid: GRID,
  selectedRow: null,
  selectedCol: null,
  notesMode: false,
  errorCount: 0,
  isComplete: false,
  undoStack: [],
};

test("digit entered in cell persists after navigating away and back", async ({ page }) => {
  await mockSudokuApi(page);
  await injectSudokuState(page, PERSIST_STATE);

  await page.getByRole("button", { name: "Play Sudoku" }).click();
  await page
    .getByRole("heading", { name: "Sudoku", exact: true })
    .waitFor({ timeout: 10_000 });

  // Row 1, col 5 already holds the user-entered "5".
  await expect(
    page.getByRole("button", { name: "Cell row 1, column 5, 5" }),
  ).toBeVisible({ timeout: 5_000 });

  // Navigate away.
  await page.goto("/");
  await page.getByText("BC Arcade").first().waitFor();

  // Return to Sudoku.
  await page.getByRole("button", { name: "Play Sudoku" }).click();
  await page
    .getByRole("heading", { name: "Sudoku", exact: true })
    .waitFor({ timeout: 10_000 });

  // Cell should still display "5" after resume.
  await expect(
    page.getByRole("button", { name: "Cell row 1, column 5, 5" }),
  ).toBeVisible({ timeout: 5_000 });
});
