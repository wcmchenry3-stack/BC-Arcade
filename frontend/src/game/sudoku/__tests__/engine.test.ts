/**
 * Sudoku engine unit tests (#616).
 *
 * Covers the checklist in the issue:
 *   - solvePuzzle: known puzzles + impossible input
 *   - loadPuzzle: given count per difficulty; givens marked immutable
 *   - enterDigit (normal): correct → no error; illegal (row/col/box duplicate)
 *     → isError + errorCount; legal-but-wrong → neither (#2943);
 *     undo stack grows; given cells immutable
 *   - enterDigit (notes): toggle; never touches other cells' notes (#3785)
 *   - eraseCell: clears value + notes; no-op on givens
 *   - undo: restores the board (digits, notes, errorCount); keeps notesMode and
 *     the selection, except the changed cell is selected (#3785)
 *   - isComplete: true only when all 81 cells match solution
 *   - getConflicts: row, col, box detection; empty when none
 */

import {
  applyHint,
  enterDigit,
  eraseCell,
  getConflicts,
  isComplete,
  isFullButWrong,
  loadPuzzle,
  recomputeConflicts,
  selectCell,
  solvePuzzle,
  toggleNotesMode,
  undo,
} from "../engine";
import { applyRecorded } from "../replay";
import type { CellValue, GameEvent, Grid, NoteDigit, SudokuCell, SudokuState } from "../types";
import { CLASSIC_CONFIG, UNDO_STACK_LIMIT } from "../types";

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

/** A digit that is not the solution and duplicates a peer: an illegal move. */
function illegalDigit(state: SudokuState, row: number, col: number): CellValue {
  const correct = state.solution.charCodeAt(row * 9 + col) - 48;
  for (let d = 1; d <= 9; d++) {
    if (d !== correct && getConflicts(state.grid, row, col, d).length > 0) return d as CellValue;
  }
  throw new Error("no illegal digit for this cell");
}

/** An empty cell with a digit that is wrong but breaks no row/column/box rule. */
function findLegalWrong(state: SudokuState): { row: number; col: number; digit: CellValue } {
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      if (state.grid[r]![c]!.given) continue;
      const correct = state.solution.charCodeAt(r * 9 + c) - 48;
      for (let d = 1; d <= 9; d++) {
        if (d !== correct && getConflicts(state.grid, r, c, d).length === 0) {
          return { row: r, col: c, digit: d as CellValue };
        }
      }
    }
  }
  throw new Error("no legal-but-wrong move");
}

