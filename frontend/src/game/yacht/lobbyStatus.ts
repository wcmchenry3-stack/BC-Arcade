/**
 * Yacht's lobby tile status (#4008): a game to resume, else the personal best.
 *
 * `isResumable` is the one rule for "resume vs new". HomeScreen's tap (`startYacht`) and the
 * tile's "Resume" status both use it, so the tile never offers a Resume that a tap would not give.
 */
import { getBest } from "../_shared/personalBest";
import { bestStatus, pickStatus, readSavedGame, type TileStatus } from "../_shared/lobbyStatus";
import { isSavedGame, YACHT_GAME_KEY, type SavedGame } from "./storage";
import { isAiTurnPending } from "./vsTurn";

/**
 * A saved game that is worth opening: unfinished, or a VS game where only the computer's last
 * turn is left (#2203). A finished game starts a new one.
 */
export function isResumable(saved: SavedGame | null): saved is SavedGame {
  return (
    !!saved &&
    (!saved.state.game_over ||
      (!!saved.aiDifficulty && !!saved.aiState && isAiTurnPending(saved.state, saved.aiState)))
  );
}

export async function getLobbyStatus(): Promise<TileStatus | undefined> {
  const [saved, best] = await Promise.all([
    readSavedGame(YACHT_GAME_KEY, isSavedGame),
    getBest("yacht"),
  ]);
  return pickStatus([
    isResumable(saved) ? { kind: "resume" } : undefined,
    bestStatus(best, "score"),
  ]);
}
