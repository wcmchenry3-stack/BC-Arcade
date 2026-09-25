import { useCallback, useEffect, useRef, useState } from "react";
import * as Sentry from "@sentry/react-native";
import type { GameType } from "./types";
import { scoreQueue } from "./scoreQueue";
import { useNetwork } from "./NetworkContext";
import { loadDisplayName, saveDisplayName } from "./displayName";
import { ApiError, isNetworkError } from "./httpClient";
import { flushQueuedGames } from "./flushQueuedGames";

/**
 * Automatic leaderboard submission under the player's display name (#2503).
 *
 * Replaces the per-game name TextInput + Submit button: a game calls
 * `submit(payload)` once when it ends, and the result card renders `status`.
 *
 *   saved      — the server accepted it; `rank` is set when it placed top 10
 *   offline    — queued in `scoreQueue` (device offline, or the request
 *                failed); the queue retries on reconnect. For a
 *                `RankOnlyLeaderboardAdapter` nothing is queued: the card
 *                asks for the rank again on reconnect while it is mounted
 *   needsName  — no display name yet; call `provideName()` (the card's
 *                one-time prompt) and the pending score goes out
 *   error      — could neither submit nor queue; `retry()` tries again
 */
export type LeaderboardSubmitStatus =
  "idle" | "submitting" | "saved" | "offline" | "needsName" | "error";

/**
 * Per-game glue between the shared flow and that game's API. The per-game
 * scoring endpoints disagree on identity (name vs player_id vs game_id) and
 * queue payload shape; unifying them is tracked in #2519.
 */
export interface LeaderboardAdapter<P> {
  /** The `scoreQueue` game type; its handler must accept `queuePayload`'s shape. */
  gameType: GameType;
  /** Submit online. Resolve to the leaderboard rank, or null if unranked. */
  submit: (playerName: string, payload: P) => Promise<number | null>;
  /** The payload to enqueue when offline — the shape the game's queue handler reads. */
  queuePayload: (playerName: string, payload: P) => Record<string, unknown>;
}

/**
 * For games on the session boards (#2624, #2677): the game syncs through
 * `SyncWorker` and the name through `displayNameSync`, so a finished game is
 * already on its board and the card only asks where it landed. `submit` only
 * reads: there is nothing to queue.
 *
 * Offline (or on a network failure) the status is `offline` and no queue item
 * is written; when the device comes back online the hook calls `submit` again
 * if the card is still mounted; so is a `SyncPendingError`. Any other failure
 * is `error` (`retry()`). `submit` may throw `NeedsDisplayNameError` when the
 * server has no name for the player: the card then prompts for one.
 * `sessionBoardAdapter` is the one implementation.
 */
export interface RankOnlyLeaderboardAdapter<P> {
  /** For error reporting only. */
  gameType: GameType;
  /** Resolve to the player's exact rank, or null if the game doesn't rank. */
  submit: (playerName: string, payload: P) => Promise<number | null>;
  /** Nothing to queue: fetch again on reconnect while mounted. */
  refetchOnReconnect: true;
}

/** What `useLeaderboardSubmit` takes: a legacy per-game adapter or a rank-only one. */
export type AnyLeaderboardAdapter<P> = LeaderboardAdapter<P> | RankOnlyLeaderboardAdapter<P>;

function isRankOnly<P>(
  adapter: AnyLeaderboardAdapter<P>
): adapter is RankOnlyLeaderboardAdapter<P> {
  return "refetchOnReconnect" in adapter && adapter.refetchOnReconnect === true;
}

/**
 * Thrown by a `RankOnlyLeaderboardAdapter` when the server has no display
 * name for the player (and none is waiting to sync): the hook shows the
 * `needsName` prompt instead of an error.
 */
export class NeedsDisplayNameError extends Error {
  constructor() {
    super("The player has no display name on the server.");
    this.name = "NeedsDisplayNameError";
  }
}

/**
 * Thrown by a `RankOnlyLeaderboardAdapter` when something the rank depends on
 * is still waiting to reach the server (e.g. the display name's sync failed
 * for want of a connection): shown as `offline`, fetched again on reconnect.
 */
export class SyncPendingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SyncPendingError";
  }
}

/**
 * For endpoints that read or attach a name to an already-synced game
 * (`PATCH …/score/{game_id}`, `GET /games/{id}/rank`): the game-sync request
 * is fire-and-forget, so the call can arrive first and the server answers 404
 * (no game row yet) or 400 (no final score yet). Retry those briefly before
 * the caller falls back to the offline queue. Other errors are thrown at once.
 *
 * `notSynced` covers an endpoint that reports "not synced yet" in a success
 * body instead (the rank route's `not_rankable` for a game whose completion
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

/** Leaderboard APIs report rank 11 for "not in the top 10"; treat that as unranked. */
export function topTenRank(rank: number | null | undefined): number | null {
  return rank != null && rank >= 1 && rank <= 10 ? rank : null;
}

export interface LeaderboardSubmitState<P> {
  status: LeaderboardSubmitStatus;
  rank: number | null;
  /** The name the score went out (or was queued) under. */
  playerName: string | null;
  /** Submit this game's score. Later calls are ignored until `reset()`. */
  submit: (payload: P) => Promise<void>;
  /** Save a display name and send the score waiting on it. Resolves false if the name is invalid. */
  provideName: (name: string) => Promise<boolean>;
  /** Try the last submission again after an `error`. */
  retry: () => Promise<void>;
  /** Forget this game's submission (call on new game). */
  reset: () => void;
}

