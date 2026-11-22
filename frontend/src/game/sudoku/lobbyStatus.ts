/**
 * Sudoku's lobby tile status (#4008): a game to resume.
 *
 * The screen always reopens a stored game; the tile offers "Resume" only for one with an entry made
 * (an undo step) that is not complete. No best is shown: Sudoku keeps one per mode and difficulty
 * (times that cannot be compared), so no single figure stands for the game.
 */
import { readSavedGame, type TileStatus } from "../_shared/lobbyStatus";
import { looksValid, SUDOKU_GAME_KEY } from "./savedShape";

export function isResumable(
  state: { readonly isComplete: boolean; readonly undoStack: readonly unknown[] } | null
): boolean {
  return !!state && !state.isComplete && state.undoStack.length > 0;
}

export async function getLobbyStatus(): Promise<TileStatus | undefined> {
  const saved = await readSavedGame(SUDOKU_GAME_KEY, looksValid);
  return isResumable(saved) ? { kind: "resume" } : undefined;
}
