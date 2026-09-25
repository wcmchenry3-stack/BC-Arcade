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
// The legacy `POST /sort/score` / `GET /sort/scores` routes stay on the server
// for installed builds until #2644; the app no longer calls them.
export const sortApi = {
  getLevels: () => request<LevelsResponse>("/sort/levels"),
};
