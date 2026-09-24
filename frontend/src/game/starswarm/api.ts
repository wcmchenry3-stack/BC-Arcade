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

export const starSwarmApi = {
  /** `player_id` is the name shown on the leaderboard (the profile display name, #2516). */
  submitScore: (player_id: string, score: number, wave_reached: number, difficulty_tier: string) =>
    request<LeaderboardResponse>("/starswarm/score", {
      method: "POST",
      body: JSON.stringify({ player_id, score, wave_reached, difficulty_tier }),
    }),

  getLeaderboard: () => request<LeaderboardResponse>("/starswarm/leaderboard"),
};
