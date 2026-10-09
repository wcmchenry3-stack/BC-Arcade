import { useCallback, useEffect, useRef, useState } from "react";
import * as Sentry from "@sentry/react-native";
import type { GameType } from "./types";
import { useNetwork } from "./NetworkContext";
import { getCachedDisplayName, loadDisplayName } from "./displayName";
import { getLeaderboardSyncPending, joinLeaderboards } from "./displayNameSync";
import { ApiError, isNetworkError } from "./httpClient";
import { lookupGameRank, type RankLookup } from "./lookupGameRank";

/**
 * The result card's leaderboard line under the player's display name (#2503,
 * #2677, #2990).
 *
 * A game calls `lookup(gameId)` once when it ends, and the result card
 * renders `status`. Nothing is sent or queued here: the game syncs through
 * `SyncWorker` and the leaderboard join through `displayNameSync`, and the
 * hook only looks up where the finished game ranks (`lookupGameRank`).
 *
 *   saved      — ranked; `rank` is set when the player's best entry is top 10
 *   offline    — the device is offline (or the lookup hit a network error);
 *                the hook asks again while the card is mounted
 *   needsName  — not on the leaderboards; call `joinLeaderboards()` (the
 *                card's one-time "Join leaderboards" prompt, #2778) and the
 *                lookup runs under the name the server generates
 *   unranked   — this game is on no board (the board is disabled, or the
 *                game can never rank); the card shows no leaderboard line
 *   error      — the lookup failed; `retry()` tries again
 *
 * Until the lookup settles (`ranked`, `unranked`, `needsName`, or an HTTP
 * error, which is `error` with `retry()`), the hook keeps asking while the
 * card is mounted: on the next offline→online edge, and while online on a
 * backoff timer (`RANK_REFETCH_DELAYS_MS`). Offline or on a network failure
 * the status is `offline`; on `pending` it stays `submitting`.
 */
export type RankLookupStatus =
  "idle" | "submitting" | "saved" | "offline" | "needsName" | "unranked" | "error";

/**
 * The old name of `RankLookupStatus`, kept for one release.
 * @public
 * @deprecated Use `RankLookupStatus`.
 */
export type LeaderboardSubmitStatus = RankLookupStatus;

/**
 * How long the hook waits before asking again while online and unsettled —
 * then the last delay, repeated, until it settles.
 */
export const RANK_REFETCH_DELAYS_MS: readonly number[] = [5_000, 15_000, 60_000];

/** Only a top-10 rank is shown; anything else (or none) is no rank. */
export function topTenRank(rank: number | null | undefined): number | null {
  return rank != null && rank >= 1 && rank <= 10 ? rank : null;
}

export interface GameRankState {
  status: RankLookupStatus;
  /** Top-10 rank of the player's best entry on the board, else null. */
  rank: number | null;
  /**
   * Whether this game is the player's best entry (#2633). False only when the
   * lookup reports an earlier game as the best: the card then shows
   * "Your best: #N".
   */
  isBest: boolean;
  /** The player's (server-generated) leaderboard name, once known. */
  playerName: string | null;
  /** Look up this game's rank. Later calls are ignored until `reset()`. */
  lookup: (gameId: string) => Promise<void>;
  /**
   * Join the leaderboards (the player's explicit opt-in, #2778) and run the
   * lookup waiting on it. Resolves false if the join couldn't be stored.
   */
  joinLeaderboards: () => Promise<boolean>;
  /** Try the last lookup again after an `error`. */
  retry: () => Promise<void>;
  /** Forget this game's submission (call on new game). */
  reset: () => void;
}

/** The rank lookup of `gameType`'s finished game, for the result card. */
export function useGameRank(gameType: GameType): GameRankState {
  const { isOnline, isInitialized } = useNetwork();
  const [status, setStatus] = useState<RankLookupStatus>("idle");
  const [rank, setRank] = useState<number | null>(null);
  const [isBest, setIsBest] = useState(true);
  const [playerName, setPlayerName] = useState<string | null>(null);

  // Refs so the callbacks stay stable and see the latest values.
  const gameTypeRef = useRef(gameType);
  gameTypeRef.current = gameType;
  const offlineRef = useRef(false);
  offlineRef.current = isInitialized && !isOnline;
  const pendingRef = useRef<{ gameId: string } | null>(null);
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

  /** Look the rank up under `name`: nothing is queued. */
  const send = useCallback(
    async (name: string, gameId: string) => {
      const generation = generationRef.current;
      const isCurrent = () => generationRef.current === generation;
      clearTimer();
      setPlayerName(name || null);
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

      let found: RankLookup | null = null;
      let failure: unknown = null;
      try {
        found = await lookupGameRank(gameId);
      } catch (e) {
        failure = e;
      }
      if (!isCurrent()) return;
      inFlightRef.current = false;

      let settled = true;
      if (found != null) {
        switch (found.kind) {
          case "ranked":
            // A join confirmed during the lookup has brought the generated name.
            setPlayerName(getCachedDisplayName() ?? (name || null));
            setRank(topTenRank(found.rank));
            setIsBest(found.isBest ?? true);
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
            tags: { subsystem: "leaderboardSubmit", gameType: gameTypeRef.current },
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

  /**
   * Looks the pending game up under the stored name (or a join still on its
   * way to the server), or asks the player to join.
   */
  const sendPending = useCallback(async () => {
    const pending = pendingRef.current;
    if (!pending) return;
    const generation = generationRef.current;
    const name = await loadDisplayName();
    const joining = name == null && (await getLeaderboardSyncPending()) === "join";
    if (generationRef.current !== generation) return;
    if (!name && !joining) {
      setStatus("needsName");
      return;
    }
    await send(name ?? "", pending.gameId);
  }, [send]);
  sendPendingRef.current = sendPending;

  const lookup = useCallback(
    async (gameId: string) => {
      if (startedRef.current) return;
      startedRef.current = true;
      pendingRef.current = { gameId };
      await sendPending();
    },
    [sendPending]
  );

  const join = useCallback(async () => {
    const generation = generationRef.current;
    if (!(await joinLeaderboards())) return false;
    const pending = pendingRef.current;
    if (pending && generationRef.current === generation) {
      await send(getCachedDisplayName() ?? "", pending.gameId);
    }
    return true;
  }, [send]);

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

  return { status, rank, isBest, playerName, lookup, joinLeaderboards: join, retry, reset };
}
