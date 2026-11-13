import { createJsonSlot } from "../_shared/storageSlot";
import AsyncStorage from "@react-native-async-storage/async-storage";

const SUBSYSTEM = "cascade.storage";

/** The current save format. v4 = the 12-tier ladder (#3695); v3 (old 10-tier ladder) is discarded. */
export const SAVE_VERSION = 4;

/** The pre-ladder save key. Its saves are discarded, not migrated (see `loadGame`). */
const LEGACY_V3_KEY = "cascade_game_v3";

export interface SavedState {
  version: 4;
  pieces: Array<{ tier: number; x: number; y: number }>;
  score: number;
  savedAt: number;
  queue: { current: number; next: number };
  /**
   * Play time so far, pauses excluded (#2750), so a relaunched game keeps it.
   * Absent in saves from older builds.
   */
  playedMs?: number;
}

export function looksValid(data: unknown): data is SavedState {
  if (typeof data !== "object" || data === null) return false;
  const d = data as Record<string, unknown>;
  if (
    d.version !== SAVE_VERSION ||
    !Array.isArray(d.pieces) ||
    !(d.pieces as unknown[]).every(
      (p) =>
        typeof p === "object" &&
        p !== null &&
        typeof (p as Record<string, unknown>).tier === "number" &&
        typeof (p as Record<string, unknown>).x === "number" &&
        typeof (p as Record<string, unknown>).y === "number"
    ) ||
    typeof d.score !== "number" ||
    typeof d.savedAt !== "number" ||
    (d.playedMs !== undefined && typeof d.playedMs !== "number")
  ) {
    return false;
  }
  const q = d.queue as Record<string, unknown> | undefined;
  return (
    typeof q === "object" &&
    q !== null &&
    typeof q.current === "number" &&
    typeof q.next === "number"
  );
}

const currentSlot = createJsonSlot<SavedState>({
  key: "cascade_game_v4",
  subsystem: SUBSYSTEM,
  isValid: looksValid,
  corruptExtra: "keyAndRaw",
});

export const saveGame = currentSlot.save;

async function discardLegacy(): Promise<void> {
  await AsyncStorage.removeItem(LEGACY_V3_KEY).catch(() => {});
}

/**
 * Loads the saved game (v4 only).
 *
 * A v3 save (key `cascade_game_v3`, the old 10-tier ladder) is DISCARDED, not migrated (#3695).
 * The new radii are mostly larger than the old ones (Cherry 16 to 22, Strawberry 22 to 29, Grape
 * 28 to 33, Pear 52 to 58, Melon 82 to 88; only Peach and Watermelon shrink) and the names do not
 * line up, so a restored full bin would start overlapping and be ejected or end the game.
 * Cascade has not shipped: only dev and test builds can hold a v3 save, so the cost is one
 * abandoned dev game. The old key is removed so it does not linger. A v4 key that is present but
 * invalid is discarded by the slot and never falls back to anything older.
 */
export async function loadGame(): Promise<SavedState | null> {
  const current = await currentSlot.load();
  await discardLegacy();
  return current;
}

export async function clearGame(): Promise<void> {
  await currentSlot.clear();
  await discardLegacy();
}

// The best score (#2515) is the shared personal best (`game/_shared/personalBest.ts`, #3757);
// its old key `cascade_best_score` is moved in there on the first read.
