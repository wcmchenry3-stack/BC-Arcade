/**
 * Sudoku's adapter for the shared leaderboard auto-submit (#2503, #2511).
 *
 * Sudoku's score is recorded by game sync; the leaderboard entry only needs
 * the player's name attached to that game (`PATCH /sudoku/score/{game_id}`).
 * The queue payload matches `registerSudokuScoreHandler` in ./scoreSync.
 */

import type { LeaderboardAdapter } from "../_shared/useLeaderboardSubmit";
import { retryUntilGameSynced } from "../_shared/useLeaderboardSubmit";
import { flushQueuedGames } from "../_shared/flushQueuedGames";
import { sudokuApi } from "./api";

export interface SudokuSubmission {
  gameId: string;
}

export const sudokuLeaderboard: LeaderboardAdapter<SudokuSubmission> = {
  gameType: "sudoku",
  submit: async (playerName, { gameId }) => {
    // The completion only sits in the local game queue (SyncWorker uploads
    // every 30 s); until it lands the server rejects the name with 400.
    // Upload it first; the retry covers a flush that loses a race.
    await flushQueuedGames();
    const entry = await retryUntilGameSynced(() => sudokuApi.submitPlayerName(gameId, playerName));
    return entry.rank;
  },
  queuePayload: (player_name, { gameId }) => ({ game_id: gameId, player_name }),
};
