import { test, expect, type Page } from "./fixtures";
import { injectSudokuState } from "./helpers/sudoku";

const SOL =
  "123456789456789123789123456231564897564897231897231564312645978645978312978312645";

// Puzzle marks only the last cell (row 9, col 9, index 80) as empty.
// Entering digit 5 there fills the final cell and completes the puzzle.
const PUZ = `${SOL.slice(0, 80)}0`;

type Cell = {
  value: number;
  given: boolean;
  notes: number[];
  isError: boolean;
};

const NEAR_WIN_GRID: Cell[][] = Array.from({ length: 9 }, (_, r) =>
  Array.from({ length: 9 }, (_, c) => {
    const idx = r * 9 + c;
    if (idx === 80)
      return { value: 0, given: false, notes: [], isError: false };
    return {
      value: parseInt(SOL[idx]),
      given: true,
      notes: [],
      isError: false,
    };
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

const DISPLAY_NAME_KEY = "player_display_name";

/** Intercepts the Sudoku API; returns the PATCH bodies the app sends. */
async function routeSudokuApi(page: Page): Promise<Record<string, unknown>[]> {
  const patches: Record<string, unknown>[] = [];
  await page.route("**/sudoku/**", async (route) => {
    if (route.request().method() === "PATCH") {
      const body = JSON.parse(route.request().postData() ?? "{}");
      patches.push(body);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          player_name: body.player_name,
          score: 100,
          rank: 1,
        }),
      });
    } else {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ scores: [] }),
      });
    }
  });
  return patches;
}

/** Opens the near-won puzzle and enters the final digit. */
async function solveNearWinPuzzle(
  page: Page,
  displayName?: string,
): Promise<void> {
  await injectSudokuState(page, NEAR_WIN_STATE);
  if (displayName) {
    await page.evaluate(([key, name]) => localStorage.setItem(key, name), [
      DISPLAY_NAME_KEY,
      displayName,
    ] as const);
    await page.goto("/");
  }
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

  // The shared result card (#2511).
  await expect(page.getByText("You Win!")).toBeVisible({ timeout: 5_000 });
}

test.describe("Sudoku — result card + leaderboard", () => {
  test("submits under the saved display name with no name entry", async ({
    page,
  }) => {
    const patches = await routeSudokuApi(page);
    await solveNearWinPuzzle(page, "Tester");

    await expect(
      page.getByText("Saved as Tester · #1 on the leaderboard"),
    ).toBeVisible({ timeout: 15_000 });
    expect(patches).toEqual([{ player_name: "Tester" }]);
    const card = page.getByTestId("sudoku-result");
    await expect(
      card.getByRole("button", { name: "Play Again" }),
    ).toBeVisible();
    await expect(
      card.getByRole("button", { name: "Change Difficulty" }),
    ).toBeVisible();
    await expect(card.getByRole("button", { name: "Home" })).toBeVisible();
  });

  test("asks for a display name once when none is set, then submits", async ({
    page,
  }) => {
    const patches = await routeSudokuApi(page);
    await solveNearWinPuzzle(page);

    const nameInput = page.getByLabel("Pick a display name for leaderboards");
    await expect(nameInput).toBeVisible({ timeout: 5_000 });
    const save = page.getByRole("button", { name: "Save" });
    await expect(save).toBeDisabled();
    expect(patches).toEqual([]);

    await nameInput.fill("Tester");
    await save.click();

    await expect(
      page.getByText("Saved as Tester · #1 on the leaderboard"),
    ).toBeVisible({ timeout: 15_000 });
    expect(patches).toEqual([{ player_name: "Tester" }]);
  });
});
