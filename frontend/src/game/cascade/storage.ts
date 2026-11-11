import { createJsonSlot, createRecord } from "../_shared/storageSlot";
import { DROPPABLE_TIERS, TIER_COUNT } from "./tiers";

const SUBSYSTEM = "cascade.storage";

/** The current save format. v4 = the 12-tier ladder (#3695); v3 = the old 10-tier physics ladder. */
export const SAVE_VERSION = 4;

/**
 * v3 -> v4 tier mapping, indexed by the OLD physics tier (0-9: Cherry, Strawberry, Grape, Orange,
 * Apple, Pear, Peach, Pineapple, Melon, Watermelon) to the NEW tier (`tiers.ts`).
 * Pieces whose name exists in the new ladder keep their name: Cherry 0, Grape 3, Orange 4,
 * Apple 5, Peach 6, Pineapple 9, Watermelon 10. The three that do not exist map to the nearest
 * radius (old radius -> new): Strawberry (22) -> Lemon 2 (21), Pear (52) -> Coconut 7 (51),
 * Melon (82) -> Watermelon 10 (85). Every new radius is no larger than the old one at its
 * mapped slot, so a migrated pile never starts overlapping.
 */
export const V3_TIER_MAP: readonly number[] = [0, 2, 3, 4, 5, 7, 6, 9, 10, 10];

/** An old (v3) save. */
export interface SavedStateV3 extends Omit<SavedState, "version"> {
  version: 3;
}

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

function looksValidV3(data: unknown): data is SavedStateV3 {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { version?: unknown }).version === 3 &&
    looksValid({ ...(data as object), version: SAVE_VERSION })
  );
}

/**
 * Upgrades a v3 save to v4 (#3695): old tiers are mapped by `V3_TIER_MAP`; a tier outside 0-9 is
 * dropped (it cannot exist in a real v3 save). The queue's tiers are mapped too and clamped to a
 * droppable tier (Apple, droppable in v3, is not droppable now). The score and play time carry
 * over unchanged, although the score scale differs from the new ladder's.
 */
export function migrateV3(old: SavedStateV3): SavedState {
  const mapTier = (t: number): number => V3_TIER_MAP[t] ?? -1;
  const maxDroppable = Math.max(...DROPPABLE_TIERS);
  const queueTier = (t: number): number => Math.min(maxDroppable, Math.max(0, mapTier(t)));
  const { version: _v, pieces, queue, ...rest } = old;
  return {
    ...rest,
    version: SAVE_VERSION,
    pieces: pieces
      .map((p) => ({ ...p, tier: mapTier(p.tier) }))
      .filter((p) => p.tier >= 0 && p.tier < TIER_COUNT),
    queue: { current: queueTier(queue.current), next: queueTier(queue.next) },
  };
}

const currentSlot = createJsonSlot<SavedState>({
  key: "cascade_game_v4",
  subsystem: SUBSYSTEM,
  isValid: looksValid,
  corruptExtra: "keyAndRaw",
});

/** The pre-ladder save slot (#3695): read once, migrated, then removed. */
const legacySlot = createJsonSlot<SavedStateV3>({
  key: "cascade_game_v3",
  subsystem: SUBSYSTEM,
  isValid: looksValidV3,
  corruptExtra: "keyAndRaw",
});

export const saveGame = currentSlot.save;

/**
 * Loads the saved game: the v4 save, else a v3 save migrated to v4 (and written as v4, with the
 * old key removed). A v3 payload that is corrupt or invalid is discarded (null: a new game).
 */
export async function loadGame(): Promise<SavedState | null> {
  const current = await currentSlot.load();
  if (current) return current;
  const old = await legacySlot.load();
  if (!old) return null;
  const migrated = migrateV3(old);
  await currentSlot.save(migrated);
  await legacySlot.clear();
  return migrated;
}

export async function clearGame(): Promise<void> {
  await currentSlot.clear();
  await legacySlot.clear();
}

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
