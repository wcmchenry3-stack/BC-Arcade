import { createJsonSlot } from "../_shared/storageSlot";
import AsyncStorage from "@react-native-async-storage/async-storage";

const SUBSYSTEM = "cascade.storage";

/**
 * The current save format. v6 = the constant-ratio ladder (#3904: radii 5-98). v5 (the lively
 * ladder on planck.js, #3697: radii 18-63), v4 (the #3695 ladder, radii 22-101, on Matter.js) and
 * v3 (the old 10-tier ladder) are discarded.
 */
export const SAVE_VERSION = 6;

/** Older save keys. Their saves are discarded, not migrated (see `loadGame`). */
const LEGACY_KEYS = ["cascade_game_v3", "cascade_game_v4", "cascade_game_v5"];

export interface SavedState {
  version: 6;
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
  key: "cascade_game_v6",
  subsystem: SUBSYSTEM,
  isValid: looksValid,
  corruptExtra: "keyAndRaw",
});

export const saveGame = currentSlot.save;

async function discardLegacy(): Promise<void> {
  await Promise.all(LEGACY_KEYS.map((key) => AsyncStorage.removeItem(key).catch(() => {})));
}

/**
 * Loads the saved game (v6 only).
 *
 * A v5 save (key `cascade_game_v5`, #3697's lively ladder) is DISCARDED, not migrated (#3904):
 * every radius changed (Cherry 18 to 5, Watermelon 56 to 74.8, the capstone 63 to 98), so its
 * positions would overlap or leave gaps, and a single capstone in it would now be half a win.
 * A v4 save (key `cascade_game_v4`, #3695's ladder on Matter.js) is DISCARDED, not migrated
 * (#3697). Every radius changed (Cherry 22 to 18, Orange 38 to 28, Watermelon 88 to 56, the
 * capstone 101 to 63), so restoring its positions would leave gaps a pile falls into and a
 * different board from the one that was saved, and its pile was built on the old physics. A v3
 * save (the 10-tier ladder) was already discarded by #3695 for the same reason. Cascade has not
 * shipped: only dev and test builds can hold an older save, so the cost is one abandoned dev
 * game. The old keys are removed so they do not linger. A v6 key that is present but invalid is
 * discarded by the slot and never falls back to anything older.
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
