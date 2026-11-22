/**
 * Sort's lobby tile status (#4008): a level to resume. No best is shown: Sort keeps one per level
 * (moves that cannot be compared across levels), so no single figure stands for the game.
 *
 * `isResumable` is the one rule for "Continue offered". The level grid's Continue button and the
 * tile's "Resume" status both use it, so the tile never says Resume where a tap would land on the
 * level grid. HomeScreen opens Sort with `resume: true` and the screen then runs its Continue.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

import { readSavedGame, type TileStatus } from "../_shared/lobbyStatus";
import { SORT_CATALOG_VERSION_KEY } from "../_shared/personalBestGames";
import { SORT_CATALOG_VERSION } from "./catalog";
import type { SortProgress } from "./storage";

const SORT_PROGRESS_KEY = "@sort/progress";

/** A saved board to continue: a level and its unfinished board, as the level grid's Continue needs. */
export function isResumable(
  progress: Pick<SortProgress, "currentLevelId" | "currentState"> | null
): boolean {
  return (
    !!progress &&
    progress.currentLevelId !== null &&
    progress.currentLevelId !== undefined &&
    progress.currentState !== null &&
    progress.currentState !== undefined &&
    !progress.currentState.isComplete
  );
}

function isProgressShape(p: unknown): p is SortProgress {
  if (p === null || typeof p !== "object") return false;
  const { currentLevelId, currentState } = p as Partial<SortProgress>;
  return (
    typeof currentLevelId === "number" &&
    Number.isInteger(currentLevelId) &&
    currentLevelId >= 1 &&
    currentState !== null &&
    typeof currentState === "object" &&
    Array.isArray(currentState.bottles)
  );
}

export async function getLobbyStatus(): Promise<TileStatus | undefined> {
  const saved = await readSavedGame(SORT_PROGRESS_KEY, isProgressShape);
  if (!isResumable(saved)) return undefined;
  // The screen drops a board from before the level catalog (or reads none from a newer one), so
  // the tile offers Resume only for a save on this build's catalog.
  try {
    const version = await AsyncStorage.getItem(SORT_CATALOG_VERSION_KEY);
    return version === String(SORT_CATALOG_VERSION) ? { kind: "resume" } : undefined;
  } catch {
    return undefined;
  }
}
