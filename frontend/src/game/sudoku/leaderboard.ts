/**
 * Sudoku's adapter for the shared leaderboard auto-submit (#2503, #2511).
 *
 * Sudoku's score is recorded by game sync; the leaderboard entry only needs
 * the player's name attached to that game (`PATCH /sudoku/score/{game_id}`).
 * The queue payload matches `registerSudokuScoreHandler` in ./scoreSync.
 */

import type { LeaderboardAdapter } from "../_shared/useLeaderboardSubmit";
import { retryUntilGameSynced } from "../_shared/useLeaderboardSubmit";
import { sudokuApi } from "./api";

export interface SudokuSubmission {
  gameId: string;
}

export const sudokuLeaderboard: LeaderboardAdapter<SudokuSubmission> = {
  gameType: "sudoku",
  submit: async (playerName, { gameId }) => {
    const entry = await retryUntilGameSynced(() => sudokuApi.submitPlayerName(gameId, playerName));
    return entry.rank;
  },
  queuePayload: (player_name, { gameId }) => ({ game_id: gameId, player_name }),
};