/** The state with every non-given cell holding its solution digit, except `wrong` cells. */
function filled(
  state: SudokuState,
  wrong: ReadonlyArray<readonly [number, number, CellValue]> = []
): SudokuState {
  const grid = state.grid.map((rowCells, r) =>
    rowCells.map((cell, c) => {
      if (cell.given) return cell;
      const w = wrong.find(([wr, wc]) => wr === r && wc === c);
      const value = w ? w[2] : ((state.solution.charCodeAt(r * 9 + c) - 48) as CellValue);
      return { ...cell, value, notes: new Set<NoteDigit>(), isError: false };
    })
  );
  return { ...state, grid: recomputeConflicts(grid, CLASSIC_CONFIG) };
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

  it("flags isError and increments errorCount on an illegal digit (#2943)", () => {
    const s0 = loadPuzzle("easy", "classic", rng0);
    const { row, col } = findEmpty(s0);
    const bad = illegalDigit(s0, row, col);
    const s1 = enterDigit(selectCell(s0, row, col), bad);
    const cell = s1.grid[row]![col]!;
    expect(cell.value).toBe(bad);
    expect(cell.isError).toBe(true);
    expect(s1.errorCount).toBe(1);
  });

  it("does not flag or count a legal digit that is not the solution (#2943)", () => {
    const s0 = loadPuzzle("easy", "classic", rng0);
    const { row, col, digit } = findLegalWrong(s0);
    const s1 = enterDigit(selectCell(s0, row, col), digit);
    const cell = s1.grid[row]![col]!;
    expect(cell.value).toBe(digit);
    expect(cell.isError).toBe(false);
    expect(s1.errorCount).toBe(0);
    expect(s1.events?.some((e) => e.type === "errorEntered")).toBe(false);
    expect(s1.isComplete).toBe(false);
  });

  it("flags the conflicting player peer too, and clears both when one is erased (#2943)", () => {
    const s0 = loadPuzzle("easy", "classic", rng0);
    const { row, col, digit } = findLegalWrong(s0);
    const s1 = enterDigit(selectCell(s0, row, col), digit);
    // Another empty cell in the same row that is not the solution digit there.
    let peerCol = -1;
    for (let c = 0; c < 9; c++) {
      if (c !== col && !s1.grid[row]![c]!.given && s1.grid[row]![c]!.value === 0) {
        peerCol = c;
        break;
      }
    }
    expect(peerCol).toBeGreaterThanOrEqual(0);
    const s2 = enterDigit(selectCell(s1, row, peerCol), digit);
    expect(s2.errorCount).toBe(1);
    expect(s2.grid[row]![peerCol]!.isError).toBe(true);
    expect(s2.grid[row]![col]!.isError).toBe(true);
    const s3 = eraseCell(s2);
    expect(s3.grid[row]![peerCol]!.isError).toBe(false);
    expect(s3.grid[row]![col]!.isError).toBe(false);
    // The entry stays counted: errorCount counts illegal entries made.
    expect(s3.errorCount).toBe(1);
  });

  it("clears the highlight when the player overwrites the conflicting digit (#2943)", () => {
    const s0 = loadPuzzle("easy", "classic", rng0);
    const { row, col } = findEmpty(s0);
    const bad = illegalDigit(s0, row, col);
    const s1 = enterDigit(selectCell(s0, row, col), bad);
    expect(s1.grid[row]![col]!.isError).toBe(true);
    const correct = s0.solution.charCodeAt(row * 9 + col) - 48;
    const s2 = enterDigit(s1, correct as CellValue);
    expect(s2.grid[row]![col]!.isError).toBe(false);
    expect(s2.errorCount).toBe(1);
  });

  it("stays solution-based for completion (#2943)", () => {
    const s0 = loadPuzzle("easy", "classic", rng0);
    const full = filled(s0);
    expect(isComplete(full.grid, full.solution)).toBe(true);
    const { row, col, digit } = findLegalWrong(s0);
    const wrongFull = filled(s0, [[row, col, digit]]);
    expect(isComplete(wrongFull.grid, wrongFull.solution)).toBe(false);
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
// enterDigit — a repeat tap (#3773)
// ---------------------------------------------------------------------------

describe("enterDigit: entering the digit a cell already holds (#3773)", () => {
  it("returns the very same state for a legal digit: no undo step, no events", () => {
    const s0 = loadPuzzle("easy", "classic", rng0);
    const { row, col } = findEmpty(s0);
    const correct = s0.solution.charCodeAt(row * 9 + col) - 48;
    const s1 = enterDigit(selectCell(s0, row, col), correct as CellValue);
    const s2 = enterDigit(s1, correct as CellValue);
    expect(s2).toBe(s1);
    expect(s2.undoStack).toHaveLength(1);
    expect(s2.events).toBe(s1.events);
  });

  it("costs no further error when the illegal digit is tapped again", () => {
    const s0 = loadPuzzle("easy", "classic", rng0);
    const { row, col } = findEmpty(s0);
    const bad = illegalDigit(s0, row, col);
    const s1 = enterDigit(selectCell(s0, row, col), bad);
    expect(s1.errorCount).toBe(1);
    const s2 = enterDigit(enterDigit(s1, bad), bad);
    expect(s2).toBe(s1);
    expect(s2.errorCount).toBe(1);
    expect(s2.undoStack).toHaveLength(1);
    expect(s2.events).toBe(s1.events); // no second errorEntered
  });

  it("a different digit still replaces it, and the same digit after that counts again", () => {
    const s0 = loadPuzzle("easy", "classic", rng0);
    const { row, col } = findEmpty(s0);
    const correct = s0.solution.charCodeAt(row * 9 + col) - 48;
    const other = (correct % 9) + 1;
    const s1 = enterDigit(selectCell(s0, row, col), correct as CellValue);
    const s2 = enterDigit(s1, other as CellValue);
    expect(s2).not.toBe(s1);
    expect(s2.grid[row]![col]!.value).toBe(other);
    expect(s2.undoStack).toHaveLength(2);
    const s3 = enterDigit(s2, correct as CellValue);
    expect(s3.grid[row]![col]!.value).toBe(correct);
    expect(s3.undoStack).toHaveLength(3);
  });

  it("is not recorded for replay: applyRecorded gives nothing for a repeat tap", () => {
    const s0 = loadPuzzle("easy", "classic", rng0);
    const { row, col } = findEmpty(s0);
    const correct = s0.solution.charCodeAt(row * 9 + col) - 48;
    const s1 = enterDigit(selectCell(s0, row, col), correct as CellValue);
    expect(applyRecorded(s1, { kind: "digit", digit: correct as CellValue })).toBeNull();
    // ...while the first tap is
    const first = applyRecorded(selectCell(s0, row, col), {
      kind: "digit",
      digit: correct as CellValue,
    });
    expect(first).not.toBeNull();
  });

  it("still toggles a note when the same digit is tapped twice in notes mode", () => {
    const s0 = loadPuzzle("easy", "classic", rng0);
    const { row, col } = findEmpty(s0);
    const s1 = enterDigit(toggleNotesMode(selectCell(s0, row, col)), 4);
    expect(s1.grid[row]![col]!.notes.has(4)).toBe(true);
    const s2 = enterDigit(s1, 4);
    expect(s2.grid[row]![col]!.notes.has(4)).toBe(false);
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
    const wrong = illegalDigit(s0, row, col);
    const s1 = enterDigit(selectCell(s0, row, col), wrong);
    expect(s1.errorCount).toBe(1);
    const s2 = undo(s1);
    expect(s2.errorCount).toBe(0);
  });

  it("keeps the current notesMode on undo (#3785)", () => {
    const s0 = loadPuzzle("easy", "classic", rng0);
    const { row, col } = findEmpty(s0);
    // Place a value (notes mode off), switch notes mode on, undo: the board
    // is restored but notes mode stays on.
    const s1 = enterDigit(selectCell(s0, row, col), 5);
    const s2 = toggleNotesMode(s1);
    expect(s2.notesMode).toBe(true);
    const s3 = undo(s2);
    expect(s3.notesMode).toBe(true);
    expect(s3.grid[row]![col]!.value).toBe(0);
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

  it("emits digitPlace and errorEntered on an illegal digit", () => {
    const s0 = loadPuzzle("easy", "classic", rng0);
    const { row, col } = findEmpty(s0);
    const wrong = illegalDigit(s0, row, col);
    const s1 = enterDigit(selectCell(s0, row, col), wrong);
    expect(s1.events).toContainEqual({ type: "digitPlace" } satisfies GameEvent);
    expect(s1.events).toContainEqual({ type: "errorEntered" } satisfies GameEvent);
    expect(s1.events?.some((e) => e.type === "unitComplete")).toBe(false);
  });

  it("emits only digitPlace for a legal-but-wrong digit (#2943)", () => {
    const s0 = loadPuzzle("easy", "classic", rng0);
    const { row, col, digit } = findLegalWrong(s0);
    const s1 = enterDigit(selectCell(s0, row, col), digit);
    expect(s1.events).toContainEqual({ type: "digitPlace" } satisfies GameEvent);
    expect(s1.events?.some((e) => e.type === "errorEntered")).toBe(false);
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

// ---------------------------------------------------------------------------
// full-but-wrong grid + hint (#2943)
// ---------------------------------------------------------------------------

describe("isFullButWrong / applyHint", () => {
  it("in notes mode places the solution digit (not a note), snapshots undo, keeps notesMode", () => {
    const s0 = toggleNotesMode(loadPuzzle("easy", "classic", rng0));
    const { row, col } = findEmpty(s0);
    const s1 = applyHint(selectCell(s0, row, col));
    const placed = s1.grid[row]![col]!;
    expect(placed.value).toBe(s0.solution.charCodeAt(row * 9 + col) - 48);
    expect(placed.notes.size).toBe(0);
    expect(s1.undoStack.length).toBe(1);
    expect(s1.notesMode).toBe(true);
  });

  it("is false for an unfinished grid and for the solved one", () => {
    const s0 = loadPuzzle("easy", "classic", rng0);
    expect(isFullButWrong(s0)).toBe(false);
    expect(isFullButWrong({ ...filled(s0), isComplete: true })).toBe(false);
  });

  it("is true when every cell is filled but one digit is wrong", () => {
    const s0 = loadPuzzle("easy", "classic", rng0);
    const { row, col, digit } = findLegalWrong(s0);
    expect(isFullButWrong(filled(s0, [[row, col, digit]]))).toBe(true);
  });

  it("fills the selected empty cell with the solution digit, at no cost", () => {
    const s0 = loadPuzzle("easy", "classic", rng0);
    const { row, col } = findEmpty(s0);
    const s1 = applyHint(selectCell(s0, row, col));
    expect(s1.grid[row]![col]!.value).toBe(s0.solution.charCodeAt(row * 9 + col) - 48);
    expect(s1.errorCount).toBe(0);
  });

  it("is a no-op with nothing selected on an unfinished grid", () => {
    const s0 = loadPuzzle("easy", "classic", rng0);
    expect(applyHint(s0)).toBe(s0);
  });

  it("on a full-but-wrong grid selects and corrects a wrong cell", () => {
    const s0 = loadPuzzle("easy", "classic", rng0);
    const { row, col, digit } = findLegalWrong(s0);
    const full = filled(s0, [[row, col, digit]]);
    const s1 = applyHint(full);
    expect(s1.selectedRow).toBe(row);
    expect(s1.selectedCol).toBe(col);
    expect(s1.grid[row]![col]!.value).toBe(s0.solution.charCodeAt(row * 9 + col) - 48);
    expect(s1.isComplete).toBe(true);
    expect(s1.errorCount).toBe(0);
  });

  it("prefers the selected cell when it is the wrong one", () => {
    const s0 = loadPuzzle("easy", "classic", rng0);
    const first = findLegalWrong(s0);
    // A second wrong cell later in reading order than the first.
    let second: { row: number; col: number; digit: CellValue } | null = null;
    for (let r = 8; r >= 0 && !second; r--) {
      for (let c = 8; c >= 0 && !second; c--) {
        if (s0.grid[r]![c]!.given || (r === first.row && c === first.col)) continue;
        const correct = s0.solution.charCodeAt(r * 9 + c) - 48;
        second = { row: r, col: c, digit: ((correct % 9) + 1) as CellValue };
      }
    }
    const full = selectCell(
      filled(s0, [
        [first.row, first.col, first.digit],
        [second!.row, second!.col, second!.digit],
      ]),
      second!.row,
      second!.col
    );
    const s1 = applyHint(full);
    expect(s1.selectedRow).toBe(second!.row);
    expect(s1.grid[second!.row]![second!.col]!.value).toBe(
      s0.solution.charCodeAt(second!.row * 9 + second!.col) - 48
    );
    expect(s1.grid[first.row]![first.col]!.value).toBe(first.digit);
  });
});

describe("recomputeConflicts", () => {
  it("normalises old-rule flags: a legal-wrong cell loses isError, a duplicate gains it", () => {
    const s0 = loadPuzzle("easy", "classic", rng0);
    const { row, col, digit } = findLegalWrong(s0);
    const oldFlagged = {
      ...s0.grid[row]![col]!,
      value: digit,
      isError: true,
    };
    const grid = s0.grid.map((rc, r) =>
      rc.map((cell, c) => (r === row && c === col ? oldFlagged : cell))
    );
    expect(recomputeConflicts(grid, CLASSIC_CONFIG)[row]![col]!.isError).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// #3785 rules: unit complete only when correct, peer-note auto-clear, undo
// ---------------------------------------------------------------------------

/** The state with every cell empty and not a given (no peer can conflict), same solution. */
function blankBoard(state: SudokuState): SudokuState {
  const grid = state.grid.map((rowCells) =>
    rowCells.map((cell) => ({
      ...cell,
      value: 0 as CellValue,
      given: false,
      notes: new Set<NoteDigit>(),
      isError: false,
    }))
  );
  return { ...state, grid, undoStack: [], errorCount: 0, isComplete: false };
}

function solutionDigit(s: SudokuState, r: number, c: number): CellValue {
  return (s.solution.charCodeAt(r * s.grid.length + c) - 48) as CellValue;
}

function putNote(s: SudokuState, r: number, c: number, d: number): SudokuState {
  // selectCell on the selected cell deselects it: start from no selection
  const on = toggleNotesMode(selectCell({ ...s, selectedRow: null, selectedCol: null }, r, c));
  const noted = enterDigit(on, d as CellValue);
  return toggleNotesMode({ ...noted, selectedRow: null, selectedCol: null });
}

function notesAt(s: SudokuState, r: number, c: number): number[] {
  return [...s.grid[r]![c]!.notes].sort((a, b) => a - b);
}

/** Place `cells` ([row, col, digit]) in order, selecting each. */
function placeAll(s0: SudokuState, cells: ReadonlyArray<readonly [number, number, number]>) {
  let s = s0;
  for (const [r, c, d] of cells)
    s = enterDigit(
      selectCell({ ...s, selectedRow: null, selectedCol: null }, r, c),
      d as CellValue
    );
  return s;
}

const hasUnit = (s: SudokuState, unit: "row" | "col" | "box") =>
  s.events?.some((e) => e.type === "unitComplete" && e.unit === unit) === true;

describe("unitComplete only when the unit matches the solution (#3785)", () => {
  it.each(["classic", "mini"] as const)(
    "a full, duplicate-free but wrong row does not fire (%s); the correct row does",
    (variant) => {
      const base = blankBoard(loadPuzzle("easy", variant, rng0));
      const size = base.grid.length;
      const row0 = (swap: boolean): Array<readonly [number, number, number]> =>
        Array.from({ length: size }, (_, c) => {
          const src = swap && c < 2 ? 1 - c : c;
          return [0, c, solutionDigit(base, 0, src)] as const;
        });
      // cols 0 and 1 swapped: row 0 is full with no duplicate, but wrong
      const wrongCells = row0(true);
      const beforeLast = placeAll(base, wrongCells.slice(0, size - 1));
      const last = wrongCells[size - 1]!;
      const wrong = placeAll(beforeLast, [last]);
      expect(wrong.events).toContainEqual({ type: "digitPlace" });
      expect(wrong.events?.some((e) => e.type === "errorEntered")).toBe(false);
      expect(hasUnit(wrong, "row")).toBe(false);

      const rightCells = row0(false);
      const right = placeAll(placeAll(base, rightCells.slice(0, size - 1)), [
        rightCells[size - 1]!,
      ]);
      expect(hasUnit(right, "row")).toBe(true);
    }
  );

  it("a full but wrong column does not fire; the correct column does", () => {
    const base = blankBoard(loadPuzzle("easy", "classic", rng0));
    const col0 = (swap: boolean) =>
      Array.from({ length: 9 }, (_, r) => {
        const src = swap && r < 2 ? 1 - r : r;
        return [r, 0, solutionDigit(base, src, 0)] as const;
      });
    const wrongCells = col0(true);
    const wrong = placeAll(placeAll(base, wrongCells.slice(0, 8)), [wrongCells[8]!]);
    expect(hasUnit(wrong, "col")).toBe(false);
    const rightCells = col0(false);
    const right = placeAll(placeAll(base, rightCells.slice(0, 8)), [rightCells[8]!]);
    expect(hasUnit(right, "col")).toBe(true);
  });

  it("a full but wrong box does not fire; the correct box does (classic 3x3, mini 2x3)", () => {
    for (const [variant, boxRows, boxCols] of [
      ["classic", 3, 3],
      ["mini", 2, 3],
    ] as const) {
      const base = blankBoard(loadPuzzle("easy", variant, rng0));
      const cells = (swap: boolean) => {
        const out: Array<readonly [number, number, number]> = [];
        for (let r = 0; r < boxRows; r++) {
          for (let c = 0; c < boxCols; c++) {
            const src = swap && r === 0 && c < 2 ? 1 - c : c;
            out.push([r, c, solutionDigit(base, r, src)] as const);
          }
        }
        return out;
      };
      const w = cells(true);
      const wrong = placeAll(placeAll(base, w.slice(0, -1)), [w[w.length - 1]!]);
      expect(hasUnit(wrong, "box")).toBe(false);
      const ok = cells(false);
      const right = placeAll(placeAll(base, ok.slice(0, -1)), [ok[ok.length - 1]!]);
      expect(hasUnit(right, "box")).toBe(true);
    }
  });
});

describe("placing a digit clears it from its peers' notes (#3785)", () => {
  // [placed], row peer, column peer, box peer, a cell that is no peer
  const layouts = {
    classic: { at: [4, 4], row: [4, 0], col: [0, 4], box: [3, 3], far: [0, 0] },
    mini: { at: [0, 0], row: [0, 5], col: [5, 0], box: [1, 2], far: [3, 4] },
  } as const;

  it.each(["classic", "mini"] as const)("removes it from row, column and box peers (%s)", (v) => {
    const L = layouts[v];
    let s = blankBoard(loadPuzzle("easy", v, rng0));
    for (const [r, c] of [L.row, L.col, L.box, L.far]) {
      s = putNote(s, r, c, 3);
      s = putNote(s, r, c, 2);
    }
    const placed = enterDigit(selectCell(s, L.at[0], L.at[1]), 3);
    for (const [r, c] of [L.row, L.col, L.box]) expect(notesAt(placed, r, c)).toEqual([2]);
    expect(notesAt(placed, L.far[0], L.far[1])).toEqual([2, 3]);
  });

  it("applies to an illegal digit and to a hint", () => {
    const L = layouts.classic;
    let s = blankBoard(loadPuzzle("easy", "classic", rng0));
    const d = solutionDigit(s, L.at[0], L.at[1]);
    s = putNote(s, L.row[0], L.row[1], d);
    s = putNote(s, L.col[0], L.col[1], d);
    const hinted = applyHint(selectCell(s, L.at[0], L.at[1]));
    expect(hinted.grid[L.at[0]][L.at[1]]!.value).toBe(d);
    expect(notesAt(hinted, L.row[0], L.row[1])).toEqual([]);
    expect(notesAt(hinted, L.col[0], L.col[1])).toEqual([]);
  });

  it("undo restores the cleared notes along with the cell", () => {
    const L = layouts.classic;
    let s = blankBoard(loadPuzzle("easy", "classic", rng0));
    s = putNote(s, L.row[0], L.row[1], 3);
    s = putNote(s, L.box[0], L.box[1], 3);
    s = putNote(s, L.box[0], L.box[1], 7);
    const placed = enterDigit(selectCell(s, L.at[0], L.at[1]), 3);
    expect(notesAt(placed, L.row[0], L.row[1])).toEqual([]);
    const undone = undo(placed);
    expect(notesAt(undone, L.row[0], L.row[1])).toEqual([3]);
    expect(notesAt(undone, L.box[0], L.box[1])).toEqual([3, 7]);
    expect(undone.grid[L.at[0]][L.at[1]]!.value).toBe(0);
  });

  it("undo after a hint restores the cleared notes", () => {
    const L = layouts.mini;
    let s = blankBoard(loadPuzzle("easy", "mini", rng0));
    const d = solutionDigit(s, L.at[0], L.at[1]);
    s = putNote(s, L.col[0], L.col[1], d);
    const hinted = applyHint(selectCell(s, L.at[0], L.at[1]));
    expect(notesAt(hinted, L.col[0], L.col[1])).toEqual([]);
    expect(notesAt(undo(hinted), L.col[0], L.col[1])).toEqual([d]);
  });

  it("notes mode never auto-clears: a note next to a placed digit stays, and a peer keeps its notes", () => {
    const L = layouts.classic;
    let s = blankBoard(loadPuzzle("easy", "classic", rng0));
    s = placeAll(s, [[L.row[0], L.row[1], 3]]);
    s = putNote(s, L.row[0], L.row[1], 3); // a note on the filled cell
    s = putNote(s, L.at[0], L.at[1], 3); // a note on its peer
    expect(notesAt(s, L.row[0], L.row[1])).toEqual([3]);
    expect(notesAt(s, L.at[0], L.at[1])).toEqual([3]);
    // toggling the same note off removes only that one
    const off = putNote(s, L.at[0], L.at[1], 3);
    expect(notesAt(off, L.at[0], L.at[1])).toEqual([]);
    expect(notesAt(off, L.row[0], L.row[1])).toEqual([3]);
  });
});

describe("undo restores the board only (#3785)", () => {
  it("keeps Notes mode and selects the cell it changed", () => {
    const s0 = blankBoard(loadPuzzle("easy", "classic", rng0));
    const placed = enterDigit(selectCell(s0, 2, 5), 4);
    // the player moves on: selects another cell and turns Notes mode on
    const moved = toggleNotesMode(selectCell(placed, 7, 7));
    const undone = undo(moved);
    expect(undone.notesMode).toBe(true);
    expect(undone.selectedRow).toBe(2);
    expect(undone.selectedCol).toBe(5);
    expect(undone.grid[2]![5]!.value).toBe(0);
  });

  it("keeps Notes mode off when it was on at the snapshot", () => {
    const s0 = blankBoard(loadPuzzle("easy", "mini", rng0));
    const noted = toggleNotesMode(selectCell(s0, 0, 0));
    // a digit in normal mode, then Notes mode off -> on happens before undo
    const placed = enterDigit(toggleNotesMode(noted), 2);
    const undone = undo(placed);
    expect(undone.notesMode).toBe(false);
  });

  it("restores the error count and conflicts", () => {
    const s0 = blankBoard(loadPuzzle("easy", "classic", rng0));
    const a = enterDigit(selectCell(s0, 0, 0), 5);
    const b = enterDigit(selectCell(a, 0, 4), 5); // duplicate in the row
    expect(b.errorCount).toBe(1);
    expect(b.grid[0]![4]!.isError).toBe(true);
    const undone = undo(toggleNotesMode(selectCell(b, 8, 8)));
    expect(undone.errorCount).toBe(0);
    expect(undone.grid[0]![4]!.isError).toBe(false);
    expect(undone.grid[0]![0]!.isError).toBe(false);
    expect([undone.selectedRow, undone.selectedCol]).toEqual([0, 4]);
    expect(undone.notesMode).toBe(true);
  });

  it("selects the cell an undone erase restored, and the one a note-only erase cleared", () => {
    const s0 = blankBoard(loadPuzzle("easy", "classic", rng0));
    const placed = enterDigit(selectCell(s0, 1, 1), 6);
    const erased = eraseCell(placed);
    const back = undo(selectCell({ ...erased, selectedRow: null, selectedCol: null }, 5, 5));
    expect([back.selectedRow, back.selectedCol]).toEqual([1, 1]);
    expect(back.grid[1]![1]!.value).toBe(6);

    const noted = putNote(s0, 3, 3, 2);
    const cleared = eraseCell(selectCell(noted, 3, 3));
    expect(notesAt(cleared, 3, 3)).toEqual([]);
    const restored = undo(selectCell(cleared, 6, 6));
    expect(notesAt(restored, 3, 3)).toEqual([2]);
    expect([restored.selectedRow, restored.selectedCol]).toEqual([3, 3]);
  });

  it("undoing a hint selects the hinted cell", () => {
    const s0 = blankBoard(loadPuzzle("easy", "classic", rng0));
    const hinted = applyHint(selectCell(s0, 4, 2));
    const undone = undo(selectCell(hinted, 8, 8));
    expect([undone.selectedRow, undone.selectedCol]).toEqual([4, 2]);
    expect(undone.grid[4]![2]!.value).toBe(0);
  });
});
