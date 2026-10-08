/**
 * Where a finished game ranks on its session board (#2677, #2990).
 *
 * Since #2624 a player's name lives on the player, and every finished game of
 * a player on the leaderboards ranks by itself: the result card no longer
 * submits anything. It asks `GET /games/{id}/rank` where this game puts the
 * player, and shows that (or the one-time "Join leaderboards" prompt, #2778).
 * `useGameRank` is the hook a screen uses; this is the lookup it runs.
 *
 * - Ranked: `rank` is the rank of the player's best entry, and `isBest` says
 *   whether this game is that entry: a worse game shows "Your best: #N"
 *   (#2633).
 * - Not on the leaderboards (`no_name`): `needsName`.
 * - Still syncing (`not_finished`, or a join that couldn't be sent yet):
 *   `pending`, and the hook asks again on a backoff timer while mounted.
 * - On no board (`board_disabled`, or `not_rankable`: the game can never
 *   rank): `unranked`.
 * - A failed request throws; the hook turns it into `offline` or `error`.
 */

import { statsApi } from "../../api/stats";
import type { GameRankResponse } from "../../api/types";
import { flushDisplayNameSync } from "./displayNameSync";
import { flushQueuedGames } from "./flushQueuedGames";
import { ApiError } from "./httpClient";

/**
 * What a rank lookup found:
 *
 *   ranked    — `saved`; `rank` is the rank of the player's best entry (the
 *               hook still applies `topTenRank`), and `isBest` says whether
 *               this game is that entry (#2633; omitted means it is)
 *   unranked  — `unranked`: the game is on no board; nothing more to do
 *   needsName — the player hasn't joined the leaderboards: `needsName`
 *   pending   — not on the server yet (the completion or the join is still
 *               syncing): shown as `submitting`, and asked again later
 */
export type RankLookup =
  | { kind: "ranked"; rank: number | null; isBest?: boolean }
  | { kind: "unranked" }
  | { kind: "needsName" }
  | { kind: "pending" };

/**
 * For endpoints that read an already-synced game (`GET /games/{id}/rank`):
 * the game-sync request is fire-and-forget, so the call can arrive first and
 * the server answers 404 (no game row yet) or 400 (no final score yet). Retry
 * those briefly before giving up. Other errors are thrown at once.
 *
 * `notSynced` covers an endpoint that reports "not synced yet" in a success
 * body instead (the rank route's `not_finished` for a game whose completion
 * hasn't landed): such a result is retried the same way, and the last one is
 * returned once the attempts run out.
 */
export async function retryUntilGameSynced<T>(
  fn: () => Promise<T>,
  {
    attempts = 4,
    baseDelayMs = 750,
    notSynced,
  }: { attempts?: number; baseDelayMs?: number; notSynced?: (result: T) => boolean } = {}
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      const result = await fn();
      if (!notSynced?.(result) || attempt >= attempts) return result;
    } catch (e) {
      const notSyncedYet = e instanceof ApiError && (e.status === 404 || e.status === 400);
      if (!notSyncedYet || attempt >= attempts) throw e;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, baseDelayMs * 2 ** (attempt - 1)));
  }
}

/** What the card makes of a rank response. */
function toRankLookup(result: GameRankResponse, nameSynced: boolean): RankLookup {
  // `rank` is the player's best entry's; the card says "Your best: #N" when
  // this game isn't that entry (#2633).
  if (result.ranked) return { kind: "ranked", rank: result.rank, isBest: result.is_best !== false };
  switch (result.reason) {
    case "not_finished":
      return { kind: "pending" };
    case "no_name":
      // A join that couldn't be sent yet is still on its way, not missing.
      return nameSynced ? { kind: "needsName" } : { kind: "pending" };
    default:
      return { kind: "unranked" };
  }
}

/**
 * Looks up where `gameId` ranks on its session board. Only reads: there is
 * nothing to queue. Throws on a failed request. `retry` shortens the
 * not-synced-yet retries (tests).
 */
export async function lookupGameRank(
  gameId: string,
  { retry }: { retry?: { attempts?: number; baseDelayMs?: number } } = {}
): Promise<RankLookup> {
  // The completion sits in the local game queue until SyncWorker uploads
  // it (every 30 s), and a join just made may still be in
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
}
