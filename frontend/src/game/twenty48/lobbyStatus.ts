/**
 * 2048's lobby tile status (#4008): a game to resume, else the personal best.
 *
 * The screen always reopens a stored game; the tile offers "Resume" only for one still being
 * played: not over, and with a move made. A move counts when it scored or was recorded
 * (`recordedMoves`, set on every recorded move), so any recorded move shows Resume. A fresh deal
 * (saved at once) and a game that is over do not. A move that scored nothing and was not recorded
 * (replay recording stopped or off) shows none.
 */
import { peekBestStatus, pickStatus, readSavedGame, type TileStatus } from "../_shared/lobbyStatus";
import { isSavedGame, TWENTY48_GAME_KEY } from "./savedShape";
import type { Twenty48State } from "./types";

export function isResumable(state: Twenty48State | null): boolean {
  return !!state && !state.game_over && (state.score > 0 || (state.recordedMoves ?? 0) > 0);
}

export async function getLobbyStatus(): Promise<TileStatus | undefined> {
  const [saved, best] = await Promise.all([
    readSavedGame(TWENTY48_GAME_KEY, isSavedGame),
    peekBestStatus("twenty48", "score"),
  ]);
  return pickStatus([isResumable(saved) ? { kind: "resume" } : undefined, best]);
}
