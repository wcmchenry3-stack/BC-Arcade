/**
 * Sort's adapter for the shared leaderboard auto-submit (#2503, #2512).
 *
 * Sort's leaderboard records the highest level a name has solved
 * (`POST /sort/score`) — no game id to wait on.
 * The queue payload matches `registerSortScoreHandler` in ./scoreSync.
 */

import type { LeaderboardAdapter } from "../_shared/useLeaderboardSubmit";
import { sortApi } from "./api";

export interface SortSubmission {
  level: number;
}

export const sortLeaderboard: LeaderboardAdapter<SortSubmission> = {
  gameType: "sort",
  submit: async (playerName, { level }) => {
    const entry = await sortApi.submitScore(playerName, level);
    return entry.rank;
  },
  queuePayload: (player_name, { level }) => ({ player_name, level_reached: level }),
};
