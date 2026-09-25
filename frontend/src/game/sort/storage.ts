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
// Best moves per level (#2512) — shown as "Best" on the result card, and
// summed into the leaderboard's `total_moves` tie-break (#2625).
// ---------------------------------------------------------------------------

const BEST_MOVES_KEY = "@sort/best_moves";

/** Fewest moves per solved level, keyed by level id. */
export type BestMoves = Readonly<Record<string, number>>;

/** The stored best moves (`@sort/best_moves`); empty when unreadable. */
export async function loadBestMoves(): Promise<BestMoves> {
  try {
    const raw = await AsyncStorage.getItem(BEST_MOVES_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object" ? (parsed as BestMoves) : {};
  } catch {
    return {};
  }
}

export interface LevelSolve {
  /** The level's best (fewest) moves, including this solve. */
  readonly best: number;
  /** This solve set the best. */
  readonly isNewBest: boolean;
  /** No earlier solve of this level is on record. */
  readonly firstSolve: boolean;
}

/** A solve of `levelId` in `moves` against `bests`, and the bests after it. Pure. */
export function applyLevelSolve(
  bests: BestMoves,
  levelId: number,
  moves: number
): { solve: LevelSolve; bests: BestMoves } {
  const previous = bests[String(levelId)];
  const firstSolve = typeof previous !== "number";
  const isNewBest = firstSolve || moves < previous;
  if (!isNewBest) return { solve: { best: previous, isNewBest, firstSolve }, bests };
  return {
    solve: { best: moves, isNewBest, firstSolve },
    bests: { ...bests, [String(levelId)]: moves },
  };
}

/**
 * The leaderboard tie-break (#2625): the sum of the best moves of every level
 * from 1 to `throughLevel`. `null` when one of them has no best on record
 * (progress made before #2512 kept bests): a partial sum would rank ahead of
 * players who played every level, while a missing tie-break ranks last.
 */
export function totalBestMoves(bests: BestMoves, throughLevel: number): number | null {
  let total = 0;
  for (let level = 1; level <= throughLevel; level++) {
    const best = bests[String(level)];
    if (typeof best !== "number" || !Number.isInteger(best) || best < 0) return null;
    total += best;
  }
  return total;
}

/** Records a solve of `levelId` in `moves` in `@sort/best_moves`. */
export async function recordLevelSolve(levelId: number, moves: number): Promise<LevelSolve> {
  const { solve, bests } = applyLevelSolve(await loadBestMoves(), levelId, moves);
  if (!solve.isNewBest) return solve;
  try {
    await AsyncStorage.setItem(BEST_MOVES_KEY, JSON.stringify(bests));
  } catch {
    // Best-effort: the card still shows this solve as the best.
  }
  return solve;
}
