import { useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Sentry from "@sentry/react-native";

/**
 * The player's public leaderboard name, as last assigned by the server.
 *
 * Since #2778 players never type a public name: joining the leaderboards
 * (`displayNameSync.joinLeaderboards`) makes the server generate one, e.g.
 * "Brave Otter 4821", and "Get a new name" asks it for another. This module is
 * only the device's copy of that name, so Profile, the result card and Hearts
 * can show it offline. A name here means "on the leaderboards"; null means
 * not (or not yet: a join may be waiting to sync).
 *
 * Kept in a module-level cache with listeners so every mounted
 * `useDisplayName()` sees a change at once. Only `displayNameSync.ts` writes
 * it, from server responses; see there for the offline behaviour.
 */

const STORAGE_KEY = "player_display_name";

let cached: string | null = null;
let loadPromise: Promise<string | null> | null = null;
const listeners = new Set<(name: string | null) => void>();

/** Stored text must be a non-blank string to count as a name. */
function clean(raw: string | null): string | null {
  const trimmed = raw?.trim();
  return trimmed ? trimmed : null;
}

/** Reads the stored name once per app run; later calls reuse the result. */
export function loadDisplayName(): Promise<string | null> {
  if (!loadPromise) {
    loadPromise = AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        cached = clean(raw);
        return cached;
      })
      .catch((e) => {
        Sentry.captureException(e, { tags: { subsystem: "displayName", op: "load" } });
        return null;
      });
  }
  return loadPromise;
}

/** The name as far as this app run knows it, without waiting for storage. */
export function getCachedDisplayName(): string | null {
  return cached;
}

function publish(name: string | null): void {
  cached = name;
  loadPromise = Promise.resolve(name);
  listeners.forEach((l) => l(name));
}

/**
 * Stores the name the server assigned (a join, a reroll, or a refresh from
 * `GET /players/me`). Resolves false if storage failed; the in-memory copy is
 * updated either way, since the server already holds this name.
 */
export async function storeAssignedDisplayName(name: string): Promise<boolean> {
  const value = clean(name);
  if (value == null) return false;
  publish(value);
  try {
    await AsyncStorage.setItem(STORAGE_KEY, value);
    return true;
  } catch (e) {
    Sentry.captureException(e, { tags: { subsystem: "displayName", op: "save" } });
    return false;
  }
}

/**
 * Forgets the name on this device (leaving the leaderboards, "Delete my
 * data", or the server saying the player isn't on them). Nothing is sent to
 * the server. Resolves false if storage failed.
 */
export async function clearDisplayName(): Promise<boolean> {
  try {
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch (e) {
    Sentry.captureException(e, { tags: { subsystem: "displayName", op: "clear" } });
    return false;
  }
  publish(null);
  return true;
}

/**
 * Test-only: forget the cached name so the next load re-reads storage.
 * @internal Exported for tests and offline tooling only; no production caller (knip --production, #3126).
 */
export function resetDisplayNameCacheForTests(): void {
  cached = null;
  loadPromise = null;
  listeners.clear();
}

export interface DisplayNameState {
  /** The server-assigned name, or null when not on the leaderboards (or not loaded yet). */
  name: string | null;
  /** False until the stored value has been read. */
  isLoaded: boolean;
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

  return { name, isLoaded };
}
