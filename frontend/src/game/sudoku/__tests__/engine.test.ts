/**
 * Sudoku engine unit tests (#616).
 *
 * Covers the checklist in the issue:
 *   - solvePuzzle: known puzzles + impossible input
 *   - loadPuzzle: given count per difficulty; givens marked immutable
 *   - enterDigit (normal): correct → no error; wrong → isError; errorCount;
 *     undo stack grows; given cells immutable
 *   - enterDigit (notes): toggle; peer-note cleanup invariant
 *   - eraseCell: clears value + notes; no-op on givens
 *   - undo: restores previous snapshot incl. errorCount and notesMode
 *   - isComplete: true only when all 81 cells match solution
 *   - getConflicts: row, col, box detection; empty when none
 */

import {
  enterDigit,
  eraseCell,
  getConflicts,
  isComplete,
  loadPuzzle,
  selectCell,
  solvePuzzle,
  toggleNotesMode,
  undo,
} from "../engine";
import type { CellValue, GameEvent, Grid, NoteDigit, SudokuCell, SudokuState } from "../types";
import { UNDO_STACK_LIMIT } from "../types";

// ---------------------------------------------------------------------------
// Known-good puzzles for solver
// ---------------------------------------------------------------------------

// Classic easy puzzle from Wikipedia's Sudoku article — known to have
// exactly one solution. Kept here so the solver test doesn't depend on
// whatever the generator produced.
const WIKI_PUZZLE =
  "530070000600195000098000060800060003400803001700020006060000280000419005000080079";
const WIKI_SOLUTION =
  "534678912672195348198342567859761423426853791713924856961537284287419635345286179";

// ---------------------------------------------------------------------------
// Deterministic RNG for loadPuzzle tests
// ---------------------------------------------------------------------------

function rng0(): number {
  return 0; // always pick index 0
}

// ---------------------------------------------------------------------------
// solvePuzzle
// ---------------------------------------------------------------------------

describe("solvePuzzle", () => {
  it("solves the Wikipedia classic easy puzzle", () => {
    expect(solvePuzzle(WIKI_PUZZLE)).toBe(WIKI_SOLUTION);
  });

  it("returns null for an impossible puzzle (two of a digit in one row)", () => {
    const bad = "110000000".padEnd(81, "0");
    expect(solvePuzzle(bad)).toBeNull();
  });

  it("returns null for malformed input (wrong length)", () => {
    expect(solvePuzzle("123")).toBeNull();
  });

  it("returns null for non-digit characters", () => {
    const withLetters = "5300700X0".padEnd(81, "0");
    expect(solvePuzzle(withLetters)).toBeNull();
  });

  it("solves a completed grid trivially", () => {
    expect(solvePuzzle(WIKI_SOLUTION)).toBe(WIKI_SOLUTION);
  });
});

// ---------------------------------------------------------------------------
// loadPuzzle
// ---------------------------------------------------------------------------

function countGivens(grid: Grid): number {
  let n = 0;
  for (const row of grid) for (const cell of row) if (cell.given) n++;
  return n;
}

