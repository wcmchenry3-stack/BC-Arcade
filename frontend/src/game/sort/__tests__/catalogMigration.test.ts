/**
 * The move of a saved game from the random levels onto the catalog (#2761).
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Sentry from "@sentry/react-native";

import { SORT_CATALOG_VERSION, SORT_LEVELS, type LevelData } from "../catalog";
import { LEGACY_LEVEL_COLOURS, migrateToCatalog, migratedUnlockedLevel } from "../catalogMigration";
import { loadBestMoves, loadProgress, saveBestMoves, saveProgress } from "../storage";

const VERSION_KEY = "@sort/catalog_version";

function colours(level: LevelData): number {
  return level.bottles.filter((b) => b.length > 0).length;
}

/** The first catalog level with at least `n` colours. */
function firstWith(n: number): number {
  return SORT_LEVELS.findIndex((l) => colours(l) >= n) + 1;
}

const legacyBoard = {
  bottles: [["red", "blue"], ["blue", "red"], []],
  moveCount: 3,
  undosUsed: 1,
  isComplete: false,
  selectedBottleIndex: null,
} as const;

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.restoreAllMocks();
  (Sentry.captureException as jest.Mock).mockClear();
});

describe("migratedUnlockedLevel", () => {
  it("lists the 23 old levels' colour counts", () => {
    expect(LEGACY_LEVEL_COLOURS).toHaveLength(23);
    expect(LEGACY_LEVEL_COLOURS[0]).toBe(3);
    expect(LEGACY_LEVEL_COLOURS[22]).toBe(14);
  });

  it("unlocks up to the first catalog level with the old level's colour count", () => {
    expect(migratedUnlockedLevel(1, {})).toBe(1);
    // Old level 10 had 7 colours.
    expect(migratedUnlockedLevel(10, {})).toBe(firstWith(7));
    // Old level 23 had 14.
    expect(migratedUnlockedLevel(23, {})).toBe(firstWith(14));
    expect(firstWith(7)).toBeGreaterThan(20);
    expect(firstWith(14)).toBeGreaterThan(100);
  });

  it("takes the level past the highest solved one when it is further", () => {
    // Unlocked 2, but bests on record up to old level 13 (8 colours): 14 had 9.
    expect(migratedUnlockedLevel(2, { "13": 30, "1": 5 })).toBe(firstWith(9));
  });

  it("never reads past the old 23 levels, and treats a bad value as level 1", () => {
    expect(migratedUnlockedLevel(99, { "40": 3 })).toBe(firstWith(14));
    expect(migratedUnlockedLevel("7", {})).toBe(1);
    expect(migratedUnlockedLevel(undefined, {})).toBe(1);
    expect(migratedUnlockedLevel(0, {})).toBe(1);
  });

  it("only ever unlocks forward, never past the catalog", () => {
    const tiny: LevelData[] = [{ id: 1, bottles: [["red", "red", "red", "red"], []] }];
    expect(migratedUnlockedLevel(23, {}, tiny)).toBe(1);
  });
});

describe("migrateToCatalog", () => {
  it("maps a pre-catalog save: unlocked level by colours, bests and board dropped", async () => {
    await saveProgress({ unlockedLevel: 10, currentLevelId: 9, currentState: legacyBoard });
    await saveBestMoves({ "1": 6, "9": 40 });
    await AsyncStorage.setItem("@sort/levels_cache", '{"levels":[]}');

    await expect(migrateToCatalog()).resolves.toBe(true);

    await expect(loadProgress()).resolves.toEqual({
      unlockedLevel: firstWith(7),
      currentLevelId: null,
      currentState: null,
    });
    await expect(loadBestMoves()).resolves.toEqual({});
    await expect(AsyncStorage.getItem("@sort/best_moves")).resolves.toBeNull();
    await expect(AsyncStorage.getItem("@sort/levels_cache")).resolves.toBeNull();
    await expect(AsyncStorage.getItem(VERSION_KEY)).resolves.toBe(String(SORT_CATALOG_VERSION));
  });

  it("maps bests alone (no progress saved) from the highest solved level", async () => {
    await saveBestMoves({ "4": 12 }); // old level 5 next: 5 colours
    await expect(migrateToCatalog()).resolves.toBe(true);
    await expect(loadProgress()).resolves.toMatchObject({ unlockedLevel: firstWith(5) });
  });

  it("runs once: a catalog save is left alone", async () => {
    await migrateToCatalog();
    await saveProgress({ unlockedLevel: 50, currentLevelId: 50, currentState: legacyBoard });
    await saveBestMoves({ "49": 30 });

    await expect(migrateToCatalog()).resolves.toBe(true);

    await expect(loadProgress()).resolves.toEqual({
      unlockedLevel: 50,
      currentLevelId: 50,
      currentState: legacyBoard,
    });
    await expect(loadBestMoves()).resolves.toEqual({ "49": 30 });
  });

  it("stores only the version for a new player", async () => {
    await expect(migrateToCatalog()).resolves.toBe(true);
    const keys = await AsyncStorage.getAllKeys();
    expect([...keys].sort()).toEqual([VERSION_KEY]);
  });

  it("writes the version with the progress, in one write", async () => {
    await saveProgress({ unlockedLevel: 3, currentLevelId: null, currentState: null });
    const setMany = jest.spyOn(AsyncStorage, "setMany");
    setMany.mockClear();
    await migrateToCatalog();
    expect(setMany).toHaveBeenCalledTimes(1);
    expect(Object.keys(setMany.mock.calls[0]![0]).sort()).toEqual([VERSION_KEY, "@sort/progress"]);
  });

  it("starts a save from an unknown catalog version over at level 1", async () => {
    await AsyncStorage.setItem(VERSION_KEY, "99");
    await saveProgress({ unlockedLevel: 80, currentLevelId: null, currentState: null });
    await saveBestMoves({ "79": 40 });
    await expect(migrateToCatalog()).resolves.toBe(true);
    await expect(loadProgress()).resolves.toMatchObject({ unlockedLevel: 1 });
    await expect(loadBestMoves()).resolves.toEqual({});
  });

  it("reads a corrupt old save as level 1", async () => {
    await AsyncStorage.setItem("@sort/progress", "{x");
    await AsyncStorage.setItem("@sort/best_moves", "[1,2]");
    await expect(migrateToCatalog()).resolves.toBe(true);
    await expect(loadProgress()).resolves.toMatchObject({ unlockedLevel: 1 });
  });

  it.each(["getMany", "removeMany", "setMany"] as const)(
    "reports a failed %s, resolves false, and migrates on the next load",
    async (op) => {
      await saveProgress({ unlockedLevel: 10, currentLevelId: null, currentState: null });
      await saveBestMoves({ "1": 6 });
      jest.spyOn(AsyncStorage, op).mockRejectedValueOnce(new Error("disk"));

      await expect(migrateToCatalog()).resolves.toBe(false);
      expect(Sentry.captureException).toHaveBeenCalledWith(expect.any(Error), {
        tags: { subsystem: "sort.storage", op: "migrateToCatalog" },
      });
      await expect(AsyncStorage.getItem(VERSION_KEY)).resolves.toBeNull();

      await expect(migrateToCatalog()).resolves.toBe(true);
      await expect(loadProgress()).resolves.toMatchObject({ unlockedLevel: firstWith(7) });
      await expect(loadBestMoves()).resolves.toEqual({});
    }
  );
});
