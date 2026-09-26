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
 * - Online with a name: `saved`. `rank` is the rank of the player's best
 *   entry when it is in the top 10, and `isBest` says whether this game is
 *   that entry: a worse game shows "Your best: #N" (#2633).
 * - No name: `needsName`; `provideName()` saves it (`saveDisplayName`, which
 *   syncs it through `PUT /players/me`) and then fetches the rank.
 * - Still syncing (`not_finished`, or a name that couldn't be sent yet):
 *   `submitting`, and the hook asks again on a backoff timer while mounted.
 * - Offline: `offline`, and nothing is queued. The game uploads through
 *   `SyncWorker` and the name through `displayNameSync`; the card fetches the
 *   rank again on reconnect (and on the timer) while it is mounted.
 * - On no board (`board_disabled`, or `not_rankable`: the game can never
 *   rank): `unranked`, and the card shows no leaderboard line.
 * - Any other failure (a 403, a 404 after the retries, a 5xx): `error`, and
 *   `retry()` asks again.
 */

import { statsApi } from "../../api/stats";
import type { GameRankResponse } from "../../api/types";
import { flushDisplayNameSync } from "./displayNameSync";
import { flushQueuedGames } from "./flushQueuedGames";
import type { GameType } from "./types";
import {
  retryUntilGameSynced,
  type RankLookup,
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

/** What the card makes of a rank response. */
export function toRankLookup(result: GameRankResponse, nameSynced: boolean): RankLookup {
  // `rank` is the player's best entry's; the card says "Your best: #N" when
  // this game isn't that entry (#2633).
  if (result.ranked) return { kind: "ranked", rank: result.rank, isBest: result.is_best !== false };
  switch (result.reason) {
    case "not_finished":
      return { kind: "pending" };
    case "no_name":
      // A name that couldn't be sent yet is still on its way, not missing.
      return nameSynced ? { kind: "needsName" } : { kind: "pending" };
    default:
      return { kind: "unranked" };
  }
}

/** The rank-only adapter for `gameType`'s session board. */
export function sessionBoardAdapter(
  gameType: GameType,
  { retry }: SessionBoardAdapterOptions = {}
): RankOnlyLeaderboardAdapter<SessionBoardSubmission> {
  return {
    gameType,
    submit: async (_playerName, { gameId }) => {
      // The completion sits in the local game queue until SyncWorker uploads
      // it (every 30 s), and a name just saved may still be in
      // displayNameSync's slot: send both first so the rank sees them.
      const [, nameSynced] = await Promise.all([flushQueuedGames(), flushDisplayNameSync()]);
      // Until the completion lands the server answers 404 (no row yet) or
      // `not_finished` (no final score yet): retry those briefly. A
      // `not_rankable` game will never rank, so it is final at once.
      const result = await retryUntilGameSynced(() => statsApi.getGameRank(gameId), {
        ...retry,
        notSynced: (r) => r.reason === "not_finished",
      });
      return toRankLookup(result, nameSynced);
    },
  };
}
