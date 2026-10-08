/**
 * useSortLevels (#2981) — the Sort screen's data: which view it shows, the
 * level definitions, the player's progress and whether the levels failed to
 * load. Loads on mount; `loadScreen` is the error banner's Retry.
 *
 * Levels come from the API (with retry) and are cached for offline play. The
 * cache is served only on a network failure: an HTTP error such as a 401
 * means the server is denying access (an expired entitlement), and the cache
 * must not bypass that. The stored best moves load alongside and are handed
 * to `onStoredBests`, which the screen merges into its in-memory bests.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { isNetworkError } from "../_shared/httpClient";
import { withRetry } from "../_shared/withRetry";
import { sortApi, type LevelData } from "./api";
import {
  loadBestMoves,
  loadLevelsCache,
  loadProgress,
  saveLevelsCache,
  type BestMoves,
  type SortProgress,
} from "./storage";

type SortView = "loading" | "select" | "play";

interface SortLevelsOptions {
  /** The stored best moves, when storage could be read. */
  readonly onStoredBests: (stored: BestMoves) => void;
}

export function useSortLevels({ onStoredBests }: SortLevelsOptions) {
  const [view, setView] = useState<SortView>("loading");
  const [levels, setLevels] = useState<LevelData[]>([]);
  const [loadError, setLoadError] = useState(false);
  const [progress, setProgress] = useState<SortProgress>({
    unlockedLevel: 1,
    currentLevelId: null,
    currentState: null,
  });
  const onStoredBestsRef = useRef(onStoredBests);
  useEffect(() => {
    onStoredBestsRef.current = onStoredBests;
  });

  const loadScreen = useCallback(async () => {
    setLoadError(false);
    setView("loading");
    const [levelsResult, prog, stored] = await Promise.all([
      withRetry(() => sortApi.getLevels())
        .then((result) => {
          // Cache the level definitions for offline use. Fire-and-forget —
          // don't block the render on the AsyncStorage write.
          saveLevelsCache(result).catch(() => {});
          return result;
        })
        // Only serve cached levels on network failures (isNetworkError). HTTP errors
        // such as 401 Unauthorized mean the server is actively denying access
        // (e.g. entitlement expired) — falling back to cache would bypass that.
        .catch((e) => (isNetworkError(e) ? loadLevelsCache() : null)),
      loadProgress(),
      loadBestMoves(),
    ]);
    if (stored !== null) onStoredBestsRef.current(stored);
    if (!levelsResult) {
      setLoadError(true);
    } else {
      setLevels(levelsResult.levels as LevelData[]);
    }
    setProgress(prog);
    setView("select");
  }, []);

  useEffect(() => {
    void loadScreen();
  }, [loadScreen]);

  /** Silently refetches the levels, so the next session gets new mixtures. */
  const refreshLevels = useCallback(() => {
    void sortApi
      .getLevels()
      .then((res) => setLevels(res.levels as LevelData[]))
      .catch(() => {});
  }, []);

  return { view, setView, levels, loadError, progress, setProgress, loadScreen, refreshLevels };
}
