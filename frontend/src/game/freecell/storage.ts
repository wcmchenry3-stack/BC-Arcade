import type { FreeCellState } from "./types";
import { createJsonSlot, createRecord } from "../_shared/storageSlot";

const SUBSYSTEM = "freecell.storage";

export interface FreeCellStats {
  bestMoves: number;
  gamesPlayed: number;
  gamesWon: number;
}

function stripNestedUndo(state: FreeCellState): FreeCellState {
  return {
    ...state,
    undoStack: state.undoStack.map((snapshot) => ({ ...snapshot, undoStack: [] })),
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
  fallback: () => ({ bestMoves: 0, gamesPlayed: 0, gamesWon: 0 }),
  read: (raw) => {
    const parsed = JSON.parse(raw);
    return {
      bestMoves: typeof parsed.bestMoves === "number" ? parsed.bestMoves : 0,
      gamesPlayed: typeof parsed.gamesPlayed === "number" ? parsed.gamesPlayed : 0,
      gamesWon: typeof parsed.gamesWon === "number" ? parsed.gamesWon : 0,
    };
  },
  write: (stats) => JSON.stringify(stats),
});
