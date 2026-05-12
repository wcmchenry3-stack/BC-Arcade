import AsyncStorage from "@react-native-async-storage/async-storage";
import type { SortState } from "./types";

export interface SortProgress {
  readonly unlockedLevel: number;
  readonly currentLevelId: number | null;
  readonly currentState: SortState | null;
}

const STORAGE_KEY = "@sort/progress";
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
