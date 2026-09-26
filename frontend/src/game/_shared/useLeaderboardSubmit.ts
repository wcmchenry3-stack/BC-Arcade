import { useCallback, useEffect, useRef, useState } from "react";
import * as Sentry from "@sentry/react-native";
import type { GameType } from "./types";
import { useNetwork } from "./NetworkContext";
import { loadDisplayName, saveDisplayName } from "./displayName";
import { ApiError, isNetworkError } from "./httpClient";

/**
 * The result card's leaderboard line under the player's display name (#2503,
 * #2677).
 *
 * A game calls `submit(payload)` once when it ends, and the result card
 * renders `status`. Nothing is sent or queued here: the game syncs through
 * `SyncWorker` and the name through `displayNameSync`, and the adapter only
 * looks up where the finished game ranks (`sessionBoardAdapter`).
 *
 *   saved      — ranked; `rank` is set when the player's best entry is top 10
 *   offline    — the device is offline (or the lookup hit a network error);
 *                the hook asks again while the card is mounted
 *   needsName  — no display name yet; call `provideName()` (the card's
 *                one-time prompt) and the lookup runs
 *   unranked   — this game is on no board (the board is disabled, or the
 *                game can never rank); the card shows no leaderboard line
 *   error      — the lookup failed; `retry()` tries again
 */
export type LeaderboardSubmitStatus =
  "idle" | "submitting" | "saved" | "offline" | "needsName" | "unranked" | "error";

/**
 * What a `LeaderboardAdapter`'s `submit` found:
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
export interface LeaderboardAdapter<P> {
  /** For error reporting only. */
  gameType: GameType;
  /** Look the rank up. Throws on a failed request. */
  submit: (playerName: string, payload: P) => Promise<RankLookup>;
}

/**
 * How long the hook waits before asking again while online and unsettled —
 * then the last delay, repeated, until it settles.
 */
export const RANK_REFETCH_DELAYS_MS: readonly number[] = [5_000, 15_000, 60_000];

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

/** Only a top-10 rank is shown; anything else (or none) is no rank. */
export function topTenRank(rank: number | null | undefined): number | null {
  return rank != null && rank >= 1 && rank <= 10 ? rank : null;
}

export interface LeaderboardSubmitState<P> {
  status: LeaderboardSubmitStatus;
  /** Top-10 rank of the player's best entry on the board, else null. */
  rank: number | null;
  /**
   * Whether this game is the player's best entry (#2633). False only when the
   * adapter reports an earlier game as the best: the card then shows
   * "Your best: #N".
   */
  isBest: boolean;
  /** The display name the rank was looked up under. */
  playerName: string | null;
  /** Look up this game's rank. Later calls are ignored until `reset()`. */
  submit: (payload: P) => Promise<void>;
  /** Save a display name and run the lookup waiting on it. Resolves false if the name is invalid. */
  provideName: (name: string) => Promise<boolean>;
  /** Try the last lookup again after an `error`. */
  retry: () => Promise<void>;
  /** Forget this game's submission (call on new game). */
  reset: () => void;
}

export function useLeaderboardSubmit<P>(adapter: LeaderboardAdapter<P>): LeaderboardSubmitState<P> {
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
  // Bumped by reset(): a lookup still in flight from the previous game must
  // not write its status/rank over the new game's.
  const generationRef = useRef(0);
  // (#2677) `unsettled`: the rank is still wanted, set before each fetch so a
  // reconnect during one isn't lost. `inFlight`: one fetch at a time. The
  // timer asks again while online (backoff).
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

  /** Look the rank up under `name` with the current adapter: nothing is queued. */
  const send = useCallback(
    async (name: string, payload: P) => {
      const adapter = adapterRef.current;
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

  /** Looks the pending game up under the stored name, or asks for one. */
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

  // Back online with the rank still wanted: ask again (a fetch in flight
  // settles or reschedules itself). Nothing was queued, so an unmounted card
  // loses nothing.
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
