/**
 * AsyncStorage persistence for in-progress Sudoku games (#619, #748), through
 * the shared `storageSlot` (#2987).
 *
 * Saves after every state mutation so a crash or backgrounded app
 * doesn't lose progress. One slot per device — no account linkage in
 * V1, matching the Solitaire/Hearts pattern.
 *
 * Pencil notes (`Set<NoteDigit>`) don't round-trip through JSON, so
 * `saveGame` converts each set to a sorted array and `loadGame`
 * restores it. `undoStack` snapshots carry their own `notes` sets —
 * those get the same treatment.
 *
 * `loadGame` enforces `_v: 1` so future schema bumps reject
 * incompatible payloads rather than corrupting state. The `variant`
 * field was added in #748; saves without it are migrated to "classic".
 * Cells' `isError` flags are re-derived on load (#2943).
 */

import type { Grid, NoteDigit, SudokuCell, SudokuState, Variant } from "./types";
import { createJsonSlot, createRecord } from "../_shared/storageSlot";
import { recomputeConflicts } from "./engine";
import { variantConfig } from "./types";
import {
  SUDOKU_GAME_KEY,
  looksValid,
  type SerializedCell,
  type SerializedState,
} from "./savedShape";

const SUBSYSTEM = "sudoku.storage";

function serializeCell(c: SudokuCell): SerializedCell {
  return {
    value: c.value,
    given: c.given,
    notes: Array.from(c.notes).sort((a, b) => a - b),
    isError: c.isError,
  };
}

function serializeGrid(g: Grid): SerializedCell[][] {
  return g.map((row) => row.map(serializeCell));
}

function serializeSnapshot(s: SudokuState): Omit<SerializedState, "undoStack"> {
  return {
    _v: 1,
    variant: s.variant,
    difficulty: s.difficulty,
    puzzle: s.puzzle,
    solution: s.solution,
    grid: serializeGrid(s.grid),
    selectedRow: s.selectedRow,
    selectedCol: s.selectedCol,
    notesMode: s.notesMode,
    errorCount: s.errorCount,
    isComplete: s.isComplete,
  };
}

function serializeState(s: SudokuState): SerializedState {
  return {
    ...serializeSnapshot(s),
    undoStack: s.undoStack.map((snap) => ({
      ...serializeSnapshot(snap),
      undoStack: [] as [],
    })),
    // JSON drops undefined keys: a game that records nothing saves no count (#3288)
    ...(s.entryCount === undefined ? {} : { entryCount: s.entryCount }),
    ...(s.replayRows === undefined ? {} : { replayRows: s.replayRows }),
    ...(s.accumulatedMs === undefined ? {} : { accumulatedMs: s.accumulatedMs }),
  };
}

function restoreCell(c: SerializedCell): SudokuCell {
  return {
    value: c.value as SudokuCell["value"],
    given: c.given,
    notes: new Set(c.notes as NoteDigit[]),
    isError: c.isError,
  };
}

function restoreGrid(rows: SerializedCell[][]): Grid {
  return rows.map((row) => row.map(restoreCell));
}

function restoreSnapshot(p: Omit<SerializedState, "undoStack">): Omit<SudokuState, "undoStack"> {
  const variant: Variant = p.variant === "mini" || p.variant === "classic" ? p.variant : "classic";
  return {
    _v: 1,
    variant,
    difficulty: p.difficulty as SudokuState["difficulty"],
    puzzle: p.puzzle,
    solution: p.solution,
    // `isError` means "currently illegal" (#2943); saves from the old rule
    // (differs from the solution) are re-derived from the board.
    grid: recomputeConflicts(restoreGrid(p.grid), variantConfig(variant)),
    selectedRow: p.selectedRow,
    selectedCol: p.selectedCol,
    notesMode: p.notesMode,
    errorCount: p.errorCount,
    isComplete: p.isComplete,
  };
}

function restoreState(parsed: SerializedState): SudokuState {
  return {
    ...restoreSnapshot(parsed),
    undoStack: parsed.undoStack.map((snap) => ({
      ...restoreSnapshot(snap),
      undoStack: [] as const,
    })),
    // A count that is not a sane non-negative integer is dropped (#3288).
    ...(Number.isSafeInteger(parsed.entryCount) && (parsed.entryCount as number) >= 0
      ? { entryCount: parsed.entryCount as number }
      : {}),
    ...(Number.isSafeInteger(parsed.replayRows) && (parsed.replayRows as number) >= 0
      ? { replayRows: parsed.replayRows as number }
      : {}),
    // Banked play time (#4089): a missing, negative or non-finite value is dropped, which reads as
    // 0 (the stored shape of a save without it does not move).
    ...(typeof parsed.accumulatedMs === "number" &&
    Number.isFinite(parsed.accumulatedMs) &&
    parsed.accumulatedMs > 0
      ? { accumulatedMs: parsed.accumulatedMs }
      : {}),
  };
}

/**
 * A failed read is reported as an error and the save kept; a payload that
 * won't parse, or fails `looksValid`, is removed with a warning.
 */
export const {
  save: saveGame,
  load: loadGame,
  clear: clearGame,
} = createJsonSlot<SudokuState, SerializedState>({
  key: SUDOKU_GAME_KEY,
  subsystem: SUBSYSTEM,
  isValid: looksValid,
  invalidWarning: () => ({ message: "sudoku.storage: invalid payload shape, discarding" }),
  corruptMessage: "sudoku.storage: unparseable payload, discarding",
  corruptExtra: "none",
  readFailureIsError: true,
  onLoad: restoreState,
  beforeSave: serializeState,
});

// The device's best time per puzzle kind (#762, #748), for the result card's best time and "New
// best" badge, is the shared personal best (`game/_shared/personalBest.ts`, #3757, keyed
// `sudokuVariant(mode, difficulty)`); its old record `sudoku_stats_v1` is moved in there on the
// first read.

// ---------------------------------------------------------------------------
// "Show mistakes" preference (#2943)
// ---------------------------------------------------------------------------

/**
 * The player's explicit "Show mistakes" choice, or null while they have not
 * made one (the screen then defaults by difficulty: on for easy only). Once
 * set it applies to every puzzle.
 */
export const { load: loadShowMistakes, save: saveShowMistakes } = createRecord<boolean | null>({
  key: "sudoku_show_mistakes",
  subsystem: SUBSYSTEM,
  ops: { load: "loadShowMistakes", save: "saveShowMistakes" },
  fallback: () => null,
  read: (raw) => (raw === "1" ? true : raw === "0" ? false : null),
  write: (value) => (value === null ? "" : value ? "1" : "0"),
});
