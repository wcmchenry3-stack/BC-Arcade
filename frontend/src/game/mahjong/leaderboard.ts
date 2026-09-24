/**
 * Mahjong's adapter for the shared leaderboard auto-submit (#2503, #2510).
 *
 * Mahjong's leaderboard takes a name and a score directly
 * (`POST /mahjong/score`) — no game id to wait on.
 * The queue payload matches `registerMahjongScoreHandler` in ./scoreSync.
 */

import type { LeaderboardAdapter } from "../_shared/useLeaderboardSubmit";
import { mahjongApi } from "./api";

export interface MahjongSubmission {
  score: number;
}

export const mahjongLeaderboard: LeaderboardAdapter<MahjongSubmission> = {
  gameType: "mahjong",
  submit: async (playerName, { score }) => {
    const entry = await mahjongApi.submitScore(playerName, score);
    return entry.rank;
  },
  queuePayload: (player_name, { score }) => ({ player_name, score }),
};
