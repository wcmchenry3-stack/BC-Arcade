/**
 * Star Swarm's adapter for the shared leaderboard auto-submit (#2503, #2516).
 *
 * `POST /starswarm/score` records a run under a name and answers with the
 * top 10 plus this run's own `rank` (null outside the top 10). The rank can't
 * be read off the list: an identical earlier run looks the same there.
 * The queue payload matches `registerStarSwarmScoreHandler` in ./scoreSync.
 */

import type { LeaderboardAdapter } from "../_shared/useLeaderboardSubmit";
import { starSwarmApi } from "./api";

export interface StarSwarmSubmission {
  score: number;
  wave: number;
  difficulty: string;
}

export const starSwarmLeaderboard: LeaderboardAdapter<StarSwarmSubmission> = {
  gameType: "starswarm",
  submit: async (playerName, run) => {
    const { rank } = await starSwarmApi.submitScore(
      playerName,
      run.score,
      run.wave,
      run.difficulty
    );
    return rank ?? null;
  },
  queuePayload: (player_id, { score, wave, difficulty }) => ({
    player_id,
    score,
    wave_reached: wave,
    difficulty_tier: difficulty,
  }),
};
