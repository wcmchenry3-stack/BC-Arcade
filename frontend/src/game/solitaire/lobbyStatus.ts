/**
 * Solitaire's lobby tile status (#4008): a game to resume, else the best (fastest) time.
 *
 * The screen always reopens a stored game; the tile offers "Resume" only for one with a move made
 * (an undo step or a score) that is not complete.
 */
import { peekBestStatus, pickStatus, readSavedGame, type TileStatus } from "../_shared/lobbyStatus";
import { isSavedGame, SOLITAIRE_GAME_KEY } from "./storage";
import type { SolitaireState } from "./types";

export function isResumable(
  state: Pick<SolitaireState, "isComplete" | "score" | "undoStack"> | null
): boolean {
  return !!state && !state.isComplete && (state.undoStack.length > 0 || state.score > 0);
}

export async function getLobbyStatus(): Promise<TileStatus | undefined> {
  const [saved, best] = await Promise.all([
    readSavedGame(SOLITAIRE_GAME_KEY, isSavedGame),
    peekBestStatus("solitaire", "time"),
  ]);
  return pickStatus([
    isResumable(saved as SolitaireState | null) ? { kind: "resume" } : undefined,
    best,
  ]);
}
