import { useCallback, useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Sentry from "@sentry/react-native";

/**
 * The player's display name (#2502): the one name leaderboard submissions go
 * out under, set on the Profile screen (or by the one-time prompt on the
 * end-of-game result card) instead of typed into every game's win modal.
 *
 * Kept in a module-level cache with listeners so every mounted
 * `useDisplayName()` — Profile, a result card, Hearts — sees a save at once.
 */

const STORAGE_KEY = "player_display_name";
/** Matches the backend `player_name` limits (`min_length=1, max_length=32`). */
export const DISPLAY_NAME_MAX_LENGTH = 32;

/** Trims `raw`; returns it if it is 1–32 characters, otherwise null. */
export function normalizeDisplayName(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > DISPLAY_NAME_MAX_LENGTH) return null;
  return trimmed;
}

let cached: string | null = null;
let loadPromise: Promise<string | null> | null = null;
const listeners = new Set<(name: string | null) => void>();

/** Reads the stored name once per app run; later calls reuse the result. */
export function loadDisplayName(): Promise<string | null> {
  if (!loadPromise) {
    loadPromise = AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        cached = raw == null ? null : normalizeDisplayName(raw);
        return cached;
      })
      .catch((e) => {
        Sentry.captureException(e, { tags: { subsystem: "displayName", op: "load" } });
        return null;
      });
  }
  return loadPromise;
}

/**
 * Validates and persists `raw`. Resolves to the saved (trimmed) name, or null
 * when the name is invalid or storage failed — nothing is changed then.
 */
export async function saveDisplayName(raw: string): Promise<string | null> {
  const name = normalizeDisplayName(raw);
  if (name == null) return null;
  try {
    await AsyncStorage.setItem(STORAGE_KEY, name);
  } catch (e) {
    Sentry.captureException(e, { tags: { subsystem: "displayName", op: "save" } });
    return null;
  }
  cached = name;
  loadPromise = Promise.resolve(name);
  listeners.forEach((l) => l(name));
  return name;
}

/** Test-only: forget the cached name so the next load re-reads storage. */
export function resetDisplayNameCacheForTests(): void {
  cached = null;
  loadPromise = null;
  listeners.clear();
}

export interface DisplayNameState {
  /** The saved name, or null when none is set (or not loaded yet). */
  name: string | null;
  /** False until the stored value has been read. */
  isLoaded: boolean;
  /** Validates and saves; resolves to the saved name or null if rejected. */
  setName: (raw: string) => Promise<string | null>;
}

export function useDisplayName(): DisplayNameState {
  const [name, setNameState] = useState<string | null>(cached);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    listeners.add(setNameState);
    loadDisplayName().then((loaded) => {
      if (!active) return;
      setNameState(loaded);
      setIsLoaded(true);
    });
    return () => {
      active = false;
      listeners.delete(setNameState);
    };
  }, []);

  const setName = useCallback((raw: string) => saveDisplayName(raw), []);

  return { name, isLoaded, setName };
}
