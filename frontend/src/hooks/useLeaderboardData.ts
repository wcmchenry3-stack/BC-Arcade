import { useCallback, useEffect, useRef, useState } from "react";
import * as Sentry from "@sentry/react-native";
import { statsApi, type GameLeaderboardEntry } from "../api/stats";
import type { GameType } from "../api/vocab";
import { ApiError, isNetworkError } from "../game/_shared/httpClient";
import { useNetwork } from "../game/_shared/NetworkContext";
import { withRetry } from "../game/_shared/withRetry";

/** How many players the leaderboard screen lists (the server allows 1–100). */
export const LEADERBOARD_TOP_N = 50;

/**
 *   loading — fetching this board
 *   ready   — `entries` and `me` are this board's
 *   offline — the device is offline, or the request failed at the network
 *             layer after its retries; fetched again on reconnect
 *   error   — the server refused or failed (4xx/5xx); `retry()` asks again
 */
export type LeaderboardDataStatus = "loading" | "ready" | "offline" | "error";

export interface LeaderboardData {
  status: LeaderboardDataStatus;
  /** The top `LEADERBOARD_TOP_N` players, best first; the caller's row has `is_me`. */
  entries: readonly GameLeaderboardEntry[];
  /** The caller's own best entry with its exact rank, or null when they have none. */
  me: GameLeaderboardEntry | null;
  /** Fetch the board again (after `error` or `offline`). */
  retry: () => void;
}

interface Loaded {
  /** The board these rows belong to (`boardKey`). */
  key: string;
  status: LeaderboardDataStatus;
  entries: readonly GameLeaderboardEntry[];
  me: GameLeaderboardEntry | null;
}

const NO_ENTRIES: readonly GameLeaderboardEntry[] = [];

function boardKey(gameType: GameType, partition: Readonly<Record<string, string>>): string {
  return `${gameType}?${JSON.stringify(partition)}`;
}

/**
 * One game's leaderboard, for `LeaderboardScreen` (#2633): `GET
 * /games/leaderboard/{gameType}` with the board's partition as query params,
 * top `LEADERBOARD_TOP_N`. The server flags the caller's row (`is_me`) and
 * returns their best entry as `me`, so nothing is matched by name.
 *
 * Transient network failures are retried (`withRetry`). Offline, nothing is
 * requested and the status is `offline`; the board is fetched again as soon
 * as the device reconnects. A new `gameType` or partition shows `loading` at
 * once (never the previous board's rows), and a response for a board the
 * player has since left is dropped.
 */
export function useLeaderboardData(
  gameType: GameType,
  partition: Readonly<Record<string, string>>
): LeaderboardData {
  const { isOnline, isInitialized } = useNetwork();
  const offlineRef = useRef(false);
  offlineRef.current = isInitialized && !isOnline;

  const key = boardKey(gameType, partition);
  const partitionRef = useRef(partition);
  partitionRef.current = partition;

  const [loaded, setLoaded] = useState<Loaded>({
    key,
    status: "loading",
    entries: NO_ENTRIES,
    me: null,
  });
  const statusRef = useRef<LeaderboardDataStatus>("loading");
  // Bumped per request and on unmount: only the latest request may land.
  const requestRef = useRef(0);

  const load = useCallback(async () => {
    const request = ++requestRef.current;
    const settle = (
      status: LeaderboardDataStatus,
      entries: readonly GameLeaderboardEntry[] = NO_ENTRIES,
      me: GameLeaderboardEntry | null = null
    ) => {
      statusRef.current = status;
      setLoaded({ key, status, entries, me });
    };

    if (offlineRef.current) {
      settle("offline");
      return;
    }
    settle("loading");
    try {
      const res = await withRetry(() =>
        statsApi.getLeaderboard(gameType, partitionRef.current, { limit: LEADERBOARD_TOP_N })
      );
      if (request !== requestRef.current) return;
      settle("ready", res.entries, res.me ?? null);
    } catch (e) {
      if (request !== requestRef.current) return;
      if (offlineRef.current || isNetworkError(e)) {
        settle("offline");
        return;
      }
      // HTTP errors are breadcrumbed by httpClient and never captured (#513).
      if (!(e instanceof ApiError)) {
        Sentry.captureException(e, { tags: { subsystem: "leaderboard", gameType } });
      }
      settle("error");
    }
  }, [gameType, key]);

  useEffect(() => {
    void load();
  }, [load]);

  // Back online with no board to show: fetch it.
  const online = isInitialized && isOnline;
  useEffect(() => {
    if (online && statusRef.current === "offline") void load();
  }, [online, load]);

  useEffect(
    () => () => {
      requestRef.current += 1;
    },
    []
  );

  const retry = useCallback(() => void load(), [load]);

  // Until the effect for a new board runs, show it as loading, not the old rows.
  if (loaded.key !== key) return { status: "loading", entries: NO_ENTRIES, me: null, retry };
  return { status: loaded.status, entries: loaded.entries, me: loaded.me, retry };
}
