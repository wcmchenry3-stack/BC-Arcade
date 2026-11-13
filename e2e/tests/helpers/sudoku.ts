import { Page } from "@playwright/test";
import { installEntitlementsMock } from "./api-mock";

export const SUDOKU_STORAGE_KEY = "sudoku_game";
const STORAGE_KEY = SUDOKU_STORAGE_KEY;

export async function gotoSudoku(page: Page): Promise<void> {
  await installEntitlementsMock(page);
  await page.goto("/");
  await page.evaluate((key) => localStorage.removeItem(key), STORAGE_KEY);
  await page.getByRole("button", { name: "Play Sudoku" }).click();
  await page
    .getByRole("heading", { name: "Sudoku", exact: true })
    .waitFor({ timeout: 10_000 });
}

export async function injectSudokuState(
  page: Page,
  partial: Record<string, unknown>,
): Promise<void> {
  await installEntitlementsMock(page);
  await page.goto("/");
  await page.evaluate(
    ([key, state]) =>
      localStorage.setItem(key as string, JSON.stringify(state)),
    [STORAGE_KEY, partial] as const,
  );
  await page.goto("/");
}

const SOL =
  "123456789456789123789123456231564897564897231897231564312645978645978312978312645";
// Nine empty cells, spread over rows and columns, one of them with seven pencil notes.
const EMPTY = new Set([4, 80, 12, 30, 31, 49, 55, 66, 72]);

/**
 * A mid-game classic Easy state (#3773): cell (row 5, col 5) selected, two errors on the count,
 * seven pencil notes in (row 2, col 4), and nine empty cells. Digits 1-9 all still have some left.
 */
export function midGameSudokuState(overrides: Record<string, unknown> = {}) {
  const puzzle = Array.from({ length: 81 }, (_, i) =>
    EMPTY.has(i) ? "0" : SOL[i],
  ).join("");
  const grid = Array.from({ length: 9 }, (_, r) =>
    Array.from({ length: 9 }, (_, c) => {
      const i = r * 9 + c;
      if (EMPTY.has(i)) {
        return {
          value: 0,
          given: false,
          notes: i === 12 ? [1, 2, 3, 4, 5, 6, 7] : [],
          isError: false,
        };
      }
      return { value: Number(SOL[i]), given: true, notes: [], isError: false };
    }),
  );
  return {
    _v: 1 as const,
    variant: "classic" as const,
    difficulty: "easy" as const,
    puzzle,
    solution: SOL,
    grid,
    selectedRow: 4,
    selectedCol: 4,
    notesMode: false,
    errorCount: 2,
    isComplete: false,
    undoStack: [],
    ...overrides,
  };
}

/**
 * A classic Easy puzzle with one empty cell left (#3774): row 9, column 9, whose digit is 5.
 * Entering 5 there solves it. `extraEmpty` leaves more cells empty (by index), for a digit with
 * a key left to press: with (row 1, column 1) empty, 1 is illegal at row 9, column 9 (it is in
 * the row) and its key still has one to place.
 */
export function nearSolvedSudokuState(extraEmpty: number[] = []) {
  const empty = new Set([80, ...extraEmpty]);
  const puzzle = Array.from({ length: 81 }, (_, i) =>
    empty.has(i) ? "0" : SOL[i],
  ).join("");
  const grid = Array.from({ length: 9 }, (_, r) =>
    Array.from({ length: 9 }, (_, c) => {
      const i = r * 9 + c;
      return empty.has(i)
        ? { value: 0, given: false, notes: [], isError: false }
        : { value: Number(SOL[i]), given: true, notes: [], isError: false };
    }),
  );
  return {
    _v: 1 as const,
    variant: "classic" as const,
    difficulty: "easy" as const,
    puzzle,
    solution: SOL,
    grid,
    selectedRow: null,
    selectedCol: null,
    notesMode: false,
    errorCount: 0,
    isComplete: false,
    undoStack: [],
  };
}
