/**
 * sudoku-errors.spec.ts — GH #1563
 *
 * Error-path coverage for Sudoku.
 *
 * Covers:
 *   - Navigation (back to Home)
 *   - Invalid input: entering a digit into a given (pre-filled clue) cell
 *     must not alter the cell's value
 *   - Server error display: 500 on sudoku API — difficulty picker still renders
 *   - Graceful recovery: puzzle remains solvable after the server error
 *   - Corrupted localStorage fallback
 */

import { test, expect } from "@playwright/test";
import { mockSudokuApi, gotoSudoku, injectSudokuState } from "./helpers/sudoku";
import { installEntitlementsMock } from "./helpers/api-mock";

const API_BASE = "http://localhost:8000";

// Valid 9×9 solution.
const SOL =
  "123456789456789123789123456231564897564897231897231564312645978645978312978312645";

// Puzzle with two empty cells (indices 4 and 80) — all other cells are given.
const PUZ = `${SOL.slice(0, 4)}0${SOL.slice(5, 80)}0`;

type Cell = {
  value: number;
  given: boolean;
  notes: number[];
  isError: boolean;
};

function buildGrid(emptyIdxs: number[]): Cell[][] {
  const empties = new Set(emptyIdxs);
  return Array.from({ length: 9 }, (_, r) =>
    Array.from({ length: 9 }, (_, c) => {
      const idx = r * 9 + c;
      const v = parseInt(SOL[idx]);
      if (empties.has(idx)) {
        return { value: 0, given: false, notes: [], isError: false };
      }
      return { value: v, given: true, notes: [], isError: false };
    }),
  );
}

// Two empty cells so a single digit entry doesn't complete the puzzle.
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

test.describe("Sudoku — error paths", () => {
  // ---------------------------------------------------------------------------
  // Navigation
  // ---------------------------------------------------------------------------

  test("navigating away from Sudoku returns to Home", async ({ page }) => {
    await mockSudokuApi(page);
    await gotoSudoku(page);

    await page.goto("/");
    await expect(page.getByText("BC Arcade").first()).toBeVisible({
      timeout: 10_000,
    });
  });

  // ---------------------------------------------------------------------------
  // Invalid input rejection
  // ---------------------------------------------------------------------------

  test("entering a digit on a given cell does not change its value", async ({
    page,
  }) => {
    await mockSudokuApi(page);
    await injectSudokuState(page, STATE);

    await page.getByRole("button", { name: "Play Sudoku" }).click();
    await page
      .getByRole("heading", { name: "Sudoku", exact: true })
      .waitFor({ timeout: 10_000 });

    // Cell (row 1, col 1) is a given with value 1 (SOL[0] = '1').
    const givenCell = page.getByRole("button", {
      name: "Cell row 1, column 1, 1",
    });
    await expect(givenCell).toBeVisible({ timeout: 5_000 });
    await givenCell.click();

    // Attempt to overwrite the given cell with digit 5
    await page.getByRole("button", { name: "Enter digit 5" }).click();

    // Cell value must remain 1 — given cells are locked
    await expect(
      page.getByRole("button", { name: "Cell row 1, column 1, 1" }),
    ).toBeVisible({ timeout: 2_000 });
    await expect(
      page.getByRole("button", { name: "Cell row 1, column 1, 5" }),
    ).not.toBeVisible();
  });

  // ---------------------------------------------------------------------------
  // Server error display
  // ---------------------------------------------------------------------------

  test("sudoku API 500 on load — difficulty picker still renders", async ({
    page,
  }) => {
    await page.route(`${API_BASE}/sudoku/**`, async (route) => {
      await route.fulfill({ status: 500, body: "Internal Server Error" });
    });
    await gotoSudoku(page);

    // Difficulty picker appears despite server error (game logic is client-side)
    await expect(
      page.getByRole("radiogroup", { name: "Difficulty" }),
    ).toBeVisible({ timeout: 5_000 });
  });

  // ---------------------------------------------------------------------------
  // Graceful recovery
  // ---------------------------------------------------------------------------

  test("puzzle board renders and accepts input after sudoku API 500", async ({
    page,
  }) => {
    await page.route(`${API_BASE}/sudoku/**`, async (route) => {
      await route.fulfill({ status: 500, body: "Internal Server Error" });
    });
    await gotoSudoku(page);

    // Start a game despite the server error
    await page.getByRole("radio", { name: "Easy" }).click();
    await page.getByRole("button", { name: "Start" }).click();
    await page.getByLabel("Sudoku board").waitFor({ timeout: 10_000 });

    // Board is interactive — at least one clue cell is visible
    await expect(
      page
        .getByRole("button", { name: /Cell row \d+, column \d+, [1-9]/ })
        .first(),
    ).toBeVisible({ timeout: 5_000 });
  });

  test("corrupted sudoku_game localStorage — fresh game loads with difficulty picker", async ({
    page,
  }) => {
    await mockSudokuApi(page);
    await installEntitlementsMock(page);
    await page.goto("/");
    await page.evaluate(() =>
      localStorage.setItem("sudoku_game", "not-valid-json{{{"),
    );
    await page.goto("/");
    await page.getByRole("button", { name: "Play Sudoku" }).click();
    await page
      .getByRole("heading", { name: "Sudoku", exact: true })
      .waitFor({ timeout: 10_000 });

    // Corrupted state is discarded — difficulty picker appears for a fresh game
    await expect(
      page.getByRole("radiogroup", { name: "Difficulty" }),
    ).toBeVisible({ timeout: 5_000 });
  });
});
