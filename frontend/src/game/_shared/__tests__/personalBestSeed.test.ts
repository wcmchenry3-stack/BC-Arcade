/**
 * Seeding the shared local best from /stats/me (#3802): once, never over a local best, silent when
 * nothing can be seeded, and stopped by the server's kill switch. The seed makes no request.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

import type { StatsResponse } from "../../../api/types";
import { __resetPersonalBestForTests, getBest, recordResult, storageKey } from "../personalBest";
import {
  __resetPersonalBestSeedForTests,
  acceptSeedDial,
  hydrateSeedDial,
  isSeedEnabled,
  MAX_SEED_VALUE,
  SEED_DIAL_MAX_AGE_MS,
  seedPersonalBests,
} from "../personalBestSeed";

const DIAL_KEY = "personalBestSeedDial.v1";

function stats(by_game: Record<string, { best_value?: number | null; best_label_key?: string }>) {
  return {
    total_games: 1,
    by_game: Object.fromEntries(
      Object.entries(by_game).map(([k, v]) => [k, { last_played_at: null, ...v }])
    ),
  } as unknown as StatsResponse;
}

const FULL = stats({
  cascade: { best_value: 900, best_label_key: "score" },
  twenty48: { best_value: 4096, best_label_key: "score" },
  starswarm: { best_value: 12000, best_label_key: "score" },
  freecell: { best_value: 95, best_label_key: "moves" },
});

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
  __resetPersonalBestForTests();
  __resetPersonalBestSeedForTests();
  // The catalog has landed with the switch on (the first-launch case is tested below).
  await acceptSeedDial({ personal_best_seed: { enabled: true } }, Date.now());
});

describe("seeding", () => {
  it("seeds every seedable game with no local best, by the server's value", async () => {
    await seedPersonalBests(FULL);
    expect(await getBest("cascade")).toBe(900);
    expect(await getBest("twenty48")).toBe(4096);
    expect(await getBest("starswarm")).toBe(12000);
    expect(await getBest("freecell")).toBe(95);
  });

  it("happens once: a later, different server value does not seed again", async () => {
    await seedPersonalBests(FULL);
    const setItem = jest.mocked(AsyncStorage.setItem);
    setItem.mockClear();
    await seedPersonalBests(stats({ cascade: { best_value: 5000, best_label_key: "score" } }));
    expect(await getBest("cascade")).toBe(900);
    expect(setItem).not.toHaveBeenCalled();
  });

  it("never overwrites a better local best (higher-is-better)", async () => {
    await recordResult("cascade", 2000);
    await seedPersonalBests(FULL);
    expect(await getBest("cascade")).toBe(2000);
  });

  it("never overwrites a local best that is worse either: it only seeds an empty one", async () => {
    await recordResult("cascade", 100);
    await seedPersonalBests(FULL);
    expect(await getBest("cascade")).toBe(100);
  });

  it("never overwrites a better local best (lower-is-better, FreeCell)", async () => {
    await recordResult("freecell", 60);
    await seedPersonalBests(FULL);
    expect(await getBest("freecell")).toBe(60);
  });

  it("seeds only games the server has a matching best for", async () => {
    await seedPersonalBests(stats({ cascade: { best_value: 900, best_label_key: "score" } }));
    expect(await getBest("cascade")).toBe(900);
    expect(await getBest("twenty48")).toBe(0);
  });

  it("ignores a board whose label is not the local metric, a null or an implausible value", async () => {
    await seedPersonalBests(
      stats({
        cascade: { best_value: 900, best_label_key: "time" },
        twenty48: { best_value: null, best_label_key: "score" },
        starswarm: { best_value: 0, best_label_key: "score" },
        freecell: { best_value: Number.NaN, best_label_key: "moves" },
      })
    );
    for (const g of ["cascade", "twenty48", "starswarm", "freecell"] as const) {
      expect(await getBest(g)).toBe(0);
    }
  });

  it("does not seed games whose server best is not their local metric", async () => {
    await seedPersonalBests(
      stats({
        solitaire: { best_value: 800, best_label_key: "score" },
        sudoku: { best_value: 90, best_label_key: "score" },
        mahjong: { best_value: 120000, best_label_key: "time" },
        yacht: { best_value: 300, best_label_key: "score" },
      })
    );
    for (const g of ["solitaire", "sudoku", "mahjong", "yacht"] as const) {
      expect(await AsyncStorage.getItem(storageKey(g))).toBeNull();
    }
  });
});

describe("offline and failures are silent", () => {
  it("no stats (offline or a partial response): nothing seeded, nothing thrown", async () => {
    await expect(seedPersonalBests(undefined as unknown as StatsResponse)).resolves.toBeUndefined();
    await expect(seedPersonalBests({} as StatsResponse)).resolves.toBeUndefined();
    expect(await getBest("cascade")).toBe(0);
  });

  it("an unreadable store seeds nothing and does not throw; the next response seeds", async () => {
    jest.mocked(AsyncStorage.getMany).mockRejectedValueOnce(new Error("read failed"));
    await expect(seedPersonalBests(FULL)).resolves.toBeUndefined();
    __resetPersonalBestForTests();
    await seedPersonalBests(FULL);
    expect(await getBest("cascade")).toBe(900);
  });

  it("makes no network request of its own", async () => {
    const fetchSpy = jest.spyOn(globalThis, "fetch").mockImplementation(() => {
      throw new Error("no requests allowed");
    });
    await seedPersonalBests(FULL);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

describe("kill switch", () => {
  it("off: nothing is seeded, then on again seeds", async () => {
    expect(await acceptSeedDial({ personal_best_seed: { enabled: false } }, Date.now())).toBe(true);
    await seedPersonalBests(FULL);
    expect(await getBest("cascade")).toBe(0);
    expect(await AsyncStorage.getItem(storageKey("cascade"))).toBeNull();

    await acceptSeedDial({ personal_best_seed: { enabled: true } }, Date.now());
    await seedPersonalBests(FULL);
    expect(await getBest("cascade")).toBe(900);
  });

  it("an off survives a restart (stored) and holds until a fetch says on", async () => {
    await acceptSeedDial({ personal_best_seed: { enabled: false } }, Date.now());
    __resetPersonalBestSeedForTests();
    await hydrateSeedDial();
    expect(isSeedEnabled()).toBe(false);
    await seedPersonalBests(FULL);
    expect(await getBest("twenty48")).toBe(0);
  });

  it("an off no valid fetch confirmed for 7 days, or dated in the future, is the default: on", async () => {
    const now = 1_000_000_000_000;
    await acceptSeedDial({ personal_best_seed: { enabled: false } }, now);
    expect(isSeedEnabled(now + SEED_DIAL_MAX_AGE_MS - 1)).toBe(false);
    expect(isSeedEnabled(now + SEED_DIAL_MAX_AGE_MS)).toBe(true);
    expect(isSeedEnabled(now - 1)).toBe(true);
  });

  it("a catalog without the block, or with a malformed one, changes nothing", async () => {
    await acceptSeedDial({ personal_best_seed: { enabled: false } }, Date.now());
    for (const body of [
      null,
      {},
      { personal_best_seed: {} },
      { personal_best_seed: { enabled: "no" } },
    ]) {
      expect(await acceptSeedDial(body, Date.now())).toBe(false);
    }
    expect(isSeedEnabled()).toBe(false);
  });

  it("no dial known (fresh install, catalog not landed) or a corrupt stored dial: off", async () => {
    __resetPersonalBestSeedForTests();
    expect(isSeedEnabled()).toBe(false);
    await AsyncStorage.setItem(DIAL_KEY, "{not json");
    await hydrateSeedDial();
    expect(isSeedEnabled()).toBe(false);
  });
});

describe("first launch: the catalog has not landed yet", () => {
  it("with no dial yet nothing is seeded; once it arrives enabled, the next response seeds", async () => {
    __resetPersonalBestSeedForTests();
    await AsyncStorage.removeItem(DIAL_KEY); // a fresh install: nothing stored either
    await seedPersonalBests(FULL);
    expect(await AsyncStorage.getItem(storageKey("cascade"))).toBeNull();

    await acceptSeedDial({ personal_best_seed: { enabled: true } }, Date.now());
    await seedPersonalBests(FULL);
    expect(await getBest("cascade")).toBe(900);
  });

  it("with no dial yet, then a dial that arrives off: it never seeds", async () => {
    __resetPersonalBestSeedForTests();
    await AsyncStorage.removeItem(DIAL_KEY); // a fresh install: nothing stored either
    await seedPersonalBests(FULL);
    await acceptSeedDial({ personal_best_seed: { enabled: false } }, Date.now());
    await seedPersonalBests(FULL);
    await seedPersonalBests(FULL);
    for (const g of ["cascade", "twenty48", "starswarm", "freecell"] as const) {
      expect(await AsyncStorage.getItem(storageKey(g))).toBeNull();
    }
  });
});

describe("server values out of range are ignored", () => {
  it("rejects values above the counter bound or below 1, accepts the bound itself", async () => {
    await seedPersonalBests(
      stats({
        cascade: { best_value: 1e300, best_label_key: "score" },
        twenty48: { best_value: MAX_SEED_VALUE + 1, best_label_key: "score" },
        starswarm: { best_value: MAX_SEED_VALUE, best_label_key: "score" },
        freecell: { best_value: 0.4, best_label_key: "moves" },
      })
    );
    expect(await getBest("cascade")).toBe(0);
    expect(await getBest("twenty48")).toBe(0);
    expect(await getBest("starswarm")).toBe(MAX_SEED_VALUE);
    expect(await getBest("freecell")).toBe(0);
  });
});

describe("the guard (a deleted player's stats must not seed)", () => {
  it("a guard that is false from the start seeds nothing", async () => {
    await seedPersonalBests(FULL, () => false);
    expect(await getBest("cascade")).toBe(0);
  });

  it("a guard that flips while the stored best is being read blocks the write", async () => {
    let current = true;
    const getMany = jest.mocked(AsyncStorage.getMany);
    const real = getMany.getMockImplementation();
    getMany.mockImplementationOnce(async (keys) => {
      current = false; // "Delete my data" lands during the read
      return real ? real(keys) : {};
    });
    await seedPersonalBests(FULL, () => current);
    expect(await AsyncStorage.getItem(storageKey("cascade"))).toBeNull();
    expect(await getBest("cascade")).toBe(0);
  });

  it("a guard that flips after the first game seeds it and not the rest", async () => {
    let calls = 0;
    // Checks: before the dial, then per game a check and a write check: true for cascade only.
    await seedPersonalBests(FULL, () => {
      calls += 1;
      return calls <= 3;
    });
    const seeded = [
      await getBest("cascade"),
      await getBest("freecell"),
      await getBest("starswarm"),
      await getBest("twenty48"),
    ].filter((v) => v > 0);
    expect(seeded).toEqual([900]);
  });
});
