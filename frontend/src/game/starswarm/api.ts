import { createGameClient } from "../_shared/httpClient";

export interface LeaderboardEntry {
  player_id: string;
  score: number;
  wave_reached: number;
  difficulty_tier: string;
  timestamp: string;
  rank: number;
}

export interface LeaderboardResponse {
  scores: LeaderboardEntry[];
}

const request = createGameClient({ apiTag: "starswarm" });

/**
 * The legacy Star Swarm board, read by the Ranks tab until #2634. The app no
 * longer posts to `POST /starswarm/score` (#2626): a finished run's own
 * session row is its leaderboard entry.
 */
export const starSwarmApi = {
  getLeaderboard: () => request<LeaderboardResponse>("/starswarm/leaderboard"),
};
