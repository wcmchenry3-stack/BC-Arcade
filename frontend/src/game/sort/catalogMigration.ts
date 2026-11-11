/**
 * Moves a player's saved Sort progress onto the level catalog (#2761).
 *
 * Until the catalog, Sort played 23 levels dealt at random by the server on
 * every visit. Their numbers don't match the catalog's 120, and their best
 * moves were set on puzzles nobody else (and no later visit) ever saw. So, the
 * first time a catalog build opens Sort:
 *
 * - `unlockedLevel` maps by colour count: the old level the player had
 *   reached (the higher of their unlocked level and one past their highest
 *   solved level) had some number of colours (`LEGACY_LEVEL_COLOURS`); the
 *   player unlocks up to the first catalog level with at least that many.
 *   Someone facing old level 10 (7 colours) can play on from the first
 *   7-colour catalog level; someone who never got past level 1 starts at 1.
 * - Best moves are dropped: they can't be compared with the catalog's levels,
 *   and they feed the leaderboard's moves tie-break.
 * - An unfinished board is dropped: it was an old random deal.
 * - The old cache of the server's levels (`@sort/levels_cache`) is removed.
 *
 * The catalog version is stored next to the progress
 * (`@sort/catalog_version`), written in one `setMany` with the migrated
 * progress, so a migration happens once and a later catalog can tell which
 * numbering a save uses. Every step is safe to run again: a crash part-way
 * leaves no version, and the next load migrates again.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Sentry from "@sentry/react-native";

import { SORT_CATALOG_VERSION, SORT_LEVELS, type LevelData } from "./catalog";
import { highestSolvedLevel, type BestMoves, type SortProgress } from "./storage";

const VERSION_KEY = "@sort/catalog_version";
const PROGRESS_KEY = "@sort/progress";
const BEST_MOVES_KEY = "@sort/best_moves";
const LEVELS_CACHE_KEY = "@sort/levels_cache";

/**
 * Colours of each of the 23 random levels before the catalog (the server's
 * `LEVEL_SPECS` in backend/sort/generate_levels.py), level 1 first.
 */
export const LEGACY_LEVEL_COLOURS = [
  3, 3, 4, 4, 5, 5, 6, 6, 6, 7, 7, 8, 8, 9, 9, 9, 10, 11, 12, 13, 14, 13, 14,
] as const;

function colourCount(level: LevelData): number {
  return level.bottles.filter((b) => b.length > 0).length;
}

function isLevelNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

/**
 * The catalog level a pre-catalog player unlocks up to. Pure.
 *
 * `unlockedLevel` and `bests` are the old save's; either may be missing.
 */
export function migratedUnlockedLevel(
  unlockedLevel: unknown,
  bests: BestMoves,
  levels: readonly LevelData[] = SORT_LEVELS
): number {
  const legacyCount = LEGACY_LEVEL_COLOURS.length;
  const reached = Math.min(
    Math.max(isLevelNumber(unlockedLevel) ? unlockedLevel : 1, highestSolvedLevel(bests) + 1),
    legacyCount
  );
  const colours = LEGACY_LEVEL_COLOURS[reached - 1] ?? LEGACY_LEVEL_COLOURS[0];
  const index = levels.findIndex((level) => colourCount(level) >= colours);
  return index < 0 ? Math.max(levels.length, 1) : index + 1;
}

function parse(raw: string | null | undefined): unknown {
  if (raw === null || raw === undefined) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null; // corrupt: nothing in it can be carried over
  }
}

function asBests(value: unknown): BestMoves {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as BestMoves;
}

/**
 * Brings the stored progress onto the current catalog. Resolves true once
 * storage holds the current catalog's progress (migrated now or before), and
 * false when storage failed (reported): the caller must then not trust the
 * stored best moves, which may still be the old ones. Never rejects.
 */
export async function migrateToCatalog(): Promise<boolean> {
  try {
    const stored = await AsyncStorage.getMany([VERSION_KEY, PROGRESS_KEY, BEST_MOVES_KEY]);
    if (stored[VERSION_KEY] === String(SORT_CATALOG_VERSION)) return true;

    const hasSave = stored[PROGRESS_KEY] != null || stored[BEST_MOVES_KEY] != null;
    // No version: a save from before the catalog. (A version this build
    // doesn't know can only come from a newer build; its numbering can't be
    // read, so it starts over at level 1.)
    const legacy = stored[VERSION_KEY] == null;
    const oldProgress = parse(stored[PROGRESS_KEY]) as Partial<SortProgress> | null;
    const unlockedLevel = legacy
      ? migratedUnlockedLevel(oldProgress?.unlockedLevel, asBests(parse(stored[BEST_MOVES_KEY])))
      : 1;
    await AsyncStorage.removeMany([BEST_MOVES_KEY, LEVELS_CACHE_KEY]);
    const progress: SortProgress = { unlockedLevel, currentLevelId: null, currentState: null };
    await AsyncStorage.setMany({
      ...(hasSave ? { [PROGRESS_KEY]: JSON.stringify(progress) } : {}),
      [VERSION_KEY]: String(SORT_CATALOG_VERSION),
    });
    return true;
  } catch (e) {
    Sentry.captureException(e, { tags: { subsystem: "sort.storage", op: "migrateToCatalog" } });
    return false;
  }
}
