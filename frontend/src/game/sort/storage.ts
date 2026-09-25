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
//
// The screen keeps the bests in memory (loaded with it, merged on Retry) and
// decides every solve from there; storage only mirrors them. Nothing reads
// storage to decide a solve, so a failed read can never overwrite the bests.
// ---------------------------------------------------------------------------

const BEST_MOVES_KEY = "@sort/best_moves";

/** Fewest moves per solved level, keyed by level id. */
export type BestMoves = Readonly<Record<string, number>>;

function isMoveCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/**
 * The stored best moves (`@sort/best_moves`). `null` when storage could not
 * be read: the caller must then not write over what it can't see. A missing
 * or corrupt value reads as no bests, since nothing in it can be recovered.
 */
export async function loadBestMoves(): Promise<BestMoves | null> {
  let raw: string | null;
  try {
    raw = await AsyncStorage.getItem(BEST_MOVES_KEY);
  } catch {
    return null;
  }
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const bests: Record<string, number> = {};
    for (const [level, moves] of Object.entries(parsed)) {
      if (isMoveCount(moves)) bests[level] = moves;
    }
    return bests;
  } catch {
    return {};
  }
}

/** Replaces the stored bests with `bests`. Best-effort: resolves false on failure. */
export async function saveBestMoves(bests: BestMoves): Promise<boolean> {
  try {
    await AsyncStorage.setItem(BEST_MOVES_KEY, JSON.stringify(bests));
    return true;
  } catch {
    return false;
  }
}

/** Both sets of bests in one: the lower value per level wins. Pure. */
export function mergeBestMoves(a: BestMoves, b: BestMoves): BestMoves {
  const merged: Record<string, number> = { ...a };
  for (const [level, moves] of Object.entries(b)) {
    const current = merged[level];
    if (!isMoveCount(current) || moves < current) merged[level] = moves;
  }
  return merged;
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

/** The highest level id `bests` records a solve for, or 0. Pure. */
export function highestSolvedLevel(bests: BestMoves): number {
  let highest = 0;
  for (const [level, moves] of Object.entries(bests)) {
    const id = Number(level);
    if (Number.isInteger(id) && id > highest && isMoveCount(moves)) highest = id;
  }
  return highest;
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
    if (!isMoveCount(best)) return null;
    total += best;
  }
  return total;
}
