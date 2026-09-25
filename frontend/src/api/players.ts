/**
 * The player's one display name on the server (#2624).
 *
 * The player is this install's `X-Session-ID`, which httpClient injects. Every
 * leaderboard shows this name for all of the player's finished games; a player
 * without one appears on no board. All three calls are idempotent, so a
 * replayed sync has no second effect.
 */

import { createGameClient } from "../game/_shared/httpClient";

const request = createGameClient({ apiTag: "players" });

export interface PlayerResponse {
  /** The stored (trimmed) name, or null when none is set. */
  readonly display_name: string | null;
}

export const playersApi = {
  getMe: (): Promise<PlayerResponse> => request<PlayerResponse>("/players/me"),

  /** Upserts the name; sending the current name again writes nothing. */
  putMe: (displayName: string): Promise<PlayerResponse> =>
    request<PlayerResponse>("/players/me", {
      method: "PUT",
      body: JSON.stringify({ display_name: displayName }),
    }),

  /** Clears the name (204), which takes the player off every board. */
  deleteMe: (): Promise<void> => request<void>("/players/me", { method: "DELETE" }),
};
