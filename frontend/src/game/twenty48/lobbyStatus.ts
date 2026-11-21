/**
 * 2048's lobby tile status (#4008): a game to resume, else the personal best.
 *
 * The screen always reopens a stored game; the tile offers "Resume" only for one still being
 * played. A game that has not moved yet (a fresh deal is saved at once) or is over is not "in
 * progress". A first move that merges nothing scores 0, so it shows no Resume until the first merge.
 */
import { getBest } from "../_shared/personalBest";
import { bestStatus, pickStatus, readSavedGame, type TileStatus } from "../_shared/lobbyStatus";
import { isSavedGame, TWENTY48_GAME_KEY } from "./savedShape";
import type { Twenty48State } from "./types";

export function isResumable(state: Twenty48State | null): boolean {
  return !!state && !state.game_over && (state.score > 0 || (state.recordedMoves ?? 0) > 0);
}

export async function getLobbyStatus(): Promise<TileStatus | undefined> {
  const [saved, best] = await Promise.all([
    readSavedGame(TWENTY48_GAME_KEY, isSavedGame),
    getBest("twenty48"),
  ]);
  return pickStatus([
    isResumable(saved) ? { kind: "resume" } : undefined,
    bestStatus(best, "score"),
  ]);
}
