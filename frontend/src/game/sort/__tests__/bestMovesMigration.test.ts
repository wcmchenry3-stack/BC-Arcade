/**
 * Sort's best moves move into the shared personal best (#3821).
 *
 * The bests are Sort's progress too (the solved levels, the leaderboard's `total_moves`), so
 * nothing may be lost or changed by the move: every old save must read back exactly as Sort's own
 * loader read it before #3821, and everything computed from it must stay the same.
 *
 * The old-format fixtures are the bytes the pre-#3821 `saveBestMoves` wrote, as recorded in
 * `_shared/__tests__/__fixtures__/storageCompat.json` ("sort: best moves", "sort: best moves
 * filtered", "sort: clear", "sort: best moves corrupt"), plus the `{}` `catalogMigration.ts`
 * writes.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Sentry from "@sentry/react-native";

import { __resetPersonalBestForTests } from "../../_shared/personalBest";
import { SORT_CATALOG_VERSION } from "../catalog";
import { migrateToCatalog } from "../catalogMigration";
import {
  applyLevelSolve,
  highestSolvedLevel,
  loadBestMoves,
  loadProgress,
  pauseProgressWrites,
  saveBestMoves,
  saveProgress,
  totalBestMoves,
  type BestMoves,
} from "../storage";

const OLD_KEY = "@sort/best_moves";
const NEW_KEY = "personal_best_v1:sort";
const VERSION_KEY = "@sort/catalog_version";

const record = (b: Record<string, number>) => JSON.stringify({ v: 1, b });

/** Sort's `loadBestMoves` before #3821, on the raw value of `@sort/best_moves`. */
function oldLoader(raw: string | null): BestMoves {
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const bests: Record<string, number> = {};
    for (const [level, moves] of Object.entries(parsed)) {
      if (typeof moves === "number" && Number.isInteger(moves) && moves >= 0) bests[level] = moves;
    }
    return bests;
  } catch {
    return {};
  }
}

async function onCatalog(): Promise<void> {
  await AsyncStorage.setItem(VERSION_KEY, String(SORT_CATALOG_VERSION));
}

/** A new app session: nothing cached in memory. */
const newSession = () => __resetPersonalBestForTests();

const setItem = jest.mocked(AsyncStorage.setItem);

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.restoreAllMocks();
  jest.clearAllMocks();
  pauseProgressWrites(false);
});

/** Each old save, and the bests it holds (as the old loader read them). */
const OLD_SAVES: ReadonlyArray<{ name: string; raw: string; bests: BestMoves }> = [
  { name: "two levels", raw: '{"1":8,"2":11}', bests: { "1": 8, "2": 11 } },
  { name: "values that aren't move counts", raw: '{"1":5,"2":"x","3":-1}', bests: { "1": 5 } },
  { name: "one level", raw: '{"1":8}', bests: { "1": 8 } },
  { name: "emptied by the catalog migration", raw: "{}", bests: {} },
  { name: "corrupt", raw: "{x", bests: {} },
  { name: "not an object", raw: "[1,2]", bests: {} },
  {
    name: "twelve levels and a gap",
    raw: '{"1":6,"2":9,"3":14,"4":12,"5":20,"6":18,"7":25,"8":22,"9":30,"10":28,"12":40,"11":33}',
    bests: {
      "1": 6,
      "2": 9,
      "3": 14,
      "4": 12,
      "5": 20,
      "6": 18,
      "7": 25,
      "8": 22,
      "9": 30,
      "10": 28,
      "11": 33,
      "12": 40,
    },
  },
];

describe.each(OLD_SAVES)("an old save on this catalog: $name", ({ raw, bests }) => {
  it("the fixture holds what the old loader read", () => {
    expect(oldLoader(raw)).toEqual(bests);
  });

  it("reads exactly as before, is written in the new format, and the old key is removed", async () => {
    await onCatalog();
    await AsyncStorage.setItem(OLD_KEY, raw);
    await expect(loadBestMoves()).resolves.toEqual(bests);
    const stored = await AsyncStorage.getItem(NEW_KEY);
    // Written only when it holds a best: an empty save moves in as nothing.
    expect(stored === null ? null : JSON.parse(stored)).toEqual(
      Object.keys(bests).length === 0 ? null : { v: 1, b: bests }
    );
    await expect(AsyncStorage.getItem(OLD_KEY)).resolves.toBeNull();
  });

  it("is idempotent: a later session reads the same and writes nothing", async () => {
    await onCatalog();
    await AsyncStorage.setItem(OLD_KEY, raw);
    await loadBestMoves();
    newSession();
    setItem.mockClear();
    await expect(loadBestMoves()).resolves.toEqual(bests);
    expect(setItem).not.toHaveBeenCalled();
  });

  it("the solved levels and the leaderboard sum are unchanged", async () => {
    await onCatalog();
    await AsyncStorage.setItem(OLD_KEY, raw);
    const moved = (await loadBestMoves()) ?? {};
    const before = oldLoader(raw);
    expect(highestSolvedLevel(moved)).toBe(highestSolvedLevel(before));
    for (let level = 1; level <= 13; level++) {
      expect(totalBestMoves(moved, level)).toBe(totalBestMoves(before, level));
    }
  });
});

