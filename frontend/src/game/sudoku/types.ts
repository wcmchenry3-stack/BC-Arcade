/**
 * Sudoku — shared types (#616, #748).
 *
 * Pure data. No React, no AsyncStorage, no side effects. Imported by the
 * engine, UI components, and persistence layer alike.
 */

export type Difficulty = "easy" | "medium" | "hard";

export const DIFFICULTIES: readonly Difficulty[] = ["easy", "medium", "hard"];

export type Variant = "classic" | "mini";

export const VARIANTS: readonly Variant[] = ["classic", "mini"];

/** Grid dimensions and box shape for a given variant. */
export interface GridConfig {
  readonly size: number;
  readonly boxRows: number;
  readonly boxCols: number;
}

export const CLASSIC_CONFIG: GridConfig = { size: 9, boxRows: 3, boxCols: 3 };
export const MINI_CONFIG: GridConfig = { size: 6, boxRows: 2, boxCols: 3 };

export function variantConfig(variant: Variant): GridConfig {
  return variant === "mini" ? MINI_CONFIG : CLASSIC_CONFIG;
}

/** 0 means empty. 1-9 are the placed digits. */
export type CellValue = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

/** 1-9, the only valid pencil-note values. */
export type NoteDigit = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

export interface SudokuCell {
  readonly value: CellValue;
  /** True for cells that were part of the initial puzzle; UI must block input. */
  readonly given: boolean;
  /** Digits the player has pencilled in. Empty when `value !== 0` in practice. */
  readonly notes: ReadonlySet<NoteDigit>;
  /**
   * True when a player-entered `value` duplicates a digit in its row, column
   * or box (an illegal move, #2943). Derived from the board, so it clears when
   * the conflicting peer changes. Says nothing about the solution.
   */
  readonly isError: boolean;
}

/** size×size grid, indexed [row][col]. */
export type Grid = readonly (readonly SudokuCell[])[];

/** Immutable snapshot. `_v` is a schema version so persisted saves can
 * be migrated or rejected safely. */
export interface SudokuState {
  readonly _v: 1;
  readonly variant: Variant;
  readonly difficulty: Difficulty;
  /** Original puzzle string from puzzles.json / puzzles_mini.json. 81 chars
   * for classic, 36 chars for mini. Kept so the UI can detect givens and
   * reset to initial state without recomputing. */
  readonly puzzle: string;
  /** Solved puzzle string derived at load time by `solvePuzzle`. Same
   * length as `puzzle`. */
  readonly solution: string;
  readonly grid: Grid;
  /** Selected cell (row, col) or null. Givens may be selected for
   * highlighting, but `enterDigit` / `eraseCell` are no-ops on them. */
  readonly selectedRow: number | null;
  readonly selectedCol: number | null;
  readonly notesMode: boolean;
  readonly errorCount: number;
  readonly isComplete: boolean;
  /** Prior snapshots for undo. Capped at 50 entries (FIFO eviction).
   * Nested `undoStack` is always `[]` to prevent exponential nesting. */
  readonly undoStack: readonly SudokuState[];
  /**
   * Player actions recorded for replay so far (#3288, game/sudoku/replay.ts).
   * Set by the screen, saved with the game, so a game resumed after a kill
   * numbers its next entries and recorder units where it left off. Absent on
   * a game from before replay recording.
   */
  readonly entryCount?: number;
  /** Replay rows (events) handed to the recorder so far, bounded by `MAX_REPLAY_ROWS`. */
  readonly replayRows?: number;
  readonly events?: readonly GameEvent[];
}

export const UNDO_STACK_LIMIT = 50;

export type GameEvent =
  | { readonly type: "digitPlace" }
  | { readonly type: "errorEntered" }
  | { readonly type: "unitComplete"; readonly unit: "row" | "col" | "box"; readonly index: number }
  | { readonly type: "puzzleComplete" };
