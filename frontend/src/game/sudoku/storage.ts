/**
 * AsyncStorage persistence for in-progress Sudoku games (#619, #748).
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
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Sentry from "@sentry/react-native";
import type { Grid, NoteDigit, SudokuCell, SudokuState, Variant } from "./types";

const GAME_KEY = "sudoku_game";

interface SerializedCell {
  value: number;
  given: boolean;
  notes: number[];
  isError: boolean;
}

interface SerializedState {
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
}

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
    grid: restoreGrid(p.grid),
    selectedRow: p.selectedRow,
    selectedCol: p.selectedCol,
    notesMode: p.notesMode,
    errorCount: p.errorCount,
    isComplete: p.isComplete,
  };
}

/** Minimal structural validation — enough to catch truncated payloads
 * and version bumps without pulling in a schema library. */
function looksValid(p: unknown): p is SerializedState {
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

export async function saveGame(state: SudokuState): Promise<void> {
  try {
    await AsyncStorage.setItem(GAME_KEY, JSON.stringify(serializeState(state)));
  } catch (e) {
    Sentry.captureException(e, {
      tags: { subsystem: "sudoku.storage", op: "save" },
    });
  }
}

export async function loadGame(): Promise<SudokuState | null> {
  let raw: string | null = null;
  try {
    raw = await AsyncStorage.getItem(GAME_KEY);
  } catch (e) {
    Sentry.captureException(e, {
      tags: { subsystem: "sudoku.storage", op: "load" },
    });
    return null;
  }
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    Sentry.captureMessage("sudoku.storage: unparseable payload, discarding", {
      level: "warning",
      tags: { subsystem: "sudoku.storage", op: "load" },
    });
    await AsyncStorage.removeItem(GAME_KEY).catch(() => {});
    return null;
  }

  if (!looksValid(parsed)) {
    Sentry.captureMessage("sudoku.storage: invalid payload shape, discarding", {
      level: "warning",
      tags: { subsystem: "sudoku.storage", op: "load" },
    });
    await AsyncStorage.removeItem(GAME_KEY).catch(() => {});
    return null;
  }

  const snapshot = restoreSnapshot(parsed);
  return {
    ...snapshot,
    undoStack: parsed.undoStack.map((snap) => ({
      ...restoreSnapshot(snap),
      undoStack: [] as const,
    })),
  };
}

export async function clearGame(): Promise<void> {
  try {
    await AsyncStorage.removeItem(GAME_KEY);
  } catch (e) {
    Sentry.captureException(e, {
      tags: { subsystem: "sudoku.storage", op: "clear" },
    });
  }
}

// ---------------------------------------------------------------------------
// Stats persistence (#762, #748)
// ---------------------------------------------------------------------------

const STATS_KEY = "sudoku_stats_v1";

/**
 * The device's cached best time for one puzzle kind, for the result card's
 * best time and "New best" badge only (#2636); the player's history is the
 * Stats screen, fed by the server. Older builds also kept `gamesSolved` here:
 * a stored record with it still loads, and the next save drops it.
 */
export interface DifficultyStats {
  bestTimeS: number;
}

export interface VariantStats {
  easy: DifficultyStats;
  medium: DifficultyStats;
  hard: DifficultyStats;
}

export interface SudokuStats {
  classic: VariantStats;
  mini: VariantStats;
}

const EMPTY_VARIANT_STATS: VariantStats = {
  easy: { bestTimeS: 0 },
  medium: { bestTimeS: 0 },
  hard: { bestTimeS: 0 },
};

export const EMPTY_SUDOKU_STATS: SudokuStats = {
  classic: { ...EMPTY_VARIANT_STATS },
  mini: { ...EMPTY_VARIANT_STATS },
};

function parseDiffStats(d: unknown): DifficultyStats {
  if (d === null || typeof d !== "object") return { bestTimeS: 0 };
  const o = d as Partial<DifficultyStats>;
  return { bestTimeS: typeof o.bestTimeS === "number" ? o.bestTimeS : 0 };
}

function parseVariantStats(v: unknown): VariantStats {
  if (v === null || typeof v !== "object") return { ...EMPTY_VARIANT_STATS };
  const o = v as Record<string, unknown>;
  return {
    easy: parseDiffStats(o.easy),
    medium: parseDiffStats(o.medium),
    hard: parseDiffStats(o.hard),
  };
}

export async function loadStats(): Promise<SudokuStats> {
  try {
    const raw = await AsyncStorage.getItem(STATS_KEY);
    if (!raw) return { ...EMPTY_SUDOKU_STATS };
    const parsed = JSON.parse(raw) as Record<string, unknown>;

    // Migration: pre-#748 saves have flat { easy, medium, hard } — wrap as classic.
    if ("classic" in parsed || "mini" in parsed) {
      return {
        classic: parseVariantStats(parsed.classic),
        mini: parseVariantStats(parsed.mini),
      };
    }
    // Old flat format → treat as classic stats.
    return {
      classic: parseVariantStats(parsed),
      mini: { ...EMPTY_VARIANT_STATS },
    };
  } catch (e) {
    Sentry.captureException(e, { tags: { subsystem: "sudoku.storage", op: "loadStats" } });
    return { ...EMPTY_SUDOKU_STATS };
  }
}

export async function saveStats(stats: SudokuStats): Promise<void> {
  try {
    await AsyncStorage.setItem(STATS_KEY, JSON.stringify(stats));
  } catch (e) {
    Sentry.captureException(e, { tags: { subsystem: "sudoku.storage", op: "saveStats" } });
  }
}
