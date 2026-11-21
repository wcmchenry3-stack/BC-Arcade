import { createJsonSlot } from "../_shared/storageSlot";
import AsyncStorage from "@react-native-async-storage/async-storage";

const SUBSYSTEM = "cascade.storage";

/**
 * The current save format. v8 = the 12-tier ladder (#3960: radii 11.5-98, the Moon back at tier 1,
 * a new tier 2, every tier above 0 a different piece or size). v7 (the 11-tier ladder, #3920:
 * radii 11.5-98, the Peach and the Moon removed), v6 (#3904's 12-tier ladder, radii 5-98), v5 (the lively ladder on planck.js, #3697:
 * radii 18-63), v4 (the #3695 ladder, radii 22-101, on Matter.js) and v3 (the old 10-tier ladder)
 * are discarded.
 */
export const SAVE_VERSION = 8;

/** Older save keys. Their saves are discarded, not migrated (see `loadGame`). */
const LEGACY_KEYS = [
  "cascade_game_v3",
  "cascade_game_v4",
  "cascade_game_v5",
  "cascade_game_v6",
  "cascade_game_v7",
];

export interface SavedState {
  version: 8;
  pieces: Array<{ tier: number; x: number; y: number }>;
  score: number;
  savedAt: number;
  queue: { current: number; next: number };
  /**
   * Play time so far, pauses excluded (#2750), so a relaunched game keeps it.
   * Absent in saves from older builds.
   */
  playedMs?: number;
  /**
   * The replay log's place (#3858): its unit number and its per-game cap counts, so a relaunched
   * game numbers its next unit after the saved ones and keeps its caps. Absent in saves from
   * older builds (and then counted from 0).
   */
  replay?: { unit: number; danger: number; unitsCut: number; dangerCut: number };
}

function looksLikeReplay(r: unknown): boolean {
  if (typeof r !== "object" || r === null) return false;
  const o = r as Record<string, unknown>;
  return ["unit", "danger", "unitsCut", "dangerCut"].every((k) => typeof o[k] === "number");
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
    (d.playedMs !== undefined && typeof d.playedMs !== "number") ||
    (d.replay !== undefined && !looksLikeReplay(d.replay))
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
  key: "cascade_game_v8",
  subsystem: SUBSYSTEM,
  isValid: looksValid,
  corruptExtra: "keyAndRaw",
});

export const saveGame = currentSlot.save;

async function discardLegacy(): Promise<void> {
  await Promise.all(LEGACY_KEYS.map((key) => AsyncStorage.removeItem(key).catch(() => {})));
}

/**
 * Loads the saved game (v8 only).
 *
 * A v7 save (key `cascade_game_v7`, #3920's 11-tier ladder) is DISCARDED, not migrated (#3960):
 * every tier above 0 is a different piece or a different size (the Moon is back at tier 1 and a
 * Lime / Mercury sits at tier 2, so a saved tier 5 is now a different piece at a different radius),
 * and a saved tier 10 would sit one merge short of the capstone, so its board would be other
 * pieces, overlapping. A v6 save (key `cascade_game_v6`, #3904's 12-tier ladder) is DISCARDED, not migrated (#3920):
 * every tier above 0 means a different piece (the Peach and the Moon are gone, so a saved tier 6
 * is now a Coconut, and the old tier 11 does not exist) and every radius changed (Cherry 5 to
 * 11.5), so its board would be other pieces, overlapping. A v5 save (key `cascade_game_v5`, #3697's lively ladder) is DISCARDED, not migrated (#3904):
 * every radius changed (Cherry 18 to 5, Watermelon 56 to 74.8, the capstone 63 to 98), so its
 * positions would overlap or leave gaps, and a single capstone in it would now be half a win.
 * A v4 save (key `cascade_game_v4`, #3695's ladder on Matter.js) is DISCARDED, not migrated
 * (#3697). Every radius changed (Cherry 22 to 18, Orange 38 to 28, Watermelon 88 to 56, the
 * capstone 101 to 63), so restoring its positions would leave gaps a pile falls into and a
 * different board from the one that was saved, and its pile was built on the old physics. A v3
 * save (the 10-tier ladder) was already discarded by #3695 for the same reason. Cascade has not
 * shipped: only dev and test builds can hold an older save, so the cost is one abandoned dev
 * game. The old keys are removed so they do not linger. A v8 key that is present but invalid is
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
