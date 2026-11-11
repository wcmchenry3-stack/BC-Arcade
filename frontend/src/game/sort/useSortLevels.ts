/**
 * useSortLevels (#2981) — the Sort screen's data: which view it shows, the
 * level definitions and the player's progress. Loads on mount.
 *
 * The levels are the fixed catalog shipped in the app (#2761, `catalog.ts`):
 * nothing is fetched, so there is no load error and no offline cache. Only
 * the player's progress and best moves are read from storage, after the save
 * has been moved onto the catalog (`migrateToCatalog`). The stored best moves
 * are handed to `onStoredBests`, which the screen merges into its in-memory
 * bests; they are withheld when the migration failed, since they may still
 * be bests on the old random levels.
 */
import { useEffect, useRef, useState } from "react";

import { SORT_LEVELS, type CatalogLevel } from "./catalog";
import { migrateToCatalog } from "./catalogMigration";
import { loadBestMoves, loadProgress, type BestMoves, type SortProgress } from "./storage";

type SortView = "loading" | "select" | "play";

interface SortLevelsOptions {
  /** The stored best moves, when storage could be read. */
  readonly onStoredBests: (stored: BestMoves) => void;
}

export function useSortLevels({ onStoredBests }: SortLevelsOptions) {
  const [view, setView] = useState<SortView>("loading");
  const levels: readonly CatalogLevel[] = SORT_LEVELS;
  const [progress, setProgress] = useState<SortProgress>({
    unlockedLevel: 1,
    currentLevelId: null,
    currentState: null,
  });
  const onStoredBestsRef = useRef(onStoredBests);
  useEffect(() => {
    onStoredBestsRef.current = onStoredBests;
  });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const migrated = await migrateToCatalog();
      const [prog, stored] = await Promise.all([loadProgress(), loadBestMoves()]);
      if (cancelled) return;
      if (migrated && stored !== null) onStoredBestsRef.current(stored);
      // Unmigrated (storage failed): an unfinished board may be an old random deal.
      setProgress(migrated ? prog : { ...prog, currentLevelId: null, currentState: null });
      setView("select");
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { view, setView, levels, progress, setProgress };
}
