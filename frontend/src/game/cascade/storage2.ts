import { createJsonSlot, createRecord } from "../_shared/storageSlot";

const SUBSYSTEM = "cascade.storage";

export interface SavedState {
  version: 3;
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
    d.version !== 3 ||
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

export const {
  save: saveGame,
  load: loadGame,
  clear: clearGame,
} = createJsonSlot<SavedState>({
  key: "cascade_game_v3",
  subsystem: SUBSYSTEM,
  isValid: looksValid,
  corruptExtra: "keyAndRaw",
});

/** The player's best Cascade score on this device (#2515); 0 when none. */
export const { load: loadBestScore, save: saveBestScore } = createRecord<number>({
  key: "cascade_best_score",
  subsystem: SUBSYSTEM,
  ops: { load: "loadBest", save: "saveBest" },
  fallback: () => 0,
  read: (raw) => {
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  },
  write: (score) => String(Math.floor(score)),
});
