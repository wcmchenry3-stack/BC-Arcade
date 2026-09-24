/**
 * Cascade's adapter for the shared leaderboard auto-submit (#2503, #2515).
 *
 * Cascade's score is recorded by game sync; the leaderboard entry only needs
 * the player's name attached to that game (`PATCH /cascade/score/{game_id}`).
 * The queue payload matches `registerCascadeScoreHandler` in ./scoreSync.
 */

import type { LeaderboardAdapter } from "../_shared/useLeaderboardSubmit";
import { retryUntilGameSynced } from "../_shared/useLeaderboardSubmit";
import { flushQueuedGames } from "../_shared/flushQueuedGames";
import { cascadeApi } from "./api";

export interface CascadeSubmission {
  gameId: string;
}

export const cascadeLeaderboard: LeaderboardAdapter<CascadeSubmission> = {
  gameType: "cascade",
  submit: async (playerName, { gameId }) => {
    // The completion only sits in the local game queue until SyncWorker
    // uploads it; attach the name only once the game exists server-side.
    await flushQueuedGames();
    const entry = await retryUntilGameSynced(() => cascadeApi.submitPlayerName(gameId, playerName));
    return entry.rank;
  },
  queuePayload: (player_name, { gameId }) => ({ game_id: gameId, player_name }),
};
