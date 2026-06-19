/**
 * FreeCell API client (#2035).
 *
 * One endpoint: POST /freecell/score. Mirrors the Solitaire client shape
 * so future additions (GET /leaderboard for an in-app leaderboard, for instance)
 * slot in naturally.
 *
 * FreeCell ranks by move count ascending (fewer moves = better), unlike Solitaire
 * which ranks by score descending.
 */

import { createGameClient } from "../_shared/httpClient";

const request = createGameClient({ apiTag: "freecell" });

export interface ScoreEntry {
  readonly player_id: string;
  readonly move_count: number;
  /** 1-indexed; 11 when the submit didn't make the top 10. */
  readonly rank: number;
}

export interface LeaderboardResponse {
  readonly scores: readonly ScoreEntry[];
}

export const freecellApi = {
  submitScore: (player_id: string, move_count: number) =>
    request<ScoreEntry>("/freecell/score", {
      method: "POST",
      body: JSON.stringify({ player_id, move_count }),
    }),
  getLeaderboard: () => request<LeaderboardResponse>("/freecell/leaderboard"),
};
