import { createGameClient } from "../_shared/httpClient";

const request = createGameClient({ apiTag: "sort" });

export interface LevelData {
  readonly id: number;
  readonly bottles: readonly string[][];
}

export interface LevelsResponse {
  readonly levels: readonly LevelData[];
}

// The leaderboard is the generic session board (#2625): `statsApi.getLeaderboard("sort")`.
export const sortApi = {
  getLevels: () => request<LevelsResponse>("/sort/levels"),
};