describe("a value the old loader kept that can't be a best", () => {
  it("a 0-move best is dropped: no solve takes no pour (initState is never complete)", async () => {
    await onCatalog();
    await AsyncStorage.setItem(OLD_KEY, '{"1":7,"2":0}');
    await expect(loadBestMoves()).resolves.toEqual({ "1": 7 });
  });
});

describe("interrupted migration", () => {
  it("keeps the old key when the new record can't be written, and moves it in next time", async () => {
    await onCatalog();
    await AsyncStorage.setItem(OLD_KEY, '{"1":8,"2":11}');
    setItem.mockRejectedValueOnce(new Error("full"));
    await expect(loadBestMoves()).resolves.toEqual({ "1": 8, "2": 11 });
    await expect(AsyncStorage.getItem(OLD_KEY)).resolves.toBe('{"1":8,"2":11}');
    await expect(AsyncStorage.getItem(NEW_KEY)).resolves.toBeNull();

    await expect(loadBestMoves()).resolves.toEqual({ "1": 8, "2": 11 });
    await expect(AsyncStorage.getItem(NEW_KEY)).resolves.toBe(record({ "1": 8, "2": 11 }));
    await expect(AsyncStorage.getItem(OLD_KEY)).resolves.toBeNull();
  });

  it("keeps the old key when it can't be removed; merging it again later changes nothing", async () => {
    await onCatalog();
    await AsyncStorage.setItem(OLD_KEY, '{"1":8,"2":11}');
    jest.mocked(AsyncStorage.removeMany).mockRejectedValueOnce(new Error("disk"));
    await expect(loadBestMoves()).resolves.toEqual({ "1": 8, "2": 11 });
    await expect(AsyncStorage.getItem(OLD_KEY)).resolves.toBe('{"1":8,"2":11}');
    await expect(AsyncStorage.getItem(NEW_KEY)).resolves.toBe(record({ "1": 8, "2": 11 }));
    // A better solve lands in between: the old key can't lower it.
    await expect(saveBestMoves({ "1": 6, "2": 11 })).resolves.toBe(true);
    newSession();
    await expect(loadBestMoves()).resolves.toEqual({ "1": 6, "2": 11 });
    await expect(AsyncStorage.getItem(OLD_KEY)).resolves.toBeNull();
  });

  it("is null when storage can't be read, writes nothing and keeps the old key", async () => {
    await onCatalog();
    await AsyncStorage.setItem(OLD_KEY, '{"1":8}');
    jest.mocked(AsyncStorage.getMany).mockRejectedValueOnce(new Error("disk"));
    await expect(loadBestMoves()).resolves.toBeNull();
    await expect(AsyncStorage.getItem(OLD_KEY)).resolves.toBe('{"1":8}');
    await expect(AsyncStorage.getItem(NEW_KEY)).resolves.toBeNull();
    expect(Sentry.captureException).toHaveBeenCalledWith(expect.any(Error), {
      tags: { subsystem: "personalBest", op: "load", game: "sort" },
    });
  });

  it("a save while storage can't be read writes nothing", async () => {
    await onCatalog();
    await AsyncStorage.setItem(OLD_KEY, '{"1":8}');
    jest.mocked(AsyncStorage.getMany).mockRejectedValueOnce(new Error("disk"));
    await expect(saveBestMoves({ "1": 20, "2": 9 })).resolves.toBe(false);
    await expect(AsyncStorage.getItem(NEW_KEY)).resolves.toBeNull();
    await expect(loadBestMoves()).resolves.toEqual({ "1": 8 });
  });
});

describe("both keys present", () => {
  it("merges them level by level, the fewer moves winning, and keeps every level of both", async () => {
    await onCatalog();
    await AsyncStorage.setItem(NEW_KEY, record({ "1": 7, "3": 20, "4": 9 }));
    await AsyncStorage.setItem(OLD_KEY, '{"1":8,"2":11,"3":15}');
    await expect(loadBestMoves()).resolves.toEqual({ "1": 7, "2": 11, "3": 15, "4": 9 });
    await expect(AsyncStorage.getItem(NEW_KEY)).resolves.toBe(
      record({ "1": 7, "3": 15, "4": 9, "2": 11 })
    );
    await expect(AsyncStorage.getItem(OLD_KEY)).resolves.toBeNull();
  });

  it("an old key that adds nothing is removed without a write", async () => {
    await onCatalog();
    await AsyncStorage.setItem(NEW_KEY, record({ "1": 7, "2": 10 }));
    await AsyncStorage.setItem(OLD_KEY, '{"1":8,"2":11}');
    setItem.mockClear();
    await expect(loadBestMoves()).resolves.toEqual({ "1": 7, "2": 10 });
    expect(setItem).not.toHaveBeenCalled();
    await expect(AsyncStorage.getItem(OLD_KEY)).resolves.toBeNull();
  });
});