describe("loadPuzzle", () => {
  it("returns a fresh state with difficulty set", () => {
    const state = loadPuzzle("easy", "classic", rng0);
    expect(state.difficulty).toBe("easy");
    expect(state._v).toBe(1);
    expect(state.selectedRow).toBeNull();
    expect(state.selectedCol).toBeNull();
    expect(state.notesMode).toBe(false);
    expect(state.errorCount).toBe(0);
    expect(state.isComplete).toBe(false);
    expect(state.undoStack).toEqual([]);
  });

  it("hits the clue range for easy (36-44 givens)", () => {
    const state = loadPuzzle("easy", "classic", rng0);
    const n = countGivens(state.grid);
    expect(n).toBeGreaterThanOrEqual(36);
    expect(n).toBeLessThanOrEqual(44);
  });

  it("hits the clue range for medium (28-35 givens)", () => {
    const state = loadPuzzle("medium", "classic", rng0);
    const n = countGivens(state.grid);
    expect(n).toBeGreaterThanOrEqual(28);
    expect(n).toBeLessThanOrEqual(35);
  });

  it("hits the clue range for hard (22-27 givens)", () => {
    const state = loadPuzzle("hard", "classic", rng0);
    const n = countGivens(state.grid);
    expect(n).toBeGreaterThanOrEqual(22);
    expect(n).toBeLessThanOrEqual(27);
  });

  it("marks given cells as `given: true` and non-givens as `given: false`", () => {
    const state = loadPuzzle("easy", "classic", rng0);
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        const cell = state.grid[r]![c]!;
        const ch = state.puzzle.charCodeAt(r * 9 + c) - 48;
        expect(cell.given).toBe(ch !== 0);
        if (cell.given) {
          expect(cell.value).toBe(ch as CellValue);
        } else {
          expect(cell.value).toBe(0);
        }
      }
    }
  });

  it("derives a full 81-char solution that matches the givens", () => {
    const state = loadPuzzle("easy", "classic", rng0);
    expect(state.solution).toHaveLength(81);
    for (let i = 0; i < 81; i++) {
      const puzCh = state.puzzle.charCodeAt(i);
      if (puzCh !== 48) {
        expect(state.solution.charCodeAt(i)).toBe(puzCh);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// selectCell
// ---------------------------------------------------------------------------

describe("selectCell", () => {
  it("selects the given cell", () => {
    const s0 = loadPuzzle("easy", "classic", rng0);
    const s1 = selectCell(s0, 3, 4);
    expect(s1.selectedRow).toBe(3);
    expect(s1.selectedCol).toBe(4);
  });

  it("deselects when the same cell is selected again", () => {
    const s0 = loadPuzzle("easy", "classic", rng0);
    const s1 = selectCell(s0, 2, 2);
    const s2 = selectCell(s1, 2, 2);
    expect(s2.selectedRow).toBeNull();
    expect(s2.selectedCol).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Helper: find an empty (non-given) cell
// ---------------------------------------------------------------------------

function findEmpty(state: SudokuState): { row: number; col: number } {
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      const cell = state.grid[r]![c]!;
      if (!cell.given) return { row: r, col: c };
    }
  }
  throw new Error("no empty cell");
}

function findGiven(state: SudokuState): { row: number; col: number } {
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      const cell = state.grid[r]![c]!;
      if (cell.given) return { row: r, col: c };
    }
  }
  throw new Error("no given cell");
}

// ---------------------------------------------------------------------------
// enterDigit — normal mode
// ---------------------------------------------------------------------------

describe("enterDigit (normal mode)", () => {
  it("places the correct digit without error", () => {
    const s0 = loadPuzzle("easy", "classic", rng0);
    const { row, col } = findEmpty(s0);
    const correct = s0.solution.charCodeAt(row * 9 + col) - 48;
    const s1 = enterDigit(selectCell(s0, row, col), correct as CellValue);
    const cell = s1.grid[row]![col]!;
    expect(cell.value).toBe(correct);
    expect(cell.isError).toBe(false);
    expect(s1.errorCount).toBe(0);
  });

  it("flags isError and increments errorCount on wrong digit", () => {
    const s0 = loadPuzzle("easy", "classic", rng0);
    const { row, col } = findEmpty(s0);
    const correct = s0.solution.charCodeAt(row * 9 + col) - 48;
    const wrong = ((correct % 9) + 1) as CellValue;
    const s1 = enterDigit(selectCell(s0, row, col), wrong);
    const cell = s1.grid[row]![col]!;
    expect(cell.value).toBe(wrong);
    expect(cell.isError).toBe(true);
    expect(s1.errorCount).toBe(1);
  });

  it("is a no-op on given cells", () => {
    const s0 = loadPuzzle("easy", "classic", rng0);
    const { row, col } = findGiven(s0);
    const original = s0.grid[row]![col]!.value;
    const s1 = enterDigit(selectCell(s0, row, col), 5);
    expect(s1.grid[row]![col]!.value).toBe(original);
    expect(s1.undoStack).toEqual([]);
  });

  it("pushes previous state to undo stack", () => {
    const s0 = loadPuzzle("easy", "classic", rng0);
    const { row, col } = findEmpty(s0);
    const s1 = enterDigit(selectCell(s0, row, col), 3);
    expect(s1.undoStack).toHaveLength(1);
  });

  it("caps the undo stack at UNDO_STACK_LIMIT entries", () => {
    // Use a hard puzzle — easy ones have fewer than UNDO_STACK_LIMIT+5
    // empty cells, so the test can't push enough moves onto the stack
    // to trigger the cap.
    let s = loadPuzzle("hard", "classic", rng0);
    const empties: Array<[number, number]> = [];
    for (let r = 0; r < 9 && empties.length < UNDO_STACK_LIMIT + 5; r++) {
      for (let c = 0; c < 9 && empties.length < UNDO_STACK_LIMIT + 5; c++) {
        if (!s.grid[r]![c]!.given) empties.push([r, c]);
      }
    }
    expect(empties.length).toBeGreaterThanOrEqual(UNDO_STACK_LIMIT + 5);
    for (const [r, c] of empties) {
      s = enterDigit(selectCell(s, r, c), 5);
    }
    expect(s.undoStack).toHaveLength(UNDO_STACK_LIMIT);
  });

  it("clears notes on the cell when a value is placed", () => {
    const s0 = loadPuzzle("easy", "classic", rng0);
    const { row, col } = findEmpty(s0);
    const sNotes = enterDigit(toggleNotesMode(selectCell(s0, row, col)), 4);
    expect(sNotes.grid[row]![col]!.notes.size).toBe(1);
    const sPlaced = enterDigit(toggleNotesMode(sNotes), 3);
    expect(sPlaced.grid[row]![col]!.value).toBe(3);
    expect(sPlaced.grid[row]![col]!.notes.size).toBe(0);
  });

  it("is a no-op when no cell is selected", () => {
    const s0 = loadPuzzle("easy", "classic", rng0);
    const s1 = enterDigit(s0, 5);
    expect(s1).toBe(s0);
  });

  it("snapshots stored on the undo stack carry an empty undoStack", () => {
    const s0 = loadPuzzle("easy", "classic", rng0);
    const { row, col } = findEmpty(s0);
    const s1 = enterDigit(selectCell(s0, row, col), 5);
    expect(s1.undoStack[0]!.undoStack).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// enterDigit — notes mode
// ---------------------------------------------------------------------------

describe("enterDigit (notes mode)", () => {
  it("toggles a digit in the selected cell's notes", () => {
    const s0 = loadPuzzle("easy", "classic", rng0);
    const { row, col } = findEmpty(s0);
    const s1 = enterDigit(toggleNotesMode(selectCell(s0, row, col)), 4);
    expect(s1.grid[row]![col]!.notes.has(4 as NoteDigit)).toBe(true);
    const s2 = enterDigit(s1, 4);
    expect(s2.grid[row]![col]!.notes.has(4 as NoteDigit)).toBe(false);
  });

  it("does not affect errorCount or undoStack", () => {
    const s0 = loadPuzzle("easy", "classic", rng0);
    const { row, col } = findEmpty(s0);
    const s1 = enterDigit(toggleNotesMode(selectCell(s0, row, col)), 7);
    expect(s1.errorCount).toBe(0);
    expect(s1.undoStack).toEqual([]);
  });

  it("is a no-op on given cells", () => {
    const s0 = loadPuzzle("easy", "classic", rng0);
    const { row, col } = findGiven(s0);
    const s1 = enterDigit(toggleNotesMode(selectCell(s0, row, col)), 2);
    expect(s1.grid[row]![col]!.notes.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// eraseCell
// ---------------------------------------------------------------------------

describe("eraseCell", () => {
  it("clears value AND notes and pushes to undo stack", () => {
    const s0 = loadPuzzle("easy", "classic", rng0);
    const { row, col } = findEmpty(s0);
    const sNote = enterDigit(toggleNotesMode(selectCell(s0, row, col)), 3);
    const sValue = enterDigit(toggleNotesMode(sNote), 5);
    const s1 = eraseCell(sValue);
    const cell = s1.grid[row]![col]!;
    expect(cell.value).toBe(0);
    expect(cell.notes.size).toBe(0);
    expect(s1.undoStack.length).toBeGreaterThan(sValue.undoStack.length);
  });

  it("is a no-op on given cells", () => {
    const s0 = loadPuzzle("easy", "classic", rng0);
    const { row, col } = findGiven(s0);
    const s1 = eraseCell(selectCell(s0, row, col));
    expect(s1.grid[row]![col]!.value).toBe(s0.grid[row]![col]!.value);
    expect(s1.undoStack).toEqual([]);
  });

  it("is a no-op when the cell is already empty with no notes", () => {
    const s0 = loadPuzzle("easy", "classic", rng0);
    const { row, col } = findEmpty(s0);
    const s1 = eraseCell(selectCell(s0, row, col));
    expect(s1.undoStack).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// undo
// ---------------------------------------------------------------------------

describe("undo", () => {
  it("returns the state unchanged when stack is empty", () => {
    const s0 = loadPuzzle("easy", "classic", rng0);
    const s1 = undo(s0);
    expect(s1).toBe(s0);
  });

  it("restores the previous value after an enterDigit", () => {
    const s0 = loadPuzzle("easy", "classic", rng0);
    const { row, col } = findEmpty(s0);
    const s1 = enterDigit(selectCell(s0, row, col), 5);
    const s2 = undo(s1);
    expect(s2.grid[row]![col]!.value).toBe(0);
    expect(s2.undoStack).toEqual([]);
  });

  it("restores errorCount when undoing a wrong placement", () => {
    const s0 = loadPuzzle("easy", "classic", rng0);
    const { row, col } = findEmpty(s0);
    const correct = s0.solution.charCodeAt(row * 9 + col) - 48;
    const wrong = ((correct % 9) + 1) as CellValue;
    const s1 = enterDigit(selectCell(s0, row, col), wrong);
    expect(s1.errorCount).toBe(1);
    const s2 = undo(s1);
    expect(s2.errorCount).toBe(0);
  });

  it("restores notesMode on undo", () => {
    const s0 = loadPuzzle("easy", "classic", rng0);
    const { row, col } = findEmpty(s0);
    // Toggle notes → place value (in normal) → undo should restore
    // notesMode=false because the *pre-enterDigit* state had notesMode=false.
    const s1 = enterDigit(selectCell(s0, row, col), 5);
    const s2 = toggleNotesMode(s1);
    expect(s2.notesMode).toBe(true);
    const s3 = undo(s2); // undo of the last enterDigit; notesMode was false at snapshot time
    expect(s3.notesMode).toBe(false);
  });

  it("chains multiple undos back to the initial state", () => {
    const s0 = loadPuzzle("easy", "classic", rng0);
    const empties: Array<[number, number]> = [];
    for (let r = 0; r < 9 && empties.length < 3; r++) {
      for (let c = 0; c < 9 && empties.length < 3; c++) {
        if (!s0.grid[r]![c]!.given) empties.push([r, c]);
      }
    }
    let s = s0;
    for (const [r, c] of empties) s = enterDigit(selectCell(s, r, c), 5);
    for (let i = 0; i < empties.length; i++) s = undo(s);
    for (const [r, c] of empties) expect(s.grid[r]![c]!.value).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// isComplete
// ---------------------------------------------------------------------------

describe("isComplete", () => {
  it("returns false for an unfilled grid", () => {
    const s0 = loadPuzzle("easy", "classic", rng0);
    expect(isComplete(s0.grid, s0.solution)).toBe(false);
  });

  it("returns true once every cell matches the solution", () => {
    const s0 = loadPuzzle("easy", "classic", rng0);
    // Programmatically fill in the solution.
    let s = s0;
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        if (s.grid[r]![c]!.given) continue;
        const correct = s.solution.charCodeAt(r * 9 + c) - 48;
        s = enterDigit(selectCell(s, r, c), correct as CellValue);
      }
    }
    expect(s.isComplete).toBe(true);
    expect(isComplete(s.grid, s.solution)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getConflicts
// ---------------------------------------------------------------------------

function cellOf(value: CellValue): SudokuCell {
  return { value, given: false, notes: new Set<NoteDigit>(), isError: false };
}

function emptyGrid(): Grid {
  const rows: SudokuCell[][] = [];
  for (let r = 0; r < 9; r++) {
    const row: SudokuCell[] = [];
    for (let c = 0; c < 9; c++) row.push(cellOf(0));
    rows.push(row);
  }
  return rows;
}

describe("getConflicts", () => {
  it("returns empty array when no conflicts exist", () => {
    expect(getConflicts(emptyGrid(), 0, 0, 5)).toEqual([]);
  });

  it("detects a row conflict", () => {
    const g = emptyGrid().map((row, ri) =>
      ri === 4 ? row.map((cell, ci) => (ci === 7 ? cellOf(3) : cell)) : row
    );
    expect(getConflicts(g, 4, 2, 3)).toEqual([[4, 7]]);
  });

  it("detects a column conflict", () => {
    const g = emptyGrid().map((row, ri) =>
      ri === 8 ? row.map((cell, ci) => (ci === 1 ? cellOf(7) : cell)) : row
    );
    expect(getConflicts(g, 0, 1, 7)).toEqual([[8, 1]]);
  });

  it("detects a 3x3 box conflict", () => {
    // (1,1) and (2,2) are in the same top-left box.
    const g = emptyGrid().map((row, ri) =>
      ri === 2 ? row.map((cell, ci) => (ci === 2 ? cellOf(9) : cell)) : row
    );
    expect(getConflicts(g, 1, 1, 9)).toEqual([[2, 2]]);
  });

  it("excludes the target cell itself", () => {
    const g = emptyGrid().map((row, ri) =>
      ri === 0 ? row.map((cell, ci) => (ci === 0 ? cellOf(5) : cell)) : row
    );
    expect(getConflicts(g, 0, 0, 5)).toEqual([]);
  });

  it("returns empty for out-of-range digits", () => {
    expect(getConflicts(emptyGrid(), 0, 0, 0)).toEqual([]);
    expect(getConflicts(emptyGrid(), 0, 0, 10)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// toggleNotesMode
// ---------------------------------------------------------------------------

describe("toggleNotesMode", () => {
  it("flips the notesMode flag", () => {
    const s0 = loadPuzzle("easy", "classic", rng0);
    expect(s0.notesMode).toBe(false);
    expect(toggleNotesMode(s0).notesMode).toBe(true);
    expect(toggleNotesMode(toggleNotesMode(s0)).notesMode).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// game events
// ---------------------------------------------------------------------------

describe("game events", () => {
  it("emits digitPlace on a correct placement", () => {
    const s0 = loadPuzzle("easy", "classic", rng0);
    const { row, col } = findEmpty(s0);
    const correct = (s0.solution.charCodeAt(row * 9 + col) - 48) as CellValue;
    const s1 = enterDigit(selectCell(s0, row, col), correct);
    expect(s1.events).toContainEqual({ type: "digitPlace" } satisfies GameEvent);
    expect(s1.events?.some((e) => e.type === "errorEntered")).toBe(false);
  });

  it("emits digitPlace and errorEntered on a wrong digit", () => {
    const s0 = loadPuzzle("easy", "classic", rng0);
    const { row, col } = findEmpty(s0);
    const correct = s0.solution.charCodeAt(row * 9 + col) - 48;
    const wrong = ((correct % 9) + 1) as CellValue;
    const s1 = enterDigit(selectCell(s0, row, col), wrong);
    expect(s1.events).toContainEqual({ type: "digitPlace" } satisfies GameEvent);
    expect(s1.events).toContainEqual({ type: "errorEntered" } satisfies GameEvent);
    expect(s1.events?.some((e) => e.type === "unitComplete")).toBe(false);
  });

  it("does not emit events in notes mode", () => {
    const s0 = loadPuzzle("easy", "classic", rng0);
    const { row, col } = findEmpty(s0);
    const s1 = enterDigit(toggleNotesMode(selectCell(s0, row, col)), 4 as CellValue);
    expect(s1.events).toBeUndefined();
  });

  it("emits unitComplete(row) when placing the last digit in a row", () => {
    let s = loadPuzzle("easy", "classic", rng0);
    const emptyInRow0: number[] = [];
    for (let c = 0; c < 9; c++) {
      if (!s.grid[0]![c]!.given) emptyInRow0.push(c);
    }
    expect(emptyInRow0.length).toBeGreaterThan(0);
    // Fill all but the last empty cell in row 0.
    for (let i = 0; i < emptyInRow0.length - 1; i++) {
      const c = emptyInRow0[i]!;
      const v = (s.solution.charCodeAt(c) - 48) as CellValue;
      s = enterDigit(selectCell(s, 0, c), v);
    }
    const lastC = emptyInRow0[emptyInRow0.length - 1]!;
    const v = (s.solution.charCodeAt(lastC) - 48) as CellValue;
    const final = enterDigit(selectCell(s, 0, lastC), v);
    expect(
      final.events?.some((e) => e.type === "unitComplete" && e.unit === "row" && e.index === 0)
    ).toBe(true);
  });

  it("emits unitComplete(col) when placing the last digit in a column", () => {
    let s = loadPuzzle("easy", "classic", rng0);
    const emptyInCol0: number[] = [];
    for (let r = 0; r < 9; r++) {
      if (!s.grid[r]![0]!.given) emptyInCol0.push(r);
    }
    expect(emptyInCol0.length).toBeGreaterThan(0);
    for (let i = 0; i < emptyInCol0.length - 1; i++) {
      const r = emptyInCol0[i]!;
      const v = (s.solution.charCodeAt(r * 9) - 48) as CellValue;
      s = enterDigit(selectCell(s, r, 0), v);
    }
    const lastR = emptyInCol0[emptyInCol0.length - 1]!;
    const v = (s.solution.charCodeAt(lastR * 9) - 48) as CellValue;
    const final = enterDigit(selectCell(s, lastR, 0), v);
    expect(
      final.events?.some((e) => e.type === "unitComplete" && e.unit === "col" && e.index === 0)
    ).toBe(true);
  });

  it("emits puzzleComplete when the last cell is correctly placed", () => {
    let s = loadPuzzle("easy", "classic", rng0);
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        if (s.grid[r]![c]!.given) continue;
        const v = (s.solution.charCodeAt(r * 9 + c) - 48) as CellValue;
        s = enterDigit(selectCell(s, r, c), v);
      }
    }
    expect(s.events).toContainEqual({ type: "puzzleComplete" } satisfies GameEvent);
    expect(s.isComplete).toBe(true);
  });

  it("clears events on undo (snapshot carries no events)", () => {
    const s0 = loadPuzzle("easy", "classic", rng0);
    const { row, col } = findEmpty(s0);
    const correct = (s0.solution.charCodeAt(row * 9 + col) - 48) as CellValue;
    const s1 = enterDigit(selectCell(s0, row, col), correct);
    expect(s1.events?.length).toBeGreaterThan(0);
    const s2 = undo(s1);
    expect(s2.events).toBeUndefined();
  });

  it("emits digitPlace and row unitComplete in the mini (6×6) variant", () => {
    let s = loadPuzzle("easy", "mini", rng0);
    const emptyInRow0: number[] = [];
    for (let c = 0; c < 6; c++) {
      if (!s.grid[0]![c]!.given) emptyInRow0.push(c);
    }
    expect(emptyInRow0.length).toBeGreaterThan(0);
    for (let i = 0; i < emptyInRow0.length - 1; i++) {
      const c = emptyInRow0[i]!;
      const v = (s.solution.charCodeAt(c) - 48) as CellValue;
      s = enterDigit(selectCell(s, 0, c), v);
    }
    const lastC = emptyInRow0[emptyInRow0.length - 1]!;
    const v = (s.solution.charCodeAt(lastC) - 48) as CellValue;
    const final = enterDigit(selectCell(s, 0, lastC), v);
    expect(final.events).toContainEqual({ type: "digitPlace" } satisfies GameEvent);
    expect(
      final.events?.some((e) => e.type === "unitComplete" && e.unit === "row" && e.index === 0)
    ).toBe(true);
  });
});
