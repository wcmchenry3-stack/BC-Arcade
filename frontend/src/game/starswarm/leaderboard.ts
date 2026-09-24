/**
 * Star Swarm's adapter for the shared leaderboard auto-submit (#2503, #2516).
 *
 * `POST /starswarm/score` records a run under a name and answers with the
 * current top 10 rather than a rank, so the rank is this run's row in it.
 * The queue payload matches `registerStarSwarmScoreHandler` in ./scoreSync.
 */

import type { LeaderboardAdapter } from "../_shared/useLeaderboardSubmit";
import { starSwarmApi, type LeaderboardEntry } from "./api";

export interface StarSwarmSubmission {
  score: number;
  wave: number;
  difficulty: string;
}

/** This run's place in the returned top 10, or null when it didn't make it. */
export function rankInTopTen(
  scores: readonly LeaderboardEntry[],
  playerName: string,
  { score, wave, difficulty }: StarSwarmSubmission
): number | null {
  const row = scores.find(
    (e) =>
      e.player_id === playerName &&
      e.score === score &&
      e.wave_reached === wave &&
      e.difficulty_tier === difficulty
  );
  return row?.rank ?? null;
}

export const starSwarmLeaderboard: LeaderboardAdapter<StarSwarmSubmission> = {
  gameType: "starswarm",
  submit: async (playerName, run) => {
    const { scores } = await starSwarmApi.submitScore(
      playerName,
      run.score,
      run.wave,
      run.difficulty
    );
    return rankInTopTen(scores, playerName, run);
  },
  queuePayload: (player_id, { score, wave, difficulty }) => ({
    player_id,
    score,
    wave_reached: wave,
    difficulty_tier: difficulty,
  }),
};
