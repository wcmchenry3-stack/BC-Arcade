/**
 * Solitaire's adapter for the shared leaderboard auto-submit (#2503, #2509).
 *
 * Solitaire's leaderboard takes a name and a score directly
 * (`POST /solitaire/score`) — no game id to wait on.
 * The queue payload matches `registerSolitaireScoreHandler` in ./scoreSync.
 */

import type { LeaderboardAdapter } from "../_shared/useLeaderboardSubmit";
import { solitaireApi } from "./api";

export interface SolitaireSubmission {
  score: number;
}

export const solitaireLeaderboard: LeaderboardAdapter<SolitaireSubmission> = {
  gameType: "solitaire",
  submit: async (playerName, { score }) => {
    const entry = await solitaireApi.submitScore(playerName, score);
    return entry.rank;
  },
  queuePayload: (player_name, { score }) => ({ player_name, score }),
};
