/**
 * The move of a saved game from the random levels onto the catalog (#2761).
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Sentry from "@sentry/react-native";

import { SORT_CATALOG_VERSION, SORT_LEVELS, type LevelData } from "../catalog";
import { LEGACY_LEVEL_COLOURS, migrateToCatalog, migratedUnlockedLevel } from "../catalogMigration";
import {
  loadBestMoves,
  loadProgress,
  pauseProgressWrites,
  saveBestMoves,
  saveProgress,
} from "../storage";

const VERSION_KEY = "@sort/catalog_version";

/**
 * A pre-catalog build's best moves, in the bytes its `saveBestMoves` wrote
 * (`JSON.stringify` of the map, in `@sort/best_moves`). Since #3821 the app
 * writes bests to the shared personal best, so old saves are seeded directly.
 */
async function seedLegacyBests(bests: Record<string, number>): Promise<void> {
  await AsyncStorage.setItem("@sort/best_moves", JSON.stringify(bests));
}

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
  afterEach(() => pauseProgressWrites(false));

  it("maps a pre-catalog save: unlocked level by colours, bests and board dropped", async () => {
    await saveProgress({ unlockedLevel: 10, currentLevelId: 9, currentState: legacyBoard });
    await seedLegacyBests({ "1": 6, "9": 40 });
    await AsyncStorage.setItem("@sort/levels_cache", '{"levels":[]}');

    await expect(migrateToCatalog()).resolves.toBe("current");

    await expect(loadProgress()).resolves.toEqual({
      unlockedLevel: firstWith(7),
      currentLevelId: null,
      currentState: null,
    });
    await expect(AsyncStorage.getItem("@sort/best_moves")).resolves.toBe("{}");
    await expect(loadBestMoves()).resolves.toEqual({});
    // The personal best (#3821) moved the emptied bests in (nothing) and removed the old key.
    await expect(AsyncStorage.getItem("@sort/best_moves")).resolves.toBeNull();
    await expect(AsyncStorage.getItem("personal_best_v1:sort")).resolves.toBeNull();
    await expect(AsyncStorage.getItem("@sort/levels_cache")).resolves.toBeNull();
    await expect(AsyncStorage.getItem(VERSION_KEY)).resolves.toBe(String(SORT_CATALOG_VERSION));
  });

  it("maps bests alone (no progress saved) from the highest solved level", async () => {
    await seedLegacyBests({ "4": 12 }); // old level 5 next: 5 colours
    await expect(migrateToCatalog()).resolves.toBe("current");
    await expect(loadProgress()).resolves.toMatchObject({ unlockedLevel: firstWith(5) });
  });

  it("runs once: a catalog save is left alone", async () => {
    await migrateToCatalog();
    await saveProgress({ unlockedLevel: 50, currentLevelId: 50, currentState: legacyBoard });
    await saveBestMoves({ "49": 30 });

    await expect(migrateToCatalog()).resolves.toBe("current");

    await expect(loadProgress()).resolves.toEqual({
      unlockedLevel: 50,
      currentLevelId: 50,
      currentState: legacyBoard,
    });
    await expect(loadBestMoves()).resolves.toEqual({ "49": 30 });
  });

  it("stores only the version for a new player", async () => {
    await expect(migrateToCatalog()).resolves.toBe("current");
    const keys = await AsyncStorage.getAllKeys();
    expect([...keys].sort()).toEqual([VERSION_KEY]);
  });

  it("writes progress, emptied bests and the version in one write", async () => {
    await saveProgress({ unlockedLevel: 3, currentLevelId: null, currentState: null });
    await seedLegacyBests({ "2": 9 });
    const setMany = jest.spyOn(AsyncStorage, "setMany");
    setMany.mockClear();
    await migrateToCatalog();
    expect(setMany).toHaveBeenCalledTimes(1);
    expect(Object.keys(setMany.mock.calls[0]![0]).sort()).toEqual([
      "@sort/best_moves",
      VERSION_KEY,
      "@sort/progress",
    ]);
  });

  it("leaves a save of an unknown (newer) catalog untouched and pauses progress writes", async () => {
    await AsyncStorage.setItem(VERSION_KEY, "99");
    await AsyncStorage.setItem("@sort/progress", '{"unlockedLevel":80}');
    await AsyncStorage.setItem("@sort/best_moves", '{"79":40}');
    const before = await AsyncStorage.getMany([VERSION_KEY, "@sort/progress", "@sort/best_moves"]);

    await expect(migrateToCatalog()).resolves.toBe("foreign");
    await saveProgress({ unlockedLevel: 2, currentLevelId: null, currentState: null });
    // Nor does a read of the bests move that catalog's old key in (#3821).
    await expect(loadBestMoves()).resolves.toEqual({});

    await expect(
      AsyncStorage.getMany([VERSION_KEY, "@sort/progress", "@sort/best_moves"])
    ).resolves.toEqual(before);
  });

  it("reads a corrupt old save as level 1", async () => {
    await AsyncStorage.setItem("@sort/progress", "{x");
    await AsyncStorage.setItem("@sort/best_moves", "[1,2]");
    await expect(migrateToCatalog()).resolves.toBe("current");
    await expect(loadProgress()).resolves.toMatchObject({ unlockedLevel: 1 });
  });

  it.each(["getMany", "setMany"] as const)(
    "reports a failed %s, leaves the old save whole, and migrates it on the next load",
    async (op) => {
      // Only bests on record: the unlock comes from them (old level 5, 5 colours).
      await seedLegacyBests({ "4": 12 });
      jest.spyOn(AsyncStorage, op).mockRejectedValueOnce(new Error("disk"));

      await expect(migrateToCatalog()).resolves.toBe("failed");
      expect(Sentry.captureException).toHaveBeenCalledWith(expect.any(Error), {
        tags: { subsystem: "sort.storage", op: "migrateToCatalog" },
      });
      await expect(AsyncStorage.getItem(VERSION_KEY)).resolves.toBeNull();
      await expect(AsyncStorage.getItem("@sort/best_moves")).resolves.toBe('{"4":12}');
      // Before the catalog migration lands, the personal best (#3821) never takes the old
      // random levels' bests as catalog bests, and leaves them whole for the migration.
      await expect(loadBestMoves()).resolves.toEqual({});
      await expect(AsyncStorage.getItem("@sort/best_moves")).resolves.toBe('{"4":12}');

      await expect(migrateToCatalog()).resolves.toBe("current");
      await expect(loadProgress()).resolves.toMatchObject({ unlockedLevel: firstWith(5) });
      await expect(loadBestMoves()).resolves.toEqual({});
    }
  );

  it.each(["getMany", "setMany"] as const)(
    "pauses progress writes after a failed %s, so the session can't overwrite the legacy save",
    async (op) => {
      await AsyncStorage.setItem("@sort/progress", '{"unlockedLevel":10}');
      jest.spyOn(AsyncStorage, op).mockRejectedValueOnce(new Error("disk"));

      await expect(migrateToCatalog()).resolves.toBe("failed");
      await saveProgress({ unlockedLevel: 30, currentLevelId: null, currentState: null });

      await expect(AsyncStorage.getItem("@sort/progress")).resolves.toBe('{"unlockedLevel":10}');
      // The next load still migrates the untouched legacy save (old level 10, 7 colours).
      await expect(migrateToCatalog()).resolves.toBe("current");
      await expect(loadProgress()).resolves.toMatchObject({ unlockedLevel: firstWith(7) });
    }
  );

  it("still migrates when removing the old level cache fails", async () => {
    await saveProgress({ unlockedLevel: 10, currentLevelId: null, currentState: null });
    await AsyncStorage.setItem("@sort/levels_cache", "{}");
    jest.spyOn(AsyncStorage, "removeItem").mockRejectedValueOnce(new Error("disk"));
    await expect(migrateToCatalog()).resolves.toBe("current");
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    await expect(loadProgress()).resolves.toMatchObject({ unlockedLevel: firstWith(7) });
  });
});
