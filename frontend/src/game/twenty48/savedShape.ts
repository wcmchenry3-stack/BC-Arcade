/**
 * 2048's stored game key and the check of its shape (#4008): kept apart from `storage.ts` so the
 * lobby can check a save without importing the engine.
 */
import type { Twenty48State } from "./types";

export const TWENTY48_GAME_KEY = "twenty48_game_v2";

/** Minimum viability check: only the core fields. Shared by the screen's load and the lobby's read. */
export function isSavedGame(p: unknown): p is Twenty48State {
  const parsed = p as Twenty48State;
  return (
    Array.isArray(parsed.board) && parsed.board.length === 4 && typeof parsed.score === "number"
  );
}
