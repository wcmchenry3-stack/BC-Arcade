/**
 * FreeCell's adapter for the shared leaderboard auto-submit (#2503, #2508).
 *
 * FreeCell's leaderboard takes a name and a move count directly
 * (`POST /freecell/score`, fewer moves ranks higher) — no game id to wait on.
 * The queue payload matches `registerFreeCellScoreHandler` in ./scoreSync.
 */

import type { LeaderboardAdapter } from "../_shared/useLeaderboardSubmit";
import { freecellApi } from "./api";

export interface FreeCellSubmission {
  moves: number;
}

export const freecellLeaderboard: LeaderboardAdapter<FreeCellSubmission> = {
  gameType: "freecell",
  submit: async (playerName, { moves }) => {
    const entry = await freecellApi.submitScore(playerName, moves);
    return entry.rank;
  },
  queuePayload: (player_id, { moves }) => ({ player_id, move_count: moves }),
};
