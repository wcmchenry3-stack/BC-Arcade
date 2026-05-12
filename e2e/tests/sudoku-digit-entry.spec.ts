import { test, expect } from "./fixtures";
import { mockSudokuApi, injectSudokuState } from "./helpers/sudoku";

// Valid 9×9 solution used across injected states.
const SOL = "123456789456789123789123456231564897564897231897231564312645978645978312978312645";

// Puzzle string: empty at index 4 (row 1, col 5) and index 80 (row 9, col 9).
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

// Two empty cells so that filling one does not complete the puzzle.
const STATE = {
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

test("tapping an empty cell then digit 5 displays 5 in that cell", async ({ page }) => {
  await mockSudokuApi(page);
  await injectSudokuState(page, STATE);

  await page.getByRole("button", { name: "Play Sudoku" }).click();
  await page
    .getByRole("heading", { name: "Sudoku", exact: true })
    .waitFor({ timeout: 10_000 });

  // Cell row 1, col 5 is the empty cell (flat index 4).
  const emptyCell = page.getByRole("button", {
    name: "Cell row 1, column 5, empty",
  });
  await expect(emptyCell).toBeVisible({ timeout: 5_000 });
  await emptyCell.click();

  await page.getByRole("button", { name: "Enter digit 5" }).click();

  await expect(
    page.getByRole("button", { name: "Cell row 1, column 5, 5" }),
  ).toBeVisible({ timeout: 5_000 });
});
