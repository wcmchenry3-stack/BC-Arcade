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
