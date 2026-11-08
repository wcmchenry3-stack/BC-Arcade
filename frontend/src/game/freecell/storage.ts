import type { FreeCellState } from "./types";
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
