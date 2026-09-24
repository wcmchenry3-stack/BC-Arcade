import AsyncStorage from "@react-native-async-storage/async-storage";
import type { SortState } from "./types";
import type { LevelsResponse } from "./api";

export interface SortProgress {
  readonly unlockedLevel: number;
  readonly currentLevelId: number | null;
  readonly currentState: SortState | null;
}

const STORAGE_KEY = "@sort/progress";
const LEVELS_CACHE_KEY = "@sort/levels_cache";
const DEFAULT: SortProgress = { unlockedLevel: 1, currentLevelId: null, currentState: null };

export async function saveProgress(data: SortProgress): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

export async function loadProgress(): Promise<SortProgress> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT;
    return JSON.parse(raw) as SortProgress;
  } catch {
    return DEFAULT;
  }
}

export async function clearGame(): Promise<void> {
  await AsyncStorage.removeItem(STORAGE_KEY);
}

export async function saveLevelsCache(data: LevelsResponse): Promise<void> {
  await AsyncStorage.setItem(LEVELS_CACHE_KEY, JSON.stringify(data));
}

export async function loadLevelsCache(): Promise<LevelsResponse | null> {
  try {
    const raw = await AsyncStorage.getItem(LEVELS_CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as LevelsResponse;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Best moves per level (#2512) — shown as "Best" on the result card.
// ---------------------------------------------------------------------------

const BEST_MOVES_KEY = "@sort/best_moves";

type BestMoves = Record<string, number>;

async function loadBestMoves(): Promise<BestMoves> {
  try {
    const raw = await AsyncStorage.getItem(BEST_MOVES_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object" ? (parsed as BestMoves) : {};
  } catch {
    return {};
  }
}

/**
 * Records a solve of `levelId` in `moves` and returns the level's best (fewest
 * moves) including this solve, and whether this solve set it.
 */
export async function recordLevelSolve(
  levelId: number,
  moves: number
): Promise<{ best: number; isNewBest: boolean }> {
  const all = await loadBestMoves();
  const previous = all[String(levelId)];
  const isNewBest = typeof previous !== "number" || moves < previous;
  if (!isNewBest) return { best: previous, isNewBest };
  try {
    await AsyncStorage.setItem(BEST_MOVES_KEY, JSON.stringify({ ...all, [levelId]: moves }));
  } catch {
    // Best-effort: the card still shows this solve as the best.
  }
  return { best: moves, isNewBest };
}
