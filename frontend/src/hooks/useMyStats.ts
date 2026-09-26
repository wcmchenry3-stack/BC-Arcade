import { useCallback, useEffect, useRef, useState } from "react";
import * as Sentry from "@sentry/react-native";
import { statsApi, type StatsResponse } from "../api/stats";
import { flushQueuedGames } from "../game/_shared/flushQueuedGames";
import { ApiError, isNetworkError } from "../game/_shared/httpClient";
import { useNetwork } from "../game/_shared/NetworkContext";
import { withRetry } from "../game/_shared/withRetry";

/**
 *   loading — fetching, with nothing to show yet
 *   ready   — `stats` is the server's answer (or, with `stale`, the last one)
 *   offline — the device is offline and nothing was loaded before
 *   error   — the request failed while online and nothing was loaded before
 */
export type MyStatsStatus = "loading" | "ready" | "offline" | "error";

export interface MyStats {
  status: MyStatsStatus;
  stats: StatsResponse | null;
  /**
   * `stats` is the last good response from earlier in this app session: the
   * device is offline, or the latest request failed.
   */
  stale: boolean;
  /** A `refresh()` with stats already on screen is in flight. */
  refreshing: boolean;
  /** Ask again, showing `loading` (after `error` or `offline`). */
  retry: () => void;
  /** Ask again, keeping what's on screen until the answer lands (pull-to-refresh). */
  refresh: () => void;
}

// The last good `/stats/me` for this app session, so the stats screen opened
// offline, or when the request fails, still shows the player's figures
// (#2635). In memory only: nothing persists it across launches.
let lastGood: StatsResponse | null = null;

/** Test seam: forget the session's last good response. */
export function __resetMyStatsCacheForTests(): void {
  lastGood = null;
}

interface Loaded {
  status: MyStatsStatus;
  stats: StatsResponse | null;
  stale: boolean;
  refreshing: boolean;
}

/** What to show before (or instead of) an answer: the cache, else `fallback`. */
function fromCache(fallback: "loading" | "offline" | "error", refreshing = false): Loaded {
  return lastGood
    ? { status: "ready", stats: lastGood, stale: fallback !== "loading", refreshing }
    : { status: fallback, stats: null, stale: false, refreshing: false };
}

/**
 * The player's `GET /stats/me`, for the per-game stats screen (#2635).
 *
 * Queued games are uploaded first, so a game finished a moment ago counts.
 * Transient network failures are retried (`withRetry`). While NetInfo says the
 * device is offline nothing is requested; it asks again on reconnect. When
 * there is no fresh answer, the last good response from this app session is
 * shown with `stale` set; with none, the status is `offline` or `error`.
 */
export function useMyStats(): MyStats {
  const { isOnline, isInitialized } = useNetwork();
  const offline = isInitialized && !isOnline;
  const offlineRef = useRef(offline);
  offlineRef.current = offline;

  const [loaded, setLoaded] = useState<Loaded>(() => fromCache("loading"));
  const loadedRef = useRef(loaded);
  loadedRef.current = loaded;
  // Bumped per request and on unmount: only the latest request may land.
  const requestRef = useRef(0);

  const load = useCallback(async (silent: boolean) => {
    const request = ++requestRef.current;
    const current = () => request === requestRef.current;

    if (offlineRef.current) {
      setLoaded(fromCache("offline"));
      return;
    }
    const showing = loadedRef.current.status === "ready";
    if (silent && showing) setLoaded({ ...loadedRef.current, refreshing: true });
    else if (!showing) setLoaded(fromCache("loading"));
    try {
      await flushQueuedGames();
      const res = await withRetry(() => statsApi.getMyStats());
      if (!current()) return;
      lastGood = res;
      setLoaded({ status: "ready", stats: res, stale: false, refreshing: false });
    } catch (e) {
      if (!current()) return;
      // HTTP errors are breadcrumbed by httpClient and never captured (#513).
      if (!(e instanceof ApiError) && !isNetworkError(e)) {
        Sentry.captureException(e, { tags: { subsystem: "gameStats" } });
      }
      setLoaded(fromCache(offlineRef.current ? "offline" : "error"));
    }
  }, []);

  useEffect(() => {
    void load(false);
  }, [load]);

  // Back online with nothing fresh to show: ask again.
  const online = isInitialized && isOnline;
  useEffect(() => {
    const { status, stale } = loadedRef.current;
    if (online && (status === "offline" || stale)) void load(false);
  }, [online, load]);

  useEffect(
    () => () => {
      requestRef.current += 1;
    },
    []
  );

  const retry = useCallback(() => void load(false), [load]);
  const refresh = useCallback(() => void load(true), [load]);

  return { ...loaded, retry, refresh };
}
