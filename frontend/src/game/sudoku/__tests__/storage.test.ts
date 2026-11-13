import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Sentry from "@sentry/react-native";

import { clearGame, loadGame, saveGame, loadShowMistakes, saveShowMistakes } from "../storage";
import { enterDigit, getConflicts, loadPuzzle, selectCell, toggleNotesMode, undo } from "../engine";
import type { CellValue, NoteDigit, SudokuState } from "../types";

const GAME_KEY = "sudoku_game";

// Deterministic puzzle selection for tests — always pick index 0 of the
// easy bank.  The puzzle is static in `puzzles.json`, so the resumed
// state comparison is meaningful.
function rng0(): number {
  return 0;
}

function findFirstEmpty(state: SudokuState): { row: number; col: number } {
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      const cell = state.grid[r]?.[c];
      if (cell && !cell.given) return { row: r, col: c };
    }
  }
  throw new Error("no empty cell");
}

describe("sudoku storage", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    (Sentry.captureException as jest.Mock).mockClear();
    (Sentry.captureMessage as jest.Mock).mockClear();
  });

  it("returns null when no save exists", async () => {
    expect(await loadGame()).toBeNull();
  });

  it("round-trips a fresh puzzle via save → load", async () => {
    const s = loadPuzzle("easy", "classic", rng0);
    await saveGame(s);
    const loaded = await loadGame();
    expect(loaded).not.toBeNull();
    expect(loaded!.difficulty).toBe("easy");
    expect(loaded!.puzzle).toBe(s.puzzle);
    expect(loaded!.solution).toBe(s.solution);
    expect(loaded!._v).toBe(1);
  });

  it("restores Set<NoteDigit> notes after a JSON round-trip", async () => {
    let s = loadPuzzle("easy", "classic", rng0);
    const { row, col } = findFirstEmpty(s);
    s = toggleNotesMode(s); // enter notes mode
    s = selectCell(s, row, col);
    s = enterDigit(s, 3 as CellValue);
    s = enterDigit(s, 7 as CellValue);

    expect(s.grid[row]![col]!.notes).toBeInstanceOf(Set);
    expect(s.grid[row]![col]!.notes.has(3 as NoteDigit)).toBe(true);

    await saveGame(s);
    const loaded = await loadGame();
    expect(loaded).not.toBeNull();

    const restored = loaded!.grid[row]![col]!;
    // The deserialised notes field must be a Set, not an array.
    expect(restored.notes).toBeInstanceOf(Set);
    expect(restored.notes.has(3 as NoteDigit)).toBe(true);
    expect(restored.notes.has(7 as NoteDigit)).toBe(true);
    expect(restored.notes.has(1 as NoteDigit)).toBe(false);
  });

  it("preserves errorCount, selection, and notesMode across reload", async () => {
    let s = loadPuzzle("hard", "classic", rng0);
    const { row, col } = findFirstEmpty(s);
    const correct = s.solution.charCodeAt(row * 9 + col) - 48;
    // An illegal digit (a peer already holds it): only those are errors (#2943).
    let wrong: CellValue | null = null;
    for (let d = 1; d <= 9 && wrong === null; d++) {
      if (d !== correct && getConflicts(s.grid, row, col, d).length > 0) wrong = d as CellValue;
    }
    if (wrong === null) throw new Error("no illegal digit for this cell");
    s = selectCell(s, row, col);
    s = enterDigit(s, wrong);
    s = toggleNotesMode(s);

    await saveGame(s);
    const loaded = await loadGame();

    expect(loaded!.errorCount).toBe(1);
    expect(loaded!.selectedRow).toBe(row);
    expect(loaded!.selectedCol).toBe(col);
    expect(loaded!.notesMode).toBe(true);
    expect(loaded!.grid[row]![col]!.isError).toBe(true);
    expect(loaded!.grid[row]![col]!.value).toBe(wrong);
  });

  it("a saved game resumes under the #3785 rules: undo keeps Notes mode and selects the changed cell", async () => {
    const s0 = loadPuzzle("easy", "classic", rng0);
    const { row, col } = findFirstEmpty(s0);
    // saved with a digit in the undo stack, Notes mode on, another cell selected
    const placed = enterDigit(selectCell(s0, row, col), 5);
    const other = placed.grid.flatMap((r, ri) =>
      r.flatMap((c, ci) => (!c.given && c.value === 0 ? [[ri, ci] as const] : []))
    )[0]!;
    await saveGame(toggleNotesMode(selectCell(placed, other[0], other[1])));
    const loaded = (await loadGame())!;
    expect(loaded.undoStack).toHaveLength(1);
    const undone = undo(loaded);
    expect(undone.notesMode).toBe(true);
    expect([undone.selectedRow, undone.selectedCol]).toEqual([row, col]);
    expect(undone.grid[row]![col]!.value).toBe(0);
  });

  it("strips nested undoStack snapshots at save time", async () => {
    let s = loadPuzzle("easy", "classic", rng0);
    const { row, col } = findFirstEmpty(s);
    s = selectCell(s, row, col);
    s = enterDigit(s, 5 as CellValue);
    expect(s.undoStack.length).toBeGreaterThan(0);

    await saveGame(s);
    const raw = await AsyncStorage.getItem(GAME_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    for (const snap of parsed.undoStack) {
      expect(snap.undoStack).toEqual([]);
    }
  });

  it("returns null and captures a warning on unparseable JSON", async () => {
    await AsyncStorage.setItem(GAME_KEY, "not-json{{");
    expect(await loadGame()).toBeNull();
    expect(Sentry.captureMessage).toHaveBeenCalled();
    // Payload should have been removed after the failed parse.
    expect(await AsyncStorage.getItem(GAME_KEY)).toBeNull();
  });

  it("returns null on version mismatch", async () => {
    await AsyncStorage.setItem(
      GAME_KEY,
      JSON.stringify({
        _v: 2,
        difficulty: "easy",
        puzzle: "0".repeat(81),
        solution: "0".repeat(81),
        grid: [],
        selectedRow: null,
        selectedCol: null,
        notesMode: false,
        errorCount: 0,
        isComplete: false,
        undoStack: [],
      })
    );
    expect(await loadGame()).toBeNull();
  });

  it("returns null on shape-invalid payload", async () => {
    await AsyncStorage.setItem(
      GAME_KEY,
      JSON.stringify({
        _v: 1,
        difficulty: "wizard", // not a valid tier
      })
    );
    expect(await loadGame()).toBeNull();
  });

  it("clearGame removes the persisted state", async () => {
    const s = loadPuzzle("easy", "classic", rng0);
    await saveGame(s);
    expect(await AsyncStorage.getItem(GAME_KEY)).not.toBeNull();
    await clearGame();
    expect(await AsyncStorage.getItem(GAME_KEY)).toBeNull();
  });

  it("handles AsyncStorage.getItem rejection by returning null", async () => {
    const orig = AsyncStorage.getItem;
    (AsyncStorage as unknown as { getItem: jest.Mock }).getItem = jest
      .fn()
      .mockRejectedValueOnce(new Error("boom"));
    try {
      expect(await loadGame()).toBeNull();
      expect(Sentry.captureException).toHaveBeenCalled();
    } finally {
      (AsyncStorage as unknown as { getItem: typeof orig }).getItem = orig;
    }
  });
});

