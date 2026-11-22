/**
 * What a stored Sudoku game looks like, and its key (#4008): kept apart from `storage.ts` so the
 * lobby can check a save without importing the engine and its puzzle banks.
 */

export const SUDOKU_GAME_KEY = "sudoku_game";

export interface SerializedCell {
  value: number;
  given: boolean;
  notes: number[];
  isError: boolean;
}

export interface SerializedState {
  _v: 1;
  variant?: string;
  difficulty: string;
  puzzle: string;
  solution: string;
  grid: SerializedCell[][];
  selectedRow: number | null;
  selectedCol: number | null;
  notesMode: boolean;
  errorCount: number;
  isComplete: boolean;
  undoStack: Array<Omit<SerializedState, "undoStack"> & { undoStack: [] }>;
  /** Replay entries recorded so far (#3288); absent on older saves. */
  entryCount?: number;
  replayRows?: number;
}

/** Minimal structural validation — enough to catch truncated payloads
 * and version bumps without pulling in a schema library. */
export function looksValid(p: unknown): p is SerializedState {
  if (p === null || typeof p !== "object") return false;
  const o = p as Partial<SerializedState>;
  if (o._v !== 1) return false;
  if (o.difficulty !== "easy" && o.difficulty !== "medium" && o.difficulty !== "hard") {
    return false;
  }
  const variant = o.variant ?? "classic";
  if (variant !== "classic" && variant !== "mini") return false;
  const size = variant === "mini" ? 6 : 9;
  const total = size * size;
  if (typeof o.puzzle !== "string" || o.puzzle.length !== total) return false;
  if (typeof o.solution !== "string" || o.solution.length !== total) return false;
  if (!Array.isArray(o.grid) || o.grid.length !== size) return false;
  for (const row of o.grid) {
    if (!Array.isArray(row) || row.length !== size) return false;
    for (const cell of row) {
      if (cell === null || typeof cell !== "object") return false;
      if (typeof (cell as SerializedCell).value !== "number") return false;
      if (typeof (cell as SerializedCell).given !== "boolean") return false;
      if (!Array.isArray((cell as SerializedCell).notes)) return false;
      if (typeof (cell as SerializedCell).isError !== "boolean") return false;
    }
  }
  if (typeof o.notesMode !== "boolean") return false;
  if (typeof o.errorCount !== "number") return false;
  if (typeof o.isComplete !== "boolean") return false;
  if (!Array.isArray(o.undoStack)) return false;
  return true;
}
