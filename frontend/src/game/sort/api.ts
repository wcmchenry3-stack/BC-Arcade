import { createGameClient } from "../_shared/httpClient";

const request = createGameClient({ apiTag: "sort" });

export interface LevelData {
  readonly id: number;
  readonly bottles: readonly string[][];
}

export interface LevelsResponse {
  readonly levels: readonly LevelData[];
}

export interface ScoreEntry {
  readonly player_name: string;
  readonly level_reached: number;
  readonly rank: number;
}

export interface LeaderboardResponse {
  readonly scores: readonly ScoreEntry[];
}

export const sortApi = {
  getLevels: () => request<LevelsResponse>("/sort/levels"),
  submitScore: (player_name: string, level_reached: number) =>
    request<ScoreEntry>("/sort/score", {
      method: "POST",
      body: JSON.stringify({ player_name, level_reached }),
    }),
  getLeaderboard: () => request<LeaderboardResponse>("/sort/scores"),
};
