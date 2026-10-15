/**
 * Sudoku replay recording (#3288, epic #3273).
 *
 * The puzzle is recorded once, in `game_started`: `puzzle`, the givens as one
 * digit per cell (81 characters for Classic, 36 for Mini, `0` = empty), next to
 * `difficulty` and `variant`. The player's actions after it are recorded as
 * `entries` events, compactly enough that the givens plus the entries rebuild
 * the final grid. One entry is a short list of numbers
 *
 *     [0, cell, digit]      a digit placed (a 4th number, 1, marks an illegal one)
 *     [1, cell, digit]      a pencil note toggled
 *     [2, cell]             the cell erased (value and notes)
 *     [3]                   undo
 *     [4, cell, digit]      a hint: the solution digit placed
 *
 * with `cell` = `row * size + col`. Selecting a cell, switching pencil mode and
 * actions that change nothing (a digit on a given, an erase of an empty cell,
 * an undo with nothing to undo) are not recorded: they leave the grid alone.
 * The wrong-entry flag repeats what replaying would show (the digit duplicates
 * one in its row, column or box, #2943) and is what the score's error count
 * counts; a hint is never flagged, as it never costs an error.
 *
 * Entries go to the shared GameRecorder (`useGameRecorder`) in chunks of
 * `ENTRIES_PER_CHUNK`: an `entries` event is `{ v, unit, t_ms, i, e }`, with
 * `i` the ordinal of its first entry in the game and `e` the entries. A chunk is
 * one recorder unit, numbered by where it starts (`unitOfEntry`), so a game
 * resumed after a kill carries on from the saved entry count and its units never
 * repeat; `i` makes a hole (a chunk a kill lost) visible to a reader as a gap.
 *
 * Cost → performance → data: building an entry is a few comparisons and one
 * small array; `push` is an in-memory append. No `JSON.stringify`, no storage,
 * no timer. The chunk is handed to the recorder once per `ENTRIES_PER_CHUNK`
 * entries and the recorder measures and saves it at an idle moment, never inside
 * a tap handler. A partial chunk is handed over when the game ends, a new one
 * starts, the player leaves (another screen covers the game, or the app goes to
 * the background: the screen also asks the recorder to hand its units to the queue now; the storage write that follows is async) and on
 * unmount.
 */

import { applyHint, enterDigit, eraseCell, undo } from "./engine";
import type { CellValue, SudokuState } from "./types";
import { variantConfig } from "./types";

/** Entries per `entries` event (and recorder unit). Sized in docs/games/sudoku.md ("Replay recording"). */
export const ENTRIES_PER_CHUNK = 32;

/**
 * Entry codes (the first number of an entry).
 * @internal Exported for tests and offline tooling only; no production caller (knip --production, #3126).
 */
export const OP_DIGIT = 0;
/** @internal Exported for tests and offline tooling only; no production caller (knip --production, #3126). */
export const OP_NOTE = 1;
/** @internal Exported for tests and offline tooling only; no production caller (knip --production, #3126). */
export const OP_ERASE = 2;
/** @internal Exported for tests and offline tooling only; no production caller (knip --production, #3126). */
export const OP_UNDO = 3;
/** @internal Exported for tests and offline tooling only; no production caller (knip --production, #3126). */
export const OP_HINT = 4;

/** One recorded entry; see the file comment for its shapes. */
export type EntryTuple = readonly number[];

/** An action on the number pad that can change the grid. */
export type PadAction =
  | { readonly kind: "digit"; readonly digit: CellValue }
  | { readonly kind: "erase" }
  | { readonly kind: "undo" }
  | { readonly kind: "hint" };

/** The `cell` number of the state's selected cell. Callers have checked one is selected. */
function selectedCell(state: SudokuState): number {
  const { size } = variantConfig(state.variant);
  return (state.selectedRow ?? 0) * size + (state.selectedCol ?? 0);
}

/**
 * The entry for a digit pressed on the number pad that changed the state
 * (`enterDigit` returned a new one): a pencil note in notes mode, else a digit,
 * flagged when it cost an error.
 */
function digitEntry(before: SudokuState, after: SudokuState, digit: CellValue): EntryTuple {
  const cell = selectedCell(before);
  if (before.notesMode) return [OP_NOTE, cell, digit];
  return after.errorCount > before.errorCount
    ? [OP_DIGIT, cell, digit, 1]
    : [OP_DIGIT, cell, digit];
}

/**
 * The entry for a hint that changed the state: the cell it filled (the hint
 * selects the cell it corrects on a full-but-wrong grid) and the digit now there.
 */
function hintEntry(after: SudokuState): EntryTuple {
  const row = after.selectedRow ?? 0;
  const col = after.selectedCol ?? 0;
  const { size } = variantConfig(after.variant);
  return [OP_HINT, row * size + col, after.grid[row]?.[col]?.value ?? 0];
}

/**
 * Apply a number-pad action with the engine and say what to record: the next
 * state and its entry, or null when the action changed nothing (nothing
 * selected, a given, an empty cell to erase, an empty undo stack, no hint to
 * give) — the engine then returns the same state and nothing is recorded.
 * The screen and the golden test both go through here, so what is recorded is
 * what the engine did.
 */
export function applyRecorded(
  state: SudokuState,
  action: PadAction
): { readonly next: SudokuState; readonly entry: EntryTuple } | null {
  switch (action.kind) {
    case "digit": {
      const next = enterDigit(state, action.digit);
      return next === state ? null : { next, entry: digitEntry(state, next, action.digit) };
    }
    case "erase": {
      const next = eraseCell(state);
      return next === state ? null : { next, entry: [OP_ERASE, selectedCell(state)] };
    }
    case "undo": {
      const next = undo(state);
      return next === state ? null : { next, entry: [OP_UNDO] };
    }
    case "hint": {
      const next = applyHint(state);
      return next === state ? null : { next, entry: hintEntry(next) };
    }
  }
}

/** The recorder unit a chunk starting at entry `first` is saved under: chunk 1, 2, ... */
export function unitOfEntry(first: number, size: number = ENTRIES_PER_CHUNK): number {
  return Math.floor(first / size) + 1;
}

/** Collects entries and hands them over a chunk at a time. */
export interface EntryLog {
  /** Add one entry; hands the chunk over when it reaches a chunk boundary. */
  push(entry: EntryTuple): void;
  /** Hand over what is collected, if anything. */
  flush(): void;
  /** Entries pushed so far in the game (the ordinal the next one gets). */
  readonly count: number;
  /** Start counting from `count` entries already in the game (0 for a new game). Drops what is collected. */
  reset(count?: number): void;
}

/**
 * An entry log. `emit(first, entries)` receives each chunk as a fresh array the
 * log never touches again (the recorder takes `data` by ownership), with
 * `first` the ordinal of its first entry. Chunks end at multiples of `size`, so
 * a chunk saved early by `flush` is finished by the next one under the same unit.
 */
export function createEntryLog(
  emit: (first: number, entries: EntryTuple[]) => void,
  size: number = ENTRIES_PER_CHUNK
): EntryLog {
  let first = 0;
  let chunk: EntryTuple[] = [];
  const flush = (): void => {
    if (chunk.length === 0) return;
    const out = chunk;
    const at = first;
    chunk = [];
    first += out.length;
    emit(at, out);
  };
  return {
    get count() {
      return first + chunk.length;
    },
    push(entry) {
      chunk.push(entry);
      if ((first + chunk.length) % size === 0) flush();
    },
    flush,
    reset(count = 0) {
      chunk = [];
      first = count;
    },
  };
}
