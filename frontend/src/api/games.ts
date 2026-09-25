/**
 * Generic `/games/*` calls that aren't game sync (#2677).
 *
 * The player is this install's `X-Session-ID`, which httpClient injects.
 */

import { createGameClient } from "../game/_shared/httpClient";

const request = createGameClient({ apiTag: "games" });

/** Why `GET /games/{id}/rank` has no rank to report. */
export type GameRankReason = "no_name" | "not_rankable" | "board_disabled";

/**
 * `GET /games/{id}/rank`: where one of the caller's games puts them on its
 * board. `rank` (exact, 1-based) is the rank of the player's best entry in
 * that game's partition; `is_best` says whether this game is that entry. Both
 * are null when `ranked` is false, and `reason` says why:
 *
 *   no_name        — the player has no display name on the server
 *   not_rankable   — this game can't rank (unfinished, abandoned, over the cap…)
 *   board_disabled — the game has no leaderboard
 */
export interface GameRankResponse {
  readonly rank: number | null;
  readonly is_best: boolean | null;
  readonly ranked: boolean;
  readonly reason: GameRankReason | null;
}

export const gamesApi = {
  /**
   * Read-only. Rejects with an `ApiError`: 404 until the game has synced (or
   * it has no board), 403 for another player's game.
   */
  getRank: (gameId: string): Promise<GameRankResponse> =>
    request<GameRankResponse>(`/games/${encodeURIComponent(gameId)}/rank`),
};
