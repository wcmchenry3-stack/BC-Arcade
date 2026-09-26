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
 *                `RankOnlyLeaderboardAdapter` nothing is queued: the hook
 *                asks for the rank again while the card is mounted
 *   needsName  — no display name yet; call `provideName()` (the card's
 *                one-time prompt) and the pending score goes out
 *   unranked   — rank-only adapters: this game is on no board (the board
 *                is disabled, or the game can never rank); the card shows
 *                no leaderboard line
 *   error      — could neither submit nor queue; `retry()` tries again
 */
export type LeaderboardSubmitStatus =
  "idle" | "submitting" | "saved" | "offline" | "needsName" | "unranked" | "error";

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
 * What a `RankOnlyLeaderboardAdapter`'s `submit` found:
 *
 *   ranked    — `saved`; `rank` is the rank of the player's best entry (the
 *               hook still applies `topTenRank`), and `isBest` says whether
 *               this game is that entry (#2633; omitted means it is)
 *   unranked  — `unranked`: the game is on no board; nothing more to do
 *   needsName — the server has no name for the player: `needsName`
 *   pending   — not on the server yet (the completion or the name is still
 *               syncing): shown as `submitting`, and asked again later
 */
export type RankLookup =
  | { kind: "ranked"; rank: number | null; isBest?: boolean }
  | { kind: "unranked" }
  | { kind: "needsName" }
  | { kind: "pending" };

/**
 * For games on the session boards (#2624, #2677): the game syncs through
 * `SyncWorker` and the name through `displayNameSync`, so a finished game is
 * already on its board and the card only asks where it landed. `submit` only
 * reads: there is nothing to queue.
 *
 * Until the lookup settles (`ranked`, `unranked`, `needsName`, or an HTTP
 * error, which is `error` with `retry()`), the hook keeps asking while the
 * card is mounted: on the next offline→online edge, and while online on a
 * backoff timer (`RANK_REFETCH_DELAYS_MS`). Offline or on a network failure
 * the status is `offline`; on `pending` it stays `submitting`. No queue item
 * is ever written. `sessionBoardAdapter` is the one implementation.
 */
export interface RankOnlyLeaderboardAdapter<P> {
  /** For error reporting only. */
  gameType: GameType;
  /** Look the rank up. Throws on a failed request. */
  submit: (playerName: string, payload: P) => Promise<RankLookup>;
  /** Nothing to queue: the hook fetches again (reconnect, backoff) while mounted. */
  refetchOnReconnect: true;
}

/**
 * Rank-only adapters: how long the hook waits before asking again while
 * online and unsettled — then the last delay, repeated, until it settles.
 */
export const RANK_REFETCH_DELAYS_MS: readonly number[] = [5_000, 15_000, 60_000];

/** What `useLeaderboardSubmit` takes: a legacy per-game adapter or a rank-only one. */
export type AnyLeaderboardAdapter<P> = LeaderboardAdapter<P> | RankOnlyLeaderboardAdapter<P>;

function isRankOnly<P>(
  adapter: AnyLeaderboardAdapter<P>
): adapter is RankOnlyLeaderboardAdapter<P> {
  return "refetchOnReconnect" in adapter && adapter.refetchOnReconnect === true;
}

/**
 * For endpoints that read or attach a name to an already-synced game
 * (`PATCH …/score/{game_id}`, `GET /games/{id}/rank`): the game-sync request
 * is fire-and-forget, so the call can arrive first and the server answers 404
 * (no game row yet) or 400 (no final score yet). Retry those briefly before
 * the caller falls back to the offline queue. Other errors are thrown at once.
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

/** Leaderboard APIs report rank 11 for "not in the top 10"; treat that as unranked. */
export function topTenRank(rank: number | null | undefined): number | null {
  return rank != null && rank >= 1 && rank <= 10 ? rank : null;
}

export interface LeaderboardSubmitState<P> {
  status: LeaderboardSubmitStatus;
  /** Top-10 rank of the player's best entry on the board, else null. */
  rank: number | null;
  /**
   * Whether this game is the player's best entry (#2633). False only when a
   * rank-only adapter reports an earlier game as the best: the card then
   * shows "Your best: #N".
   */
  isBest: boolean;
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
  const [isBest, setIsBest] = useState(true);
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
  // Rank-only adapters (#2677). `unsettled`: the rank is still wanted, set
  // before each fetch so a reconnect during one isn't lost. `inFlight`: one
  // fetch at a time. The timer asks again while online (backoff).
  const unsettledRef = useRef(false);
  const inFlightRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptRef = useRef(0);
  // The timer calls the latest `sendPending` (defined below).
  const sendPendingRef = useRef<() => Promise<void>>(() => Promise.resolve());

  const clearTimer = useCallback(() => {
    if (timerRef.current != null) clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  const scheduleRefetch = useCallback(() => {
    clearTimer();
    const delays = RANK_REFETCH_DELAYS_MS;
    const delay = delays[Math.min(attemptRef.current, delays.length - 1)] ?? 60_000;
    attemptRef.current += 1;
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      if (unsettledRef.current) void sendPendingRef.current();
    }, delay);
  }, [clearTimer]);

  /** A rank-only adapter's `send`: nothing is queued. */
  const fetchRank = useCallback(
    async (adapter: RankOnlyLeaderboardAdapter<P>, name: string, payload: P) => {
      const generation = generationRef.current;
      const isCurrent = () => generationRef.current === generation;
      clearTimer();
      setPlayerName(name);
      unsettledRef.current = true;

      if (offlineRef.current) {
        // The reconnect effect asks again.
        setStatus("offline");
        return;
      }
      // The fetch in flight settles, or schedules the next one itself.
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      setStatus("submitting");

      let lookup: RankLookup | null = null;
      let failure: unknown = null;
      try {
        lookup = await adapter.submit(name, payload);
      } catch (e) {
        failure = e;
      }
      if (!isCurrent()) return;
      inFlightRef.current = false;

      let settled = true;
      if (lookup != null) {
        switch (lookup.kind) {
          case "ranked":
            setRank(topTenRank(lookup.rank));
            setIsBest(lookup.isBest ?? true);
            setStatus("saved");
            break;
          case "unranked":
            setRank(null);
            setIsBest(true);
            setStatus("unranked");
            break;
          case "needsName":
            setStatus("needsName");
            break;
          case "pending":
            settled = false;
            break;
        }
      } else if (offlineRef.current || isNetworkError(failure)) {
        // NetInfo can lag behind a dropped connection.
        settled = false;
        setStatus("offline");
      } else {
        // HTTP errors are breadcrumbed by httpClient and never captured (#513).
        if (!(failure instanceof ApiError)) {
          Sentry.captureException(failure, {
            tags: { subsystem: "leaderboardSubmit", gameType: adapter.gameType },
          });
        }
        setStatus("error");
      }

      if (settled) {
        unsettledRef.current = false;
        attemptRef.current = 0;
      } else if (!offlineRef.current) {
        scheduleRefetch();
      }
    },
    [clearTimer, scheduleRefetch]
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
  sendPendingRef.current = sendPending;

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

  // Rank-only adapters: back online with the rank still wanted — ask again
  // (a fetch in flight settles or reschedules itself). Nothing was queued,
  // so an unmounted card loses nothing.
  const online = isInitialized && isOnline;
  useEffect(() => {
    if (!online || !unsettledRef.current || inFlightRef.current) return;
    void sendPending();
  }, [online, sendPending]);

  // Unmount: stop the timer, and drop the state updates of anything in flight.
  useEffect(
    () => () => {
      generationRef.current += 1;
      clearTimer();
    },
    [clearTimer]
  );

  const reset = useCallback(() => {
    generationRef.current += 1;
    startedRef.current = false;
    pendingRef.current = null;
    unsettledRef.current = false;
    inFlightRef.current = false;
    attemptRef.current = 0;
    clearTimer();
    setStatus("idle");
    setRank(null);
    setIsBest(true);
    setPlayerName(null);
  }, [clearTimer]);

  return { status, rank, isBest, playerName, submit, provideName, retry, reset };
}
