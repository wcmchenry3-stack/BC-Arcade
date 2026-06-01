/**
 * useLeaderboard — shared hook for fetching and caching leaderboard data.
 *
 * Fetches from `endpoint` on mount, caches the result in AsyncStorage under
 * `cacheKey`, and re-fetches automatically when connectivity is restored.
 *
 * Usage
 * -----
 *   const { data, loading, error, refetch } = useLeaderboard(
 *     () => sudokuApi.getLeaderboard("easy"),
 *     "leaderboard_sudoku_easy"
 *   );
 */

import { useCallback, useEffect, useRef, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useNetwork } from "./NetworkContext";
import { withRetry } from "./withRetry";

export interface UseLeaderboardResult<T> {
  data: T | null;
  loading: boolean;
  /** True when we're offline and have no cached data. */
  offline: boolean;
  refetch: () => void;
}

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface CacheEntry<T> {
  data: T;
  fetchedAt: number;
}

export function useLeaderboard<T>(
  fetcher: () => Promise<T>,
  cacheKey: string
): UseLeaderboardResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  const { isOnline, isInitialized } = useNetwork();
  const wasOnlineRef = useRef<boolean>(isOnline);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const fetch = useCallback(async () => {
    setLoading(true);
    setOffline(false);

    // Try cache first.
    try {
      const raw = await AsyncStorage.getItem(cacheKey);
      if (raw) {
        const entry = JSON.parse(raw) as CacheEntry<T>;
        const age = Date.now() - entry.fetchedAt;
        if (age < CACHE_TTL_MS) {
          setData(entry.data);
          setLoading(false);
          return;
        }
      }
    } catch {
      // Cache miss — proceed to network fetch.
    }

    // Network fetch — retry up to 3× on transient TypeError failures.
    try {
      const result = await withRetry(() => fetcherRef.current());
      setData(result);
      setOffline(false);
      const entry: CacheEntry<T> = { data: result, fetchedAt: Date.now() };
      AsyncStorage.setItem(cacheKey, JSON.stringify(entry)).catch(() => undefined);
    } catch {
      // Fetch failed — check if we have stale cache.
      try {
        const raw = await AsyncStorage.getItem(cacheKey);
        if (raw) {
          const entry = JSON.parse(raw) as CacheEntry<T>;
          setData(entry.data);
        } else {
          setOffline(true);
        }
      } catch {
        setOffline(true);
      }
    } finally {
      setLoading(false);
    }
  }, [cacheKey]);

  // Initial fetch on mount.
  useEffect(() => {
    fetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Refetch when connectivity is restored (offline → online transition).
  useEffect(() => {
    if (!isInitialized) return;
    const wasOnline = wasOnlineRef.current;
    wasOnlineRef.current = isOnline;
    if (!wasOnline && isOnline) {
      fetch();
    }
  }, [isOnline, isInitialized, fetch]);

  return { data, loading, offline, refetch: fetch };
}
