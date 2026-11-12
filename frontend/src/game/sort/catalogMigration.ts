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
 * - Best moves are dropped (stored as none): they can't be compared with the
 *   catalog's levels, and they feed the leaderboard's moves tie-break.
 * - An unfinished board is dropped: it was an old random deal.
 * - The old cache of the server's levels (`@sort/levels_cache`) is removed.
 *
 * The catalog version is stored next to the progress
 * (`@sort/catalog_version`), written in one `setMany` with the migrated
 * progress and the emptied bests, so a migration happens once and a later
 * catalog can tell which numbering a save uses. Until that write lands the
 * old save is untouched, so a crash or failure just migrates again later.
 *
 * The unlock carries over so the player can play on, but the leaderboard
 * counts only levels solved on the catalog: `SortScreen`'s frontier comes
 * from the bests, never from the unlocked level.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Sentry from "@sentry/react-native";

import { SORT_CATALOG_VERSION, SORT_LEVELS, type LevelData } from "./catalog";
import {
  highestSolvedLevel,
  pauseProgressWrites,
  type BestMoves,
  type SortProgress,
} from "./storage";

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
 * What `migrateToCatalog` found:
 * - `current`: storage holds this catalog's save (migrated now or before);
 * - `foreign`: it holds a save of a catalog version this build doesn't know
 *   (a newer build's, reachable only on a web rollback). Nothing is written:
 *   the session plays from in-memory defaults and progress writes are paused;
 * - `failed`: storage failed (reported). The stored best moves may still be
 *   the old ones, so the caller must not use them; the next load retries.
 */
export type CatalogMigration = "current" | "foreign" | "failed";

function report(e: unknown): void {
  Sentry.captureException(e, { tags: { subsystem: "sort.storage", op: "migrateToCatalog" } });
}

/**
 * Brings the stored progress onto the current catalog. Everything is read and
 * computed first, then written in ONE `setMany` (progress, emptied bests and
 * the version together), so a failure or a kill part-way leaves the old save
 * whole for the next load to migrate again. Only after that is the disposable
 * leftover (the old level cache) removed, best-effort. Never rejects.
 */
export async function migrateToCatalog(): Promise<CatalogMigration> {
  pauseProgressWrites(false);
  let stored: Record<string, string | null>;
  try {
    stored = await AsyncStorage.getMany([VERSION_KEY, PROGRESS_KEY, BEST_MOVES_KEY]);
  } catch (e) {
    report(e);
    // Keep the legacy save as it is for the next load to migrate: a later
    // progress write would store catalog numbers in an unversioned save.
    pauseProgressWrites(true);
    return "failed";
  }
  const version = stored[VERSION_KEY];
  if (version === String(SORT_CATALOG_VERSION)) return "current";
  if (version != null) {
    pauseProgressWrites(true);
    return "foreign";
  }

  // No version: a save from before the catalog, or a new player.
  const hasProgress = stored[PROGRESS_KEY] != null;
  const hasBests = stored[BEST_MOVES_KEY] != null;
  const oldProgress = parse(stored[PROGRESS_KEY]) as Partial<SortProgress> | null;
  const progress: SortProgress = {
    unlockedLevel: migratedUnlockedLevel(
      oldProgress?.unlockedLevel,
      asBests(parse(stored[BEST_MOVES_KEY]))
    ),
    currentLevelId: null,
    currentState: null,
  };
  try {
    await AsyncStorage.setMany({
      ...(hasProgress || hasBests ? { [PROGRESS_KEY]: JSON.stringify(progress) } : {}),
      ...(hasBests ? { [BEST_MOVES_KEY]: JSON.stringify({}) } : {}),
      [VERSION_KEY]: String(SORT_CATALOG_VERSION),
    });
  } catch (e) {
    report(e);
    // Keep the legacy save as it is for the next load to migrate: a later
    // progress write would store catalog numbers in an unversioned save.
    pauseProgressWrites(true);
    return "failed";
  }
  try {
    await AsyncStorage.removeItem(LEVELS_CACHE_KEY);
  } catch (e) {
    report(e); // a stale cache nothing reads: harmless, the save is migrated
  }
  return "current";
}