describe("an unknown or corrupt new record", () => {
  it("a newer build's record is left exactly as stored, with the old key, and never written over", async () => {
    await onCatalog();
    const newer = '{"v":2,"b":{"1":3}}';
    await AsyncStorage.setItem(NEW_KEY, newer);
    await AsyncStorage.setItem(OLD_KEY, '{"1":8}');
    // null: the screen must not mirror its bests over it.
    await expect(loadBestMoves()).resolves.toBeNull();
    await expect(saveBestMoves({ "1": 2 })).resolves.toBe(false);
    await expect(AsyncStorage.getItem(NEW_KEY)).resolves.toBe(newer);
    await expect(AsyncStorage.getItem(OLD_KEY)).resolves.toBe('{"1":8}');
  });

  it("a corrupt record reads as no bests (reported, removed); the old key still moves in", async () => {
    await onCatalog();
    await AsyncStorage.setItem(NEW_KEY, "{x");
    await AsyncStorage.setItem(OLD_KEY, '{"1":8}');
    await expect(loadBestMoves()).resolves.toEqual({ "1": 8 });
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      "personalBest: corrupt record, reading as no best",
      expect.objectContaining({ level: "warning" })
    );
    await expect(AsyncStorage.getItem(NEW_KEY)).resolves.toBe(record({ "1": 8 }));
    await expect(AsyncStorage.getItem(OLD_KEY)).resolves.toBeNull();
  });
});

describe("held back until the save is on this catalog", () => {
  it.each([
    ["no catalog version (a save from before the catalog)", null],
    ["another catalog's version", "99"],
  ])("%s: the old key is left as stored and counts for nothing", async (_name, version) => {
    if (version !== null) await AsyncStorage.setItem(VERSION_KEY, version);
    await AsyncStorage.setItem(OLD_KEY, '{"1":6,"9":40}');
    await expect(loadBestMoves()).resolves.toEqual({});
    await expect(AsyncStorage.getItem(OLD_KEY)).resolves.toBe('{"1":6,"9":40}');
    await expect(AsyncStorage.getItem(NEW_KEY)).resolves.toBeNull();
  });

  it("a read before the catalog version lands isn't cached: the next read moves the save in", async () => {
    await AsyncStorage.setItem(OLD_KEY, '{"1":6}');
    await expect(loadBestMoves()).resolves.toEqual({});
    await onCatalog();
    await expect(loadBestMoves()).resolves.toEqual({ "1": 6 });
  });
});

describe("with the catalog migration (catalogMigration.ts)", () => {
  it("a pre-catalog save: the random levels' bests set the unlock, and never reach the new store", async () => {
    await AsyncStorage.setItem("@sort/progress", '{"unlockedLevel":2}');
    await AsyncStorage.setItem(OLD_KEY, '{"1":6,"13":30}');
    await expect(migrateToCatalog()).resolves.toBe("current");
    await expect(loadProgress()).resolves.toMatchObject({ unlockedLevel: expect.any(Number) });
    await expect(loadBestMoves()).resolves.toEqual({});
    await expect(AsyncStorage.getItem(OLD_KEY)).resolves.toBeNull();
    await expect(AsyncStorage.getItem(NEW_KEY)).resolves.toBeNull();
  });

  it("a catalog save from before #3821: the migration leaves it, the first read moves it in", async () => {
    await onCatalog();
    await saveProgress({ unlockedLevel: 4, currentLevelId: null, currentState: null });
    await AsyncStorage.setItem(OLD_KEY, '{"1":8,"2":11,"3":20}');
    await expect(migrateToCatalog()).resolves.toBe("current");
    await expect(AsyncStorage.getItem(OLD_KEY)).resolves.toBe('{"1":8,"2":11,"3":20}');
    await expect(loadBestMoves()).resolves.toEqual({ "1": 8, "2": 11, "3": 20 });
    // A second launch: the migration doesn't touch the new store.
    newSession();
    await expect(migrateToCatalog()).resolves.toBe("current");
    await expect(loadBestMoves()).resolves.toEqual({ "1": 8, "2": 11, "3": 20 });
  });

  it("what a solve submits is the same as from the old store (level_reached, total_moves)", async () => {
    await onCatalog();
    const raw = '{"1":8,"2":11,"3":20}';
    await AsyncStorage.setItem(OLD_KEY, raw);
    const moved = (await loadBestMoves()) ?? {};
    // SortScreen's solve: from the bests in memory, then mirrored to storage.
    const submit = (bests: BestMoves, level: number, moves: number) => {
      const after = applyLevelSolve(bests, level, moves).bests;
      const frontier = Math.max(level, highestSolvedLevel(after));
      return { after, frontier, total: totalBestMoves(after, frontier) };
    };
    const fromNew = submit(moved, 4, 25);
    const fromOld = submit(oldLoader(raw), 4, 25);
    expect(fromNew).toEqual(fromOld);
    expect(fromNew.frontier).toBe(4);
    expect(fromNew.total).toBe(64);
    await expect(saveBestMoves(fromNew.after)).resolves.toBe(true);
    newSession();
    await expect(loadBestMoves()).resolves.toEqual({ "1": 8, "2": 11, "3": 20, "4": 25 });
  });
});