export function useLeaderboardSubmit<P>(
  adapter: AnyLeaderboardAdapter<P>
): LeaderboardSubmitState<P> {
  const { isOnline, isInitialized } = useNetwork();
  const [status, setStatus] = useState<LeaderboardSubmitStatus>("idle");
  const [rank, setRank] = useState<number | null>(null);
  const [playerName, setPlayerName] = useState<string | null>(null);

  // Refs so the callbacks stay stable and see the latest values.
  const adapterRef = useRef(adapter);
  adapterRef.current = adapter;
  const offlineRef = useRef(false);
  offlineRef.current = isInitialized && !isOnline;
  const pendingRef = useRef<{ payload: P } | null>(null);
  const startedRef = useRef(false);
  // Bumped by reset(): a request still in flight from the previous game must
  // not write its status/rank over the new game's (it still gets sent or
  // queued — only its state updates are dropped).
  const generationRef = useRef(0);
  // Rank-only adapters: the fetch couldn't reach the server, so the next
  // offline→online edge fetches again (while this hook is mounted).
  const refetchOnReconnectRef = useRef(false);

  /** A rank-only adapter's `send`: nothing is queued (#2677). */
  const fetchRank = useCallback(
    async (adapter: RankOnlyLeaderboardAdapter<P>, name: string, payload: P) => {
      const generation = generationRef.current;
      const isCurrent = () => generationRef.current === generation;
      setPlayerName(name);
      refetchOnReconnectRef.current = false;

      if (offlineRef.current) {
        refetchOnReconnectRef.current = true;
        setStatus("offline");
        return;
      }
      setStatus("submitting");
      try {
        const placed = await adapter.submit(name, payload);
        if (!isCurrent()) return;
        setRank(topTenRank(placed));
        setStatus("saved");
      } catch (e) {
        if (!isCurrent()) return;
        if (e instanceof NeedsDisplayNameError) {
          setStatus("needsName");
          return;
        }
        // Try again on the next reconnect either way; a network failure is
        // shown as offline (NetInfo can lag behind a dropped connection).
        refetchOnReconnectRef.current = true;
        if (offlineRef.current || isNetworkError(e) || e instanceof SyncPendingError) {
          setStatus("offline");
          return;
        }
        // HTTP errors are breadcrumbed by httpClient and never captured (#513).
        if (!(e instanceof ApiError)) {
          Sentry.captureException(e, {
            tags: { subsystem: "leaderboardSubmit", gameType: adapter.gameType },
          });
        }
        setStatus("error");
      }
    },
    []
  );

  const send = useCallback(
    async (name: string, payload: P) => {
      if (isRankOnly(adapterRef.current)) {
        await fetchRank(adapterRef.current, name, payload);
        return;
      }
      const { gameType, submit, queuePayload } = adapterRef.current;
      const generation = generationRef.current;
      const isCurrent = () => generationRef.current === generation;
      setPlayerName(name);

      const enqueue = async () => {
        try {
          await scoreQueue.enqueue(gameType, queuePayload(name, payload));
          if (isCurrent()) setStatus("offline");
          // scoreQueue otherwise only flushes on an offline→online edge, so a
          // player who stays online would never send a queued score. Upload the
          // game itself first so a name-attach handler doesn't race it.
          if (!offlineRef.current) {
            flushQueuedGames()
              .then(() => scoreQueue.flush())
              .catch(() => undefined);
          }
        } catch (e) {
          Sentry.captureException(e, { tags: { subsystem: "leaderboardSubmit", gameType } });
          if (isCurrent()) setStatus("error");
        }
      };

      if (offlineRef.current) {
        await enqueue();
        return;
      }
      setStatus("submitting");
      try {
        const placed = await submit(name, payload);
        if (!isCurrent()) return;
        setRank(topTenRank(placed));
        setStatus("saved");
      } catch {
        // The request failed while nominally online — queue it for the next flush.
        await enqueue();
      }
    },
    [fetchRank]
  );

  /** Sends the pending score under the stored name, or asks for one. */
  const sendPending = useCallback(async () => {
    const pending = pendingRef.current;
    if (!pending) return;
    const generation = generationRef.current;
    const name = await loadDisplayName();
    if (generationRef.current !== generation) return;
    if (!name) {
      setStatus("needsName");
      return;
    }
    await send(name, pending.payload);
  }, [send]);

  const submit = useCallback(
    async (payload: P) => {
      if (startedRef.current) return;
      startedRef.current = true;
      pendingRef.current = { payload };
      await sendPending();
    },
    [sendPending]
  );

  const provideName = useCallback(
    async (raw: string) => {
      const generation = generationRef.current;
      const name = await saveDisplayName(raw);
      if (!name) return false;
      const pending = pendingRef.current;
      if (pending && generationRef.current === generation) await send(name, pending.payload);
      return true;
    },
    [send]
  );

  const retry = sendPending;

  // Rank-only adapters: back online after an offline (or failed) fetch —
  // ask again. Nothing was queued, so an unmounted card loses nothing.
  const online = isInitialized && isOnline;
  useEffect(() => {
    if (!online || !refetchOnReconnectRef.current) return;
    refetchOnReconnectRef.current = false;
    void sendPending();
  }, [online, sendPending]);

  const reset = useCallback(() => {
    generationRef.current += 1;
    startedRef.current = false;
    pendingRef.current = null;
    refetchOnReconnectRef.current = false;
    setStatus("idle");
    setRank(null);
    setPlayerName(null);
  }, []);

  return { status, rank, playerName, submit, provideName, retry, reset };
}
