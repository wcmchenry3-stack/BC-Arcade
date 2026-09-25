/**
 * Stats + games-history read API client (#365, consumed by #372).
 *
 * Device-anonymous: all reads scope to the caller's X-Session-ID, which
 * httpClient injects automatically.
 */

import { createGameClient } from "../game/_shared/httpClient";
import type { GameType } from "../game/_shared/types";
import type {
  StatsResponse,
  GameHistoryResponse,
  GameDetailResponse,
  GameLeaderboardResponse,
  GameRankResponse,
} from "./types";

const request = createGameClient({ apiTag: "stats" });

// Minutes EAST of UTC, the /daily-challenge/* convention. The streak counts the player's
// local days, so /stats/me needs it (a server without it falls back to UTC days).
function tzOffsetMinutes(): number {
  return -new Date().getTimezoneOffset();
}

export const statsApi = {
  getMyStats: (): Promise<StatsResponse> =>
    request<StatsResponse>(`/stats/me?tz_offset_minutes=${tzOffsetMinutes()}`),

  getMyGames: (limit = 20, cursor: string | null = null): Promise<GameHistoryResponse> => {
    const params = new URLSearchParams({ limit: String(limit) });
    if (cursor) params.set("cursor", cursor);
    return request<GameHistoryResponse>(`/games/me?${params.toString()}`);
  },

  getGameDetail: (gameId: string, includeEvents = false): Promise<GameDetailResponse> =>
    request<GameDetailResponse>(`/games/${gameId}?include_events=${includeEvents ? 1 : 0}`),

  /**
   * `GET /games/{id}/rank` (#2677). Read-only. Rejects with an `ApiError`:
   * 404 until the game has synced (or it has no board), 403 for another
   * player's game.
   */
  getGameRank: (gameId: string): Promise<GameRankResponse> =>
    request<GameRankResponse>(`/games/${encodeURIComponent(gameId)}/rank`),

  /**
   * `GET /games/leaderboard/{gameType}` (#2618): the top players on one board,
   * one entry each. `partition` holds the board's partition query params
   * (e.g. `{ difficulty: "easy" }`); a board without partitions takes none.
   */
  getLeaderboard: (
    gameType: GameType,
    partition: Readonly<Record<string, string>> = {}
  ): Promise<GameLeaderboardResponse> => {
    const query = new URLSearchParams(partition as Record<string, string>).toString();
    const path = `/games/leaderboard/${encodeURIComponent(gameType)}`;
    return request<GameLeaderboardResponse>(query ? `${path}?${query}` : path);
  },

  deleteMyData: (): Promise<void> => request<void>("/me", { method: "DELETE" }),
};

export type {
  StatsResponse,
  GameHistoryResponse,
  GameDetailResponse,
  GameLeaderboardEntry,
  GameLeaderboardResponse,
  GameRankReason,
  GameRankResponse,
} from "./types";