describe("sudoku save compat (#2943)", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it("re-derives isError on load: an old 'differs from solution' flag on a legal digit is dropped, a duplicate is flagged", async () => {
    let s = loadPuzzle("easy", "classic", rng0);
    const { row, col } = findFirstEmpty(s);
    s = selectCell(s, row, col);
    await saveGame(s);
    const raw = JSON.parse((await AsyncStorage.getItem(GAME_KEY))!);
    // Old build: a legal-but-wrong digit was flagged. Pick a digit no peer holds.
    let legal = 0;
    for (let d = 1; d <= 9 && legal === 0; d++) {
      if (
        d !== s.solution.charCodeAt(row * 9 + col) - 48 &&
        getConflicts(s.grid, row, col, d).length === 0
      )
        legal = d;
    }
    raw.grid[row][col].value = legal;
    raw.grid[row][col].isError = true;
    // And an unflagged duplicate of a given in the same row.
    const other = raw.grid[row].findIndex(
      (c: { given: boolean; value: number }, ci: number) => ci !== col && !c.given && c.value === 0
    );
    const givenInRow = raw.grid[row].find((c: { given: boolean }) => c.given);
    raw.grid[row][other].value = givenInRow.value;
    raw.grid[row][other].isError = false;
    await AsyncStorage.setItem(GAME_KEY, JSON.stringify(raw));

    const loaded = await loadGame();
    expect(loaded!.grid[row]![col]!.value).toBe(legal);
    expect(loaded!.grid[row]![col]!.isError).toBe(false);
    expect(loaded!.grid[row]![other]!.isError).toBe(true);
  });
});

describe("show mistakes preference (#2943)", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it("is null until the player chooses", async () => {
    expect(await loadShowMistakes()).toBeNull();
  });

  it("round-trips an explicit on and off", async () => {
    await saveShowMistakes(true);
    expect(await loadShowMistakes()).toBe(true);
    await saveShowMistakes(false);
    expect(await loadShowMistakes()).toBe(false);
  });
});
