import { useCallback, useEffect, useRef, useState } from "react";
import * as Sentry from "@sentry/react-native";
import { statsApi, type GameLeaderboardEntry } from "../api/stats";
import type { GameType } from "../api/vocab";
import { ApiError, isNetworkError } from "../game/_shared/httpClient";
import { useNetwork } from "../game/_shared/NetworkContext";
import { withRetry } from "../game/_shared/withRetry";
import { partitionKey, useStablePartition, type Partition } from "../game/_shared/boardPartition";

/** How many players the leaderboard screen lists (the server allows 1–100). */
export const LEADERBOARD_TOP_N = 50;

/**
 *   loading — fetching this board, with nothing of it to show yet
 *   ready   — `entries` and `me` are this board's
 *   offline — the device is offline (NetInfo); fetched again on reconnect
 *   error   — the request failed while online (the server refused or failed,
 *             or the network did after its retries); `retry()` asks again
 */
export type LeaderboardDataStatus = "loading" | "ready" | "offline" | "error";

export interface LeaderboardData {
  status: LeaderboardDataStatus;
  /** The top `LEADERBOARD_TOP_N` players, best first; the caller's row has `is_me`. */
  entries: readonly GameLeaderboardEntry[];
  /** The caller's own best entry with its exact rank, or null when they have none. */
  me: GameLeaderboardEntry | null;
  /** A `refresh()` of a board already on screen is in flight. */
  refreshing: boolean;
  /** Fetch the board again, showing `loading` (after `error` or `offline`). */
  retry: () => void;
  /**
   * Fetch the board again, keeping the rows on screen until the new ones land
   * (focus, pull-to-refresh, after a sync). A failure keeps the old rows.
   */
  refresh: () => void;
}

interface Loaded {
  /** The board these rows belong to (`boardKey`). */
  key: string;
  status: LeaderboardDataStatus;
  entries: readonly GameLeaderboardEntry[];
  me: GameLeaderboardEntry | null;
  refreshing: boolean;
}

const NO_ENTRIES: readonly GameLeaderboardEntry[] = [];

/** Thrown into `withRetry` to end the retries of a request that was superseded. */
class Superseded extends Error {}

/**
 * One game's leaderboard, for `LeaderboardScreen` (#2633): `GET
 * /games/leaderboard/{gameType}` with the board's partition as query params,
 * top `LEADERBOARD_TOP_N`. The server flags the caller's row (`is_me`) and
 * returns their best entry as `me`, so nothing is matched by name.
 *
 * Transient network failures are retried (`withRetry`). While NetInfo says
 * the device is offline nothing is requested and the status is `offline`;
 * the board is fetched as soon as it reconnects. A failure while online is
 * `error` (with `retry()`), never `offline`, so it can't wait for a
 * reconnect that never comes. A new `gameType` or partition shows `loading`
 * at once (never the previous board's rows); a superseded request stops
 * retrying and its answer is dropped.
 */
export function useLeaderboardData(gameType: GameType, partition: Partition): LeaderboardData {
  const { isOnline, isInitialized } = useNetwork();
  const offlineRef = useRef(false);
  offlineRef.current = isInitialized && !isOnline;

  const board = useStablePartition(partition);
  const key = `${gameType}?${partitionKey(board)}`;

  const [loaded, setLoaded] = useState<Loaded>({
    key,
    status: "loading",
    entries: NO_ENTRIES,
    me: null,
    refreshing: false,
  });
  const loadedRef = useRef(loaded);
  loadedRef.current = loaded;
  // Bumped per request and on unmount: only the latest request may land.
  const requestRef = useRef(0);

  const load = useCallback(
    async (silent: boolean) => {
      const request = ++requestRef.current;
      const current = () => request === requestRef.current;
      const previous = loadedRef.current;
      // A refresh keeps this board's rows on screen while it runs.
      const keep = silent && previous.key === key && previous.status === "ready";
      const settle = (next: Omit<Loaded, "key" | "refreshing">) =>
        setLoaded({ key, refreshing: false, ...next });

      if (offlineRef.current) {
        if (!keep) settle({ status: "offline", entries: NO_ENTRIES, me: null });
        return;
      }
      if (keep) setLoaded({ ...previous, refreshing: true });
      else settle({ status: "loading", entries: NO_ENTRIES, me: null });
      try {
        const res = await withRetry(() => {
          // A superseded request's retries stop here, before asking again.
          if (!current()) throw new Superseded();
          return statsApi.getLeaderboard(gameType, board, { limit: LEADERBOARD_TOP_N });
        });
        if (!current()) return;
        settle({ status: "ready", entries: res.entries, me: res.me ?? null });
      } catch (e) {
        if (!current()) return;
        // HTTP errors are breadcrumbed by httpClient and never captured (#513).
        if (!(e instanceof ApiError) && !isNetworkError(e)) {
          Sentry.captureException(e, { tags: { subsystem: "leaderboard", gameType } });
        }
        if (keep) {
          setLoaded({ ...previous, refreshing: false });
          return;
        }
        settle({
          status: offlineRef.current ? "offline" : "error",
          entries: NO_ENTRIES,
          me: null,
        });
      }
    },
    [gameType, board, key]
  );

  useEffect(() => {
    void load(false);
  }, [load]);

  // Back online with no board to show: fetch it.
  const online = isInitialized && isOnline;
  useEffect(() => {
    if (online && loadedRef.current.status === "offline") void load(false);
  }, [online, load]);

  useEffect(
    () => () => {
      requestRef.current += 1;
    },
    []
  );

  const retry = useCallback(() => void load(false), [load]);
  const refresh = useCallback(() => void load(true), [load]);

  // Until the effect for a new board runs, show it as loading, not the old rows.
  if (loaded.key !== key) {
    return { status: "loading", entries: NO_ENTRIES, me: null, refreshing: false, retry, refresh };
  }
  const { status, entries, me, refreshing } = loaded;
  return { status, entries, me, refreshing, retry, refresh };
}
