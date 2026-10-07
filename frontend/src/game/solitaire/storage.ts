/**
 * AsyncStorage persistence for in-progress Solitaire games (#597), through
 * the shared `storageSlot` (#2987).
 *
 * Saves after every state mutation so a crash or backgrounded app doesn't
 * lose progress. One slot per device; no account linkage in V1.
 *
 * `saveGame` strips the nested `undoStack` arrays from each snapshot down
 * to `[]` so the on-disk payload cannot balloon exponentially (a naive
 * serialize would persist every previous state's prior-state chain). The
 * engine already guarantees nested stacks are `[]` at write time — this
 * is defensive belt-and-suspenders.
 *
 * The play clock is saved banked and restarted on load (`clockForSave`,
 * `clockOnLoad`, #2750), so the time the app was closed never counts.
 *
 * `loadGame` enforces `_v: 1` so future schema bumps reject incompatible
 * payloads rather than crashing the screen. Corrupt payloads are deleted
 * and reported as a warning (not an exception) — the caller recovers by
 * starting a fresh game.
 */

import type { SolitaireState } from "./types";
import { clockForSave, clockOnLoad } from "../_shared/playClock";
import { createJsonSlot, createRecord } from "../_shared/storageSlot";

const SUBSYSTEM = "solitaire.storage";

/**
 * The device's cached best, for the result card's best time and "New best"
 * badge only (#2636); the player's history is the Stats screen, fed by the
 * server. Older builds also kept `bestMoves`, `gamesPlayed` and `gamesWon`
 * here: a stored record with them still loads, and the next save drops them.
 */
export interface SolitaireStats {
  bestTimeMs: number;
}

type ParsedSave = { -readonly [K in keyof SolitaireState]?: SolitaireState[K] };

function stripNestedUndo(state: SolitaireState): SolitaireState {
  return {
    ...state,
    undoStack: state.undoStack.map((snapshot) => ({ ...snapshot, undoStack: [] })),
  };
}

function isSavedGame(p: unknown): p is ParsedSave {
  const parsed = p as ParsedSave;
  return !(
    parsed._v !== 1 ||
    (parsed.drawMode !== 1 && parsed.drawMode !== 3) ||
    !Array.isArray(parsed.tableau) ||
    parsed.tableau.length !== 7 ||
    parsed.foundations === null ||
    typeof parsed.foundations !== "object" ||
    !Array.isArray(parsed.stock) ||
    !Array.isArray(parsed.waste) ||
    typeof parsed.score !== "number" ||
    typeof parsed.recycleCount !== "number" ||
    !Array.isArray(parsed.undoStack) ||
    typeof parsed.isComplete !== "boolean"
  );
}

export const {
  save: saveGame,
  load: loadGame,
  clear: clearGame,
} = createJsonSlot<SolitaireState, ParsedSave>({
  key: "solitaire_game",
  subsystem: SUBSYSTEM,
  isValid: isSavedGame,
  onLoad: (parsed) => {
    // Normalize timer fields — absent in saves created before timer tracking was added.
    parsed.startedAt = parsed.startedAt ?? null;
    parsed.accumulatedMs = parsed.accumulatedMs ?? 0;
    const loaded = parsed as SolitaireState;
    return clockOnLoad(loaded, loaded.isComplete);
  },
  beforeSave: (state) => stripNestedUndo(clockForSave(state)),
});

export const { load: loadStats, save: saveStats } = createRecord<SolitaireStats>({
  key: "solitaire_stats_v1",
  subsystem: SUBSYSTEM,
  ops: { load: "loadStats", save: "saveStats" },
  fallback: () => ({ bestTimeMs: 0 }),
  read: (raw) => {
    const parsed = JSON.parse(raw);
    return { bestTimeMs: typeof parsed?.bestTimeMs === "number" ? parsed.bestTimeMs : 0 };
  },
  write: (stats) => JSON.stringify({ bestTimeMs: stats.bestTimeMs }),
});
