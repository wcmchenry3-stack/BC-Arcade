/**
 * Sudoku engine (#616, #748) — pure functions over an immutable `SudokuState`.
 *
 * Supports both the classic 9×9 variant and the mini 6×6 variant.
 * All size-dependent logic is parameterised via `GridConfig`.
 *
 * No React, no AsyncStorage, no side effects. The UI and persistence
 * layers consume the returned state verbatim.
 */

import { PACKED_CLASSIC_BANK, PACKED_MINI_BANK } from "./puzzleBanks.generated";
import { decodePuzzles } from "./puzzleCodec";
import type {
  CellValue,
  Difficulty,
  GameEvent,
  Grid,
  GridConfig,
  NoteDigit,
  SudokuCell,
  SudokuState,
  Variant,
} from "./types";
import { CLASSIC_CONFIG, MINI_CONFIG, UNDO_STACK_LIMIT, variantConfig } from "./types";

// ---------------------------------------------------------------------------
// Solver — backtracking with candidate bitmasks
// ---------------------------------------------------------------------------

/** Bitmask of digits available for cell `i` given its peers. */
function peerMask(grid: Int8Array, i: number, cfg: GridConfig): number {
  const { size, boxRows, boxCols } = cfg;
  const r = Math.floor(i / size);
  const c = i % size;
  const br = Math.floor(r / boxRows) * boxRows;
  const bc = Math.floor(c / boxCols) * boxCols;
  let used = 0;
  for (let k = 0; k < size; k++) {
    const rowCell = grid[r * size + k];
    if (rowCell) used |= 1 << (rowCell - 1);
    const colCell = grid[k * size + c];
    if (colCell) used |= 1 << (colCell - 1);
  }
  for (let rr = 0; rr < boxRows; rr++) {
    for (let cc = 0; cc < boxCols; cc++) {
      const v = grid[(br + rr) * size + (bc + cc)];
      if (v) used |= 1 << (v - 1);
    }
  }
  const full = (1 << size) - 1;
  return ~used & full;
}

/** MRV: return index of empty cell with fewest candidates, or -1 if full. */
function pickEmpty(grid: Int8Array, cfg: GridConfig): { i: number; mask: number } {
  const total = cfg.size * cfg.size;
  let bestI = -1;
  let bestMask = 0;
  let bestCount = cfg.size + 1;
  for (let i = 0; i < total; i++) {
    if (grid[i] === 0) {
      const m = peerMask(grid, i, cfg);
      const count = popcount(m);
      if (count < bestCount) {
        bestCount = count;
        bestI = i;
        bestMask = m;
        if (count <= 1) break;
      }
    }
  }
  return { i: bestI, mask: bestMask };
}

