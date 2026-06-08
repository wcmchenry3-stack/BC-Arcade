/**
 * Stats + games-history read API client (#365, consumed by #372).
 *
 * Device-anonymous: all reads scope to the caller's X-Session-ID, which
 * httpClient injects automatically.
 */

import { createGameClient } from "../game/_shared/httpClient";
import type { StatsResponse, GameHistoryResponse, GameDetailResponse } from "./types";

const request = createGameClient({ apiTag: "stats" });

export const statsApi = {
  getMyStats: (): Promise<StatsResponse> => request<StatsResponse>("/stats/me"),

  getMyGames: (limit = 20, cursor: string | null = null): Promise<GameHistoryResponse> => {
    const params = new URLSearchParams({ limit: String(limit) });
    if (cursor) params.set("cursor", cursor);
    return request<GameHistoryResponse>(`/games/me?${params.toString()}`);
  },

  getGameDetail: (gameId: string, includeEvents = false): Promise<GameDetailResponse> =>
    request<GameDetailResponse>(`/games/${gameId}?include_events=${includeEvents ? 1 : 0}`),

  deleteMyData: (): Promise<void> => request<void>("/me", { method: "DELETE" }),
};

export type { StatsResponse, GameHistoryResponse, GameDetailResponse } from "./types";
