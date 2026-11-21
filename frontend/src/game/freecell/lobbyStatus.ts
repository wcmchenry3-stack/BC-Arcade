/**
 * FreeCell's lobby tile status (#4008): a game to resume, else the best (fewest) moves.
 *
 * The screen always reopens a stored game; the tile offers "Resume" only for one with a move made
 * that is not complete.
 */
import { getBest } from "../_shared/personalBest";
import { bestStatus, pickStatus, readSavedGame, type TileStatus } from "../_shared/lobbyStatus";
import { FREECELL_GAME_KEY, isSavedGame } from "./storage";
import type { FreeCellState } from "./types";

export function isResumable(
  state: Pick<FreeCellState, "isComplete" | "moveCount"> | null
): boolean {
  return !!state && !state.isComplete && state.moveCount > 0;
}

export async function getLobbyStatus(): Promise<TileStatus | undefined> {
  const [saved, best] = await Promise.all([
    readSavedGame(FREECELL_GAME_KEY, isSavedGame),
    getBest("freecell"),
  ]);
  return pickStatus([
    isResumable(saved) ? { kind: "resume" } : undefined,
    bestStatus(best, "moves"),
  ]);
}