function popcount(n: number): number {
  let c = n;
  c = c - ((c >> 1) & 0x55555555);
  c = (c & 0x33333333) + ((c >> 2) & 0x33333333);
  return (((c + (c >> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

/** Solve `puzzle` (N²-char string, '0' for empty) and return the solved
 * N²-char string, or null if the puzzle has no solution.
 * Size is inferred from puzzle.length (must be a perfect square). */
export function solvePuzzle(puzzle: string): string | null {
  const total = puzzle.length;
  const size = Math.round(Math.sqrt(total));
  if (size * size !== total) return null;
  const cfg: GridConfig =
    size === 9 ? CLASSIC_CONFIG : size === 6 ? MINI_CONFIG : { size, boxRows: 3, boxCols: 3 };

  const grid = new Int8Array(total);
  for (let i = 0; i < total; i++) {
    const ch = puzzle.charCodeAt(i) - 48;
    if (ch < 0 || ch > size) return null;
    grid[i] = ch;
  }

  // Validate givens before backtracking to avoid exponential futility.
  for (let i = 0; i < total; i++) {
    const v = grid[i];
    if (!v) continue;
    grid[i] = 0;
    const mask = peerMask(grid, i, cfg);
    grid[i] = v;
    if ((mask & (1 << (v - 1))) === 0) return null;
  }

  const recurse = (): boolean => {
    const { i, mask } = pickEmpty(grid, cfg);
    if (i === -1) return true;
    if (mask === 0) return false;
    let m = mask;
    while (m) {
      const lsb = m & -m;
      m ^= lsb;
      const d = Math.log2(lsb) + 1;
      grid[i] = d;
      if (recurse()) return true;
      grid[i] = 0;
    }
    return false;
  };

  if (!recurse()) return null;
  let out = "";
  for (let i = 0; i < total; i++) out += grid[i];
  return out;
}

// ---------------------------------------------------------------------------
// Grid construction
// ---------------------------------------------------------------------------

function makeCell(value: CellValue, given: boolean): SudokuCell {
  return {
    value,
    given,
    notes: new Set<NoteDigit>(),
    isError: false,
  };
}

function buildGrid(puzzle: string, cfg: GridConfig): Grid {
  const { size } = cfg;
  const rows: SudokuCell[][] = [];
  for (let r = 0; r < size; r++) {
    const row: SudokuCell[] = [];
    for (let c = 0; c < size; c++) {
      const ch = puzzle.charCodeAt(r * size + c) - 48;
      const v = (ch >= 0 && ch <= size ? ch : 0) as CellValue;
      row.push(makeCell(v, v !== 0));
    }
    rows.push(row);
  }
  return rows;
}

function cellAt(grid: Grid, row: number, col: number): SudokuCell {
  const r = grid[row];
  if (!r) throw new Error(`row out of range: ${row}`);
  const cell = r[col];
  if (!cell) throw new Error(`col out of range: ${col}`);
  return cell;
}

function replaceCell(
  grid: Grid,
  row: number,
  col: number,
  updater: (cell: SudokuCell) => SudokuCell
): Grid {
  return grid.map((r, ri) =>
    ri === row ? r.map((cell, ci) => (ci === col ? updater(cell) : cell)) : r
  );
}

/** Apply `updater` to every cell — used when peer notes need clearing. */
function mapGrid(
  grid: Grid,
  updater: (cell: SudokuCell, row: number, col: number) => SudokuCell
): Grid {
  return grid.map((r, ri) => r.map((cell, ci) => updater(cell, ri, ci)));
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

// The banks ship packed (see puzzleCodec.ts, #2869). Each difficulty is
// unpacked the first time a game asks for it, once per app session.
const pools = new Map<string, readonly string[]>();

function poolFor(variant: Variant, difficulty: Difficulty): readonly string[] | undefined {
  const key = `${variant}/${difficulty}`;
  let pool = pools.get(key);
  if (!pool) {
    const packed = (variant === "mini" ? PACKED_MINI_BANK : PACKED_CLASSIC_BANK)[difficulty];
    if (packed === undefined) return undefined;
    const { size } = variantConfig(variant);
    pool = decodePuzzles(packed, size * size);
    pools.set(key, pool);
  }
  return pool;
}

/** Pick a random puzzle of the given difficulty/variant and build fresh state. */
export function loadPuzzle(
  difficulty: Difficulty,
  variant: Variant = "classic",
  rng: () => number = Math.random
): SudokuState {
  const pool = poolFor(variant, difficulty);
  if (!pool || pool.length === 0) {
    throw new Error(`No puzzles available for ${variant}/${difficulty}`);
  }
  const idx = Math.floor(rng() * pool.length);
  const puzzle = pool[idx];
  if (!puzzle) throw new Error(`puzzle index ${idx} missing`);
  const solution = solvePuzzle(puzzle);
  if (!solution) {
    throw new Error(`Unsolvable puzzle in bank at ${variant}/${difficulty}[${idx}]`);
  }
  return {
    _v: 1,
    variant,
    difficulty,
    puzzle,
    solution,
    grid: buildGrid(puzzle, variantConfig(variant)),
    selectedRow: null,
    selectedCol: null,
    notesMode: false,
    errorCount: 0,
    isComplete: false,
    undoStack: [],
  };
}

/** Select a cell. Selecting the already-selected cell deselects it. */
export function selectCell(state: SudokuState, row: number, col: number): SudokuState {
  if (state.selectedRow === row && state.selectedCol === col) {
    return { ...state, selectedRow: null, selectedCol: null };
  }
  return { ...state, selectedRow: row, selectedCol: col };
}

export function toggleNotesMode(state: SudokuState): SudokuState {
  return { ...state, notesMode: !state.notesMode };
}

function pushUndo(state: SudokuState): readonly SudokuState[] {
  const snapshot: SudokuState = { ...state, undoStack: [], events: undefined };
  const next = [...state.undoStack, snapshot];
  return next.length > UNDO_STACK_LIMIT ? next.slice(next.length - UNDO_STACK_LIMIT) : next;
}

function isGridComplete(grid: Grid, solution: string): boolean {
  const size = grid.length;
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const cell = cellAt(grid, r, c);
      if (cell.value === 0) return false;
      const expected = solution.charCodeAt(r * size + c) - 48;
      if (cell.value !== expected) return false;
    }
  }
  return true;
}

/**
 * Alias exported so tests (and downstream UI) can ask the question
 * without reaching into the `state.isComplete` field directly.
 * @internal Exported for tests and offline tooling only; no production caller (knip --production, #3126).
 */
export function isComplete(grid: Grid, solution: string): boolean {
  return isGridComplete(grid, solution);
}

/** Whether the cell holds the solution's digit. Givens always do. */
function isSolved(grid: Grid, solution: string, row: number, col: number): boolean {
  const size = grid.length;
  const cell = grid[row]?.[col];
  return !!cell && cell.value !== 0 && cell.value === solution.charCodeAt(row * size + col) - 48;
}

/**
 * A row, column or box counts as complete only when every cell holds the
 * solution's digit (#3785): a full unit with a wrong digit is not complete,
 * even when it has no duplicates.
 */
function isRowComplete(grid: Grid, solution: string, row: number): boolean {
  for (let c = 0; c < grid.length; c++) if (!isSolved(grid, solution, row, c)) return false;
  return true;
}

function isColComplete(grid: Grid, solution: string, col: number): boolean {
  for (let r = 0; r < grid.length; r++) if (!isSolved(grid, solution, r, col)) return false;
  return true;
}

function isBoxComplete(
  grid: Grid,
  solution: string,
  boxRow: number,
  boxCol: number,
  boxRows: number,
  boxCols: number
): boolean {
  for (let r = 0; r < boxRows; r++) {
    for (let c = 0; c < boxCols; c++) {
      if (!isSolved(grid, solution, boxRow + r, boxCol + c)) return false;
    }
  }
  return true;
}

/** Enter a digit into the selected cell.
 *
 * Normal mode (`notesMode === false`):
 *   - Sets `cell.value = digit`
 *   - Clears the cell's pencil notes and removes `digit` from the notes of its
 *     row, column and box peers (#3785; a hint does the same)
 *   - A digit that duplicates one in its row, column or box (an illegal
 *     move) increments `errorCount` and emits `errorEntered`. A legal digit
 *     that merely disagrees with the solution is NOT an error (#2943): no
 *     count, no event. `isError` on every cell is then recomputed from the
 *     board (`recomputeConflicts`), so it tracks the current duplicates
 *   - Pushes the previous state to the undo stack (capped at
 *     UNDO_STACK_LIMIT)
 *   - Checks for completion
 *   - A digit the cell already holds changes nothing (#3773): the same state
 *     comes back, so no error, undo step, replay entry or event
 *
 * Notes mode (`notesMode === true`):
 *   - Toggles the digit in the cell's notes set (never touches other cells)
 *   - Does NOT affect `cell.value`, `errorCount`, or completion
 *   - Does NOT push to the undo stack
 *
 * No-op when nothing is selected or the selected cell is a given. */
export function enterDigit(state: SudokuState, digit: CellValue): SudokuState {
  if (state.selectedRow === null || state.selectedCol === null) return state;
  const row = state.selectedRow;
  const col = state.selectedCol;
  const cell = cellAt(state.grid, row, col);
  if (cell.given) return state;
  if (digit === 0) return state;

  if (state.notesMode) {
    const d = digit as NoteDigit;
    const nextNotes = new Set(cell.notes);
    if (nextNotes.has(d)) nextNotes.delete(d);
    else nextNotes.add(d);
    // Notes mode never touches another cell's notes (#3785).
    return {
      ...state,
      grid: replaceCell(state.grid, row, col, (c) => ({ ...c, notes: nextNotes })),
    };
  }

  // Normal mode. A cell that already holds this digit stays as it is (#3773): a repeat tap
  // costs no error, undo step, replay entry or event.
  if (cell.value === digit) return state;
  return placeDigit(state, row, col, digit, true);
}

/**
 * Put `digit` in (`row`, `col`) and work out the consequences. `countErrors`
 * is false for a hint, whose solution digit must never cost the player a
 * penalty even when a wrong peer makes it a duplicate.
 */
function placeDigit(
  state: SudokuState,
  row: number,
  col: number,
  digit: CellValue,
  countErrors: boolean
): SudokuState {
  const cfg = variantConfig(state.variant);
  const size = cfg.size;
  const undoStack = pushUndo(state);
  // Illegal = the digit already stands in the cell's row, column or box.
  const illegal = getConflicts(state.grid, row, col, digit, cfg).length > 0;
  // The digit leaves the notes of its row, column and box peers (#3785); the
  // undo snapshot above holds them, so undo brings them back.
  const placed = mapGrid(state.grid, (c, ri, ci) => {
    if (ri === row && ci === col) return { ...c, value: digit, notes: new Set<NoteDigit>() };
    if (!c.notes.has(digit as NoteDigit) || !peers(row, col, ri, ci, cfg)) return c;
    const trimmed = new Set(c.notes);
    trimmed.delete(digit as NoteDigit);
    return { ...c, notes: trimmed };
  });
  const nextGrid = recomputeConflicts(placed, cfg);
  const countsAsError = illegal && countErrors;
  const nextErrorCount = countsAsError ? state.errorCount + 1 : state.errorCount;
  const complete = isGridComplete(nextGrid, state.solution);

  const events: GameEvent[] = [{ type: "digitPlace" }];
  if (countsAsError) {
    events.push({ type: "errorEntered" });
  } else if (!illegal) {
    const { boxRows, boxCols } = cfg;
    if (isRowComplete(nextGrid, state.solution, row))
      events.push({ type: "unitComplete", unit: "row", index: row });
    if (isColComplete(nextGrid, state.solution, col))
      events.push({ type: "unitComplete", unit: "col", index: col });
    const boxRow = Math.floor(row / boxRows) * boxRows;
    const boxCol = Math.floor(col / boxCols) * boxCols;
    if (isBoxComplete(nextGrid, state.solution, boxRow, boxCol, boxRows, boxCols))
      events.push({ type: "unitComplete", unit: "box", index: boxRow * size + boxCol });
  }
  if (complete) events.push({ type: "puzzleComplete" });

  return {
    ...state,
    grid: nextGrid,
    errorCount: nextErrorCount,
    isComplete: complete,
    undoStack,
    events,
  };
}

/**
 * Whether every cell is filled but the grid is not the solution (#2943):
 * with legal-but-wrong digits no longer flagged, this is how the player
 * learns something is off.
 */
export function isFullButWrong(state: SudokuState): boolean {
  if (state.isComplete) return false;
  return state.grid.every((row) => row.every((c) => c.value !== 0));
}

/**
 * The Hint action. On a selected empty cell it fills in the solution digit.
 * On a full-but-wrong grid (nothing is empty) it picks a wrong cell (the
 * selected one if it is wrong, else the first), selects it and corrects it.
 * Returns the same state when there is nothing to do. Never costs an error.
 */
export function applyHint(state: SudokuState): SudokuState {
  const { size } = variantConfig(state.variant);
  const solutionAt = (r: number, c: number) =>
    (state.solution.charCodeAt(r * size + c) - 48) as CellValue;
  const { selectedRow, selectedCol } = state;
  if (selectedRow !== null && selectedCol !== null) {
    const sel = cellAt(state.grid, selectedRow, selectedCol);
    if (!sel.given && sel.value === 0) {
      return placeDigit(
        state,
        selectedRow,
        selectedCol,
        solutionAt(selectedRow, selectedCol),
        false
      );
    }
  }
  if (!isFullButWrong(state)) return state;
  const isWrong = (r: number, c: number) => {
    const cell = cellAt(state.grid, r, c);
    return !cell.given && cell.value !== solutionAt(r, c);
  };
  let target: [number, number] | null = null;
  if (selectedRow !== null && selectedCol !== null && isWrong(selectedRow, selectedCol)) {
    target = [selectedRow, selectedCol];
  }
  for (let r = 0; r < size && !target; r++) {
    for (let c = 0; c < size && !target; c++) if (isWrong(r, c)) target = [r, c];
  }
  if (!target) return state;
  const [tr, tc] = target;
  return {
    ...placeDigit(state, tr, tc, solutionAt(tr, tc), false),
    selectedRow: tr,
    selectedCol: tc,
  };
}

/** Clear the value AND notes of the selected cell. No-op on given cells
 * or when nothing is selected. Pushes to the undo stack. */
export function eraseCell(state: SudokuState): SudokuState {
  if (state.selectedRow === null || state.selectedCol === null) return state;
  const row = state.selectedRow;
  const col = state.selectedCol;
  const cell = cellAt(state.grid, row, col);
  if (cell.given) return state;
  if (cell.value === 0 && cell.notes.size === 0) return state;
  const undoStack = pushUndo(state);
  const nextGrid = recomputeConflicts(
    replaceCell(state.grid, row, col, (c) => ({
      ...c,
      value: 0,
      notes: new Set<NoteDigit>(),
      isError: false,
    })),
    variantConfig(state.variant)
  );
  return {
    ...state,
    grid: nextGrid,
    isComplete: false,
    undoStack,
  };
}

/**
 * Pop the most recent undo snapshot. Returns the current state if the stack is
 * empty. Undo restores the board only (#3785): digits, notes, error count,
 * conflicts and completion. The Notes mode and the selection stay as they are,
 * except that the cell the undone action changed becomes selected, so the
 * player sees what changed. That cell is the first one whose value differs from
 * the snapshot, else the first whose notes differ (an erase of a notes-only
 * cell); with no difference the selection stays. The popped snapshot is
 * re-threaded with the caller's now-shortened history so subsequent undos
 * continue walking backwards.
 */
export function undo(state: SudokuState): SudokuState {
  if (state.undoStack.length === 0) return state;
  const prev = state.undoStack[state.undoStack.length - 1];
  if (!prev) return state;
  let byValue: [number, number] | null = null;
  let byNotes: [number, number] | null = null;
  prev.grid.forEach((row, r) =>
    row.forEach((cell, c) => {
      const now = cellAt(state.grid, r, c);
      if (!byValue && cell.value !== now.value) byValue = [r, c];
      if (!byNotes && !sameNotes(cell.notes, now.notes)) byNotes = [r, c];
    })
  );
  // Notes-only changes: prefer the cell the undone action was taken on (the snapshot's selection),
  // since a later note toggle (which pushes no snapshot) can also differ in an earlier cell.
  const actedOn: [number, number] | null =
    prev.selectedRow !== null &&
    prev.selectedCol !== null &&
    !sameNotes(
      cellAt(prev.grid, prev.selectedRow, prev.selectedCol).notes,
      cellAt(state.grid, prev.selectedRow, prev.selectedCol).notes
    )
      ? [prev.selectedRow, prev.selectedCol]
      : null;
  const changed: [number, number] | null = byValue ?? actedOn ?? byNotes;
  return {
    ...prev,
    notesMode: state.notesMode,
    selectedRow: changed ? changed[0] : state.selectedRow,
    selectedCol: changed ? changed[1] : state.selectedCol,
    undoStack: state.undoStack.slice(0, -1),
  };
}

function sameNotes(a: ReadonlySet<NoteDigit>, b: ReadonlySet<NoteDigit>): boolean {
  if (a.size !== b.size) return false;
  for (const d of a) if (!b.has(d)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Helpers for UI / error flash
// ---------------------------------------------------------------------------

export function peers(r1: number, c1: number, r2: number, c2: number, cfg: GridConfig): boolean {
  if (r1 === r2 && c1 === c2) return false;
  if (r1 === r2 || c1 === c2) return true;
  return (
    Math.floor(r1 / cfg.boxRows) === Math.floor(r2 / cfg.boxRows) &&
    Math.floor(c1 / cfg.boxCols) === Math.floor(c2 / cfg.boxCols)
  );
}

/**
 * Return the coordinates of all cells that already hold `value` in the
 * same row, column, or box as (`row`, `col`). Pure conflict-detection
 * helper (exercised by the engine test suite).
 */
export function getConflicts(
  grid: Grid,
  row: number,
  col: number,
  value: number,
  cfg: GridConfig = CLASSIC_CONFIG
): Array<[number, number]> {
  const { size } = cfg;
  if (value < 1 || value > size) return [];
  const out: Array<[number, number]> = [];
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (r === row && c === col) continue;
      if (!peers(row, col, r, c, cfg)) continue;
      const cell = cellAt(grid, r, c);
      if (cell.value === value) out.push([r, c]);
    }
  }
  return out;
}

/**
 * Set `isError` on every non-given filled cell that duplicates a digit in its
 * row, column or box (#2943). `isError` means "currently illegal", so it is
 * derived from the board: it follows a peer being erased or changed, and old
 * saves (whose flags meant "differs from the solution") are normalised on load.
 * Returns the same grid when no flag changes.
 */
export function recomputeConflicts(grid: Grid, cfg: GridConfig): Grid {
  let changed = false;
  const next = mapGrid(grid, (cell, r, c) => {
    const isError =
      !cell.given && cell.value !== 0 && getConflicts(grid, r, c, cell.value, cfg).length > 0;
    if (isError === cell.isError) return cell;
    changed = true;
    return { ...cell, isError };
  });
  return changed ? next : grid;
}
