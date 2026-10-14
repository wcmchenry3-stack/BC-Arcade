/**
 * Device state that belongs to the old player id, dropped when a predictable
 * legacy session id is re-keyed (#3303, owner decision #3325).
 *
 * The new id is a new player to the server, so anything queued or cached for
 * the old one would be sent under the wrong id or shown to the wrong player.
 * The app is not public yet, so the old queue is dropped rather than migrated.
 *
 * `session.ts` imports this module, so nothing here may import `session.ts`
 * back (directly or through an API client): the daily-challenge cache is
 * cleared by key for that reason.
 *
 * Not touched, on purpose:
 * - Display name (`player_display_name*`): the synced marker already holds
 *   the session id it was confirmed for, and the launch refresh from
 *   `GET /players/me` (now under the new id) replaces the device's copy; a
 *   pending join is the player's choice and is sent under the new id.
 * - `/stats/me` cache (`useMyStats`): in memory and keyed by session id.
 * - IAP: the store tokens are derived server-side from `X-Session-ID`; the
 *   device stores none. Restore Purchases re-links a purchase to the new id.
 * - `last_connected_at_v1`: about the device's connectivity, not the player.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Sentry from "@sentry/react-native";

import { gameEventClient } from "./gameEventClient";
import { clearLastKnownStreak } from "./lastKnownStreak";
import { clearLegacyScoreQueue } from "./legacyScoreQueue";

/**
 * The cached entitlement JWT (`sub` = the old session id). Same strings as
 * `TOKEN_STORAGE_KEY` / `CACHED_AT_STORAGE_KEY` in EntitlementContext.tsx
 * (a test pins them), without importing the React provider here.
 */
export const ENTITLEMENT_CACHE_KEYS = ["entitlement_token", "entitlement_cached_at"] as const;

/**
 * The daily challenge's cached `/upcoming` and `/status` answers (this
 * player's slate and progress). Same strings as `UPCOMING_KEY` / `STATUS_KEY`
 * in daily_challenge/offlineCache.ts (a test pins them); that module reaches
 * the sync worker, which imports `session.ts`.
 */
export const DAILY_CHALLENGE_CACHE_KEYS = [
  "daily_challenge_upcoming_v1",
  "daily_challenge_status_v1",
] as const;

/**
 * Drop the old player's queue and caches. Each failure is reported. The cache
 * steps are best-effort; a failed queue clear rejects, so the caller keeps the
 * legacy id stored (never returned) and retries the whole re-key next call,
 * rather than sending the old player's queue under the new id.
 */
export async function purgeSessionScopedState(): Promise<void> {
  const steps: [string, () => Promise<void>][] = [
    // Queued games, events and bug logs (pending_games_v1 + the event tiers).
    // First: it is the one step whose failure fails the re-key.
    ["queue", () => gameEventClient.clearAll()],
    ["legacyScoreQueue", clearLegacyScoreQueue],
    ["entitlementCache", () => AsyncStorage.removeMany([...ENTITLEMENT_CACHE_KEYS])],
    ["lastKnownStreak", clearLastKnownStreak],
    ["dailyChallengeCache", () => AsyncStorage.removeMany([...DAILY_CHALLENGE_CACHE_KEYS])],
  ];
  const results = await Promise.allSettled(steps.map(([, run]) => run()));
  results.forEach((r, i) => {
    if (r.status === "rejected") {
      Sentry.captureException(r.reason, {
        tags: { subsystem: "session", op: `rekey.${steps[i]![0]}` },
      });
    }
  });
  const queue = results[0]!;
  if (queue.status === "rejected") throw queue.reason;
}
