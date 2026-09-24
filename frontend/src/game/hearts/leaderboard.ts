/**
 * Hearts' adapter for the shared leaderboard auto-submit (#2503, #2506).
 *
 * Hearts' leaderboard takes a name and a score directly (`POST /hearts/score`,
 * score = 100 − the player's points) — no game id to wait on.
 * The queue payload matches `registerHeartsScoreHandler` in ./scoreSync.
 */

import type { LeaderboardAdapter } from "../_shared/useLeaderboardSubmit";
import { heartsApi } from "./api";

export interface HeartsSubmission {
  score: number;
}

export const heartsLeaderboard: LeaderboardAdapter<HeartsSubmission> = {
  gameType: "hearts",
  submit: async (playerName, { score }) => {
    const entry = await heartsApi.submitScore(playerName, score);
    return entry.rank;
  },
  queuePayload: (player_name, { score }) => ({ player_name, score }),
};

/** The leaderboard score for a finished game: fewer points is better. */
export function heartsLeaderboardScore(humanPoints: number): number {
  return Math.max(0, 100 - humanPoints);
}
