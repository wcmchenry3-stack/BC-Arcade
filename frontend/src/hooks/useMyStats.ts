import { useCallback, useEffect, useRef, useState } from "react";
import * as Sentry from "@sentry/react-native";
import { statsApi, type StatsResponse } from "../api/stats";
import { flushQueuedGames } from "../game/_shared/flushQueuedGames";
import { ApiError, isNetworkError } from "../game/_shared/httpClient";
import { useNetwork } from "../game/_shared/NetworkContext";
import { getOrCreateSessionId, getSessionIdIfAny } from "../game/_shared/session";
import { withRetry } from "../game/_shared/withRetry";

/**
 *   loading — fetching, with nothing to show yet
 *   ready   — `stats` is on screen: the server's answer, or the session's
 *             last one (see `refreshing` and `stale`)
 *   offline — the device is offline and nothing was loaded before
 *   error   — the request failed while online and nothing was loaded before
 */
export type MyStatsStatus = "loading" | "ready" | "offline" | "error";

export interface MyStats {
  status: MyStatsStatus;
  stats: StatsResponse | null;
  /**
   * `stats` is the last good response for this session and could not be
   * brought up to date: the device is offline, or the latest request failed.
   */
  stale: boolean;
  /**
   * A request is in flight while `stats` is on screen: the last good
   * response shown while the fresh one loads, or a pull-to-refresh.
   */
  refreshing: boolean;
  /** Ask again, showing `loading` when there is nothing to show (after `error` or `offline`). */
  retry: () => void;
  /** Ask again, keeping what's on screen until the answer lands (pull-to-refresh). */
  refresh: () => void;
}

interface CacheEntry {
  /** The `X-Session-ID` the response belongs to. */
  sessionId: string;
  response: StatsResponse;
}

// The last good `/stats/me` for this app session, so the stats screen opened
// offline, or when the request fails, still shows the player's figures
// (#2635). In memory only: nothing persists it across launches. Keyed by the
// session, so a response never outlives "Delete my data" (which starts a new
// session) and is never shown to another session.
let cache: CacheEntry | null = null;
// Bumped by `clearMyStatsCache`: a request that started before a clear must
// not refill the cache when it lands.
let generation = 0;

/** Forget the remembered response ("Delete my data"; tests). */
export function clearMyStatsCache(): void {
  cache = null;
  generation += 1;
}

/**
 * Taken right before a `/stats/me` request: the clear generation and the
 * session the request is sent for. An answer is remembered only if neither
 * has changed by the time it lands, so a request in flight when "Delete my
 * data" runs can't file the deleted player's figures under the new session.
 */
export interface MyStatsToken {
  readonly generation: number;
  readonly sessionId: Promise<string | null>;
}

export function myStatsToken(): MyStatsToken {
  return {
    generation,
    // The session the request will carry (httpClient creates it the same way).
    sessionId: getOrCreateSessionId().catch(() => null),
  };
}

/** Keep `response` for the stats screen, unless the cache was cleared or the session changed since `token`. */
export async function rememberMyStats(response: StatsResponse, token: MyStatsToken): Promise<void> {
  try {
    const [then, now] = await Promise.all([token.sessionId, getSessionIdIfAny()]);
    if (then != null && then === now && token.generation === generation) {
      cache = { sessionId: now, response };
    }
  } catch {
    // Nothing remembered: the stats screen fetches for itself.
  }
}

/**
 * Runs `fetch` (a `/stats/me` request) and keeps its answer for the stats
 * screen (#2635), so Stats opened offline afterwards still has the player's
 * figures. Home and Profile wrap their own fetches in it. Resolves or rejects
 * as `fetch` does.
 */
export async function fetchAndRememberMyStats(
  fetch: () => Promise<StatsResponse>
): Promise<StatsResponse> {
  const token = myStatsToken();
  const response = await fetch();
  await rememberMyStats(response, token);
  return response;
}

/** The remembered response for `sessionId`, or null. */
function cachedFor(sessionId: string | null): StatsResponse | null {
  return cache != null && sessionId != null && cache.sessionId === sessionId
    ? cache.response
    : null;
}

interface Loaded {
  status: MyStatsStatus;
  stats: StatsResponse | null;
  stale: boolean;
  refreshing: boolean;
}

const LOADING: Loaded = { status: "loading", stats: null, stale: false, refreshing: false };

/**
 * The player's `GET /stats/me`, for the per-game stats screen (#2635).
 *
 * Queued games are uploaded first, so a game finished a moment ago counts.
 * Transient network failures are retried (`withRetry`). While NetInfo says the
 * device is offline nothing is requested.
 *
 * The last good response for the current session (from this hook, Home or
 * Profile: `fetchAndRememberMyStats`) is shown at once with `refreshing` set while the
 * fresh one loads. When the fresh one can't be had (offline, or the request
 * failed) it stays on screen with `stale` set; with nothing remembered, the
 * status is `offline` or `error`. When the device comes back online after
 * `offline`, `error` or a stale answer, it asks again.
 */
export function useMyStats(): MyStats {
  const { isOnline, isInitialized } = useNetwork();
  const offline = isInitialized && !isOnline;
  const offlineRef = useRef(offline);
  offlineRef.current = offline;

  const [loaded, setLoaded] = useState<Loaded>(LOADING);
  const loadedRef = useRef(loaded);
  loadedRef.current = loaded;
  // Bumped per request and on unmount: only the latest request may land.
  const requestRef = useRef(0);

  const load = useCallback(async () => {
    const request = ++requestRef.current;
    const current = () => request === requestRef.current;
    const token = myStatsToken();

    const sessionId = await getSessionIdIfAny();
    if (!current()) return;
    const cached = cachedFor(sessionId);
    const showing = loadedRef.current.status === "ready" ? loadedRef.current.stats : cached;

    if (offlineRef.current) {
      setLoaded(
        showing
          ? { status: "ready", stats: showing, stale: true, refreshing: false }
          : { status: "offline", stats: null, stale: false, refreshing: false }
      );
      return;
    }
    setLoaded(
      showing
        ? {
            status: "ready",
            stats: showing,
            stale: loadedRef.current.stale,
            refreshing: true,
          }
        : LOADING
    );
    try {
      await flushQueuedGames();
      const res = await withRetry(() => statsApi.getMyStats());
      if (!current()) return;
      await rememberMyStats(res, token);
      if (!current()) return;
      setLoaded({ status: "ready", stats: res, stale: false, refreshing: false });
    } catch (e) {
      if (!current()) return;
      // HTTP errors are breadcrumbed by httpClient and never captured (#513).
      if (!(e instanceof ApiError) && !isNetworkError(e)) {
        Sentry.captureException(e, { tags: { subsystem: "gameStats" } });
      }
      setLoaded(
        showing
          ? { status: "ready", stats: showing, stale: true, refreshing: false }
          : {
              status: offlineRef.current ? "offline" : "error",
              stats: null,
              stale: false,
              refreshing: false,
            }
      );
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Back online (an offline → online transition) with nothing fresh to show:
  // ask again.
  const online = isInitialized && isOnline;
  const wasOnlineRef = useRef(online);
  useEffect(() => {
    const cameOnline = online && !wasOnlineRef.current;
    wasOnlineRef.current = online;
    if (!cameOnline) return;
    const { status, stale } = loadedRef.current;
    if (status === "offline" || status === "error" || stale) void load();
  }, [online, load]);

  useEffect(
    () => () => {
      requestRef.current += 1;
    },
    []
  );

  const retry = useCallback(() => void load(), [load]);

  return { ...loaded, retry, refresh: retry };
}
