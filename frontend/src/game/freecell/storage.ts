import type { FreeCellState } from "./types";
import type { PlayClock } from "../_shared/playClock";
import { createJsonSlot, createRecord } from "../_shared/storageSlot";

const SUBSYSTEM = "freecell.storage";

/**
 * The fewest moves in a win on this device, for the "new best" badge. The play and win counters
 * this record once held were never shown (the Stats screen reads the server, #2636): they are
 * dropped on the next save, as Solitaire's and Sudoku's were.
 */
export interface FreeCellStats {
  bestMoves: number;
}

function stripNestedUndo(state: FreeCellState): FreeCellState {
  return {
    ...state,
    // A snapshot's clock is never restored (an undo keeps the running clock, #3607).
    undoStack: state.undoStack.map(({ clock: _clock, ...snapshot }) => ({
      ...snapshot,
      undoStack: [],
    })),
  };
}

/** A well-formed play clock (#3607): a number or null start, a finite banked time. */
function isPlayClock(c: unknown): c is PlayClock {
  if (c === null || typeof c !== "object") return false;
  const { startedAt, accumulatedMs, paused } = c as Record<string, unknown>;
  return (
    (startedAt === null || (typeof startedAt === "number" && Number.isFinite(startedAt))) &&
    typeof accumulatedMs === "number" &&
    Number.isFinite(accumulatedMs) &&
    (paused === undefined || typeof paused === "boolean")
  );
}

/**
 * A saved game with a malformed `clock` loads without it, as "not started", rather
 * than as a corrupt save: the clock is only the stat line's TIME (#3607). A negative
 * banked time (a device clock set back) is clamped to 0 and the clock kept.
 */
function dropBadClock(parsed: unknown): unknown {
  if (parsed === null || typeof parsed !== "object" || !("clock" in parsed)) return parsed;
  const { clock, ...rest } = parsed as Record<string, unknown>;
  if (!isPlayClock(clock)) return rest;
  return clock.accumulatedMs < 0 ? { ...rest, clock: { ...clock, accumulatedMs: 0 } } : parsed;
}

function isSavedGame(p: unknown): p is FreeCellState {
  const parsed = p as Partial<FreeCellState>;
  return !(
    parsed._v !== 1 ||
    !Array.isArray(parsed.tableau) ||
    parsed.tableau.length !== 8 ||
    parsed.foundations === null ||
    typeof parsed.foundations !== "object" ||
    !Array.isArray(parsed.freeCells) ||
    parsed.freeCells.length !== 4 ||
    !Array.isArray(parsed.undoStack) ||
    typeof parsed.isComplete !== "boolean" ||
    typeof parsed.moveCount !== "number"
  );
}

export const {
  save: saveGame,
  load: loadGame,
  clear: clearGame,
} = createJsonSlot<FreeCellState>({
  key: "freecell_game",
  subsystem: SUBSYSTEM,
  isValid: isSavedGame,
  migrate: dropBadClock,
  beforeSave: stripNestedUndo,
});

export const { load: loadStats, save: saveStats } = createRecord<FreeCellStats>({
  key: "freecell_stats_v1",
  subsystem: SUBSYSTEM,
  ops: { load: "loadStats", save: "saveStats" },
  fallback: () => ({ bestMoves: 0 }),
  read: (raw) => {
    const parsed = JSON.parse(raw);
    return {
      bestMoves: typeof parsed.bestMoves === "number" ? parsed.bestMoves : 0,
    };
  },
  write: (stats) => JSON.stringify(stats),
});
