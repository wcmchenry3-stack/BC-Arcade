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
 * One-shot `events` are never persisted, and are dropped from older saves on
 * load, so a restore does not replay the last move's sound (#3093).
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
import { createJsonSlot } from "../_shared/storageSlot";

const SUBSYSTEM = "solitaire.storage";

type ParsedSave = { -readonly [K in keyof SolitaireState]?: SolitaireState[K] };

function stripNestedUndo(state: SolitaireState): SolitaireState {
  return {
    ...state,
    undoStack: state.undoStack.map((snapshot) => ({ ...snapshot, undoStack: [] })),
  };
}

/**
 * `state` without its one-shot `events`: a save holds the game only, so a
 * restore never replays the last move's sound (#3093).
 */
function withoutEvents(state: SolitaireState): SolitaireState {
  if (!("events" in state)) return state;
  const { events: _events, ...game } = state;
  return game;
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
    // Saves written before #3093 still carry the last move's events.
    const loaded = withoutEvents(parsed as SolitaireState);
    return clockOnLoad(loaded, loaded.isComplete);
  },
  beforeSave: (state) => stripNestedUndo(clockForSave(withoutEvents(state))),
});

// The device's best time, for the result card's best time and "New best" badge, is the shared
// personal best (`game/_shared/personalBest.ts`, #3757); its old record `solitaire_stats_v1` is
// moved in there on the first read.
