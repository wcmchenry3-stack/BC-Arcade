/**
 * The result card's leaderboard flow for games on the session boards (#2677).
 *
 * Since #2624 a player's name lives on the player, and every finished game of
 * a named player ranks by itself: the card no longer submits anything. It
 * asks `GET /games/{id}/rank` where this game puts the player, and shows that
 * (or the one-time name prompt).
 *
 * Plug it into `useLeaderboardSubmit` and call `submit({ gameId })` once the
 * game ends:
 *
 *   const leaderboard = useLeaderboardSubmit(sessionBoardAdapter("sudoku"));
 *   // on game over:
 *   void leaderboard.submit({ gameId });
 *
 * - Online with a name: the rank → `saved`, `rank` set when top 10.
 * - No name: `needsName`; `provideName()` saves it (`saveDisplayName`, which
 *   syncs it through `PUT /players/me`) and then fetches the rank.
 * - Offline: `offline`, and nothing is queued. The game uploads through
 *   `SyncWorker` and the name through `displayNameSync`; the card fetches the
 *   rank again on reconnect if it is still mounted.
 * - A game that can't rank (`not_rankable` once the retries run out, or
 *   `board_disabled`): `saved` with no rank.
 * - Any other failure (a 403, a 404 after the retries, a 5xx): `error`, and
 *   `retry()` asks again.
 */

import { gamesApi, type GameRankResponse } from "../../api/games";
import { flushDisplayNameSync } from "./displayNameSync";
import { flushQueuedGames } from "./flushQueuedGames";
import type { GameType } from "./types";
import {
  NeedsDisplayNameError,
  retryUntilGameSynced,
  SyncPendingError,
  type RankOnlyLeaderboardAdapter,
} from "./useLeaderboardSubmit";

export interface SessionBoardSubmission {
  /** The finished game's id (the `games` row the game sync writes). */
  gameId: string;
}

export interface SessionBoardAdapterOptions {
  /** Passed to `retryUntilGameSynced` (tests shorten the delays). */
  retry?: { attempts?: number; baseDelayMs?: number };
}

/** The rank-only adapter for `gameType`'s session board. */
export function sessionBoardAdapter(
  gameType: GameType,
  { retry }: SessionBoardAdapterOptions = {}
): RankOnlyLeaderboardAdapter<SessionBoardSubmission> {
  return {
    gameType,
    refetchOnReconnect: true,
    submit: async (_playerName, { gameId }) => {
      // The completion sits in the local game queue until SyncWorker uploads
      // it (every 30 s), and a name just saved may still be in
      // displayNameSync's slot: send both first so the rank sees them.
      const [, nameSynced] = await Promise.all([flushQueuedGames(), flushDisplayNameSync()]);
      // Until the completion lands the server answers 404 (no row yet) or
      // `not_rankable` (no final score yet): retry both briefly.
      const result: GameRankResponse = await retryUntilGameSynced(() => gamesApi.getRank(gameId), {
        ...retry,
        notSynced: (r) => r.reason === "not_rankable",
      });
      if (result.ranked) return result.rank;
      if (result.reason === "no_name") {
        // The name couldn't be sent yet: the player has one, it just hasn't
        // reached the server. Shown as offline; fetched again on reconnect.
        if (!nameSynced) throw new SyncPendingError("The display name has not synced yet.");
        throw new NeedsDisplayNameError();
      }
      return null;
    },
  };
}
