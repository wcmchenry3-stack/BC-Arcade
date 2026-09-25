import { useCallback, useEffect, useRef, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Sentry from "@sentry/react-native";
import { isPremiumLevel } from "../../entitlements/premiumLevels";

/**
 * The difficulty each game was last started at (#1129), so the next game's
 * picker opens on it instead of the game's default. One value per game.
 */

/** Storage key for `gameKey`. Star Swarm's pre-#1129 key already had this form. */
export function lastDifficultyKey(gameKey: string): string {
  return `${gameKey}.difficulty`;
}

/**
 * The stored difficulty of `gameKey`, or null when there is none, it is no
 * longer one of `levels`, or it is now a premium level.
 */
export async function loadLastDifficulty<T extends string>(
  gameKey: string,
  levels: readonly T[]
): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(lastDifficultyKey(gameKey));
    const level = levels.find((l) => l === raw);
    if (level === undefined || isPremiumLevel(gameKey, level)) return null;
    return level;
  } catch (e) {
    Sentry.captureException(e, { tags: { subsystem: "lastDifficulty", op: "load", gameKey } });
    return null;
  }
}

export async function saveLastDifficulty(gameKey: string, level: string): Promise<void> {
  try {
    await AsyncStorage.setItem(lastDifficultyKey(gameKey), level);
  } catch (e) {
    Sentry.captureException(e, { tags: { subsystem: "lastDifficulty", op: "save", gameKey } });
  }
}

export interface LastDifficulty<T extends string> {
  /** Starts at `fallback`, then the stored difficulty once it loads. */
  difficulty: T;
  /** Picks a difficulty without storing it (a tap in the picker). */
  setDifficulty: (level: T) => void;
  /** Picks and stores a difficulty. Call it when a game starts. */
  rememberDifficulty: (level: T) => void;
}

/**
 * A game's difficulty, restored from the last game on mount.
 *
 * A difficulty set before the stored one loads (a resumed save, or a tap)
 * wins, so the late read never overrides the player. Pass `restore: false`
 * when the screen already has a difficulty to show, e.g. a paused run.
 */
export function useLastDifficulty<T extends string>(
  gameKey: string,
  levels: readonly T[],
  fallback: T,
  { restore = true }: { restore?: boolean } = {}
): LastDifficulty<T> {
  const [difficulty, setState] = useState<T>(fallback);
  const chosenRef = useRef(false);

  useEffect(() => {
    if (!restore) return;
    let alive = true;
    void loadLastDifficulty(gameKey, levels).then((level) => {
      if (alive && level !== null && !chosenRef.current) setState(level);
    });
    return () => {
      alive = false;
    };
    // Restores once, on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setDifficulty = useCallback((level: T) => {
    chosenRef.current = true;
    setState(level);
  }, []);

  const rememberDifficulty = useCallback(
    (level: T) => {
      setDifficulty(level);
      void saveLastDifficulty(gameKey, level);
    },
    [gameKey, setDifficulty]
  );

  return { difficulty, setDifficulty, rememberDifficulty };
}
