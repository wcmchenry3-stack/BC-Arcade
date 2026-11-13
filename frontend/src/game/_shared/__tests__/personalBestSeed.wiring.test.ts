/**
 * The seed's two connections (#3802): a kept /stats/me response seeds the local best, and the
 * catalog fetch the app already makes carries the kill switch.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

import type { StatsResponse } from "../../../api/types";
import { fetchAndRememberMyStats, clearMyStatsCache } from "../../../hooks/useMyStats";
import { getOrCreateSessionId } from "../session";
import { __resetPersonalBestForTests, getBest, storageKey } from "../personalBest";
import { __resetPersonalBestSeedForTests, isSeedEnabled } from "../personalBestSeed";
import { __resetReplayDialSyncForTests, refresh } from "../replayDialSync";

const STATS = {
  total_games: 3,
  by_game: { cascade: { last_played_at: null, best_value: 700, best_label_key: "score" } },
} as unknown as StatsResponse;

function catalogApi(body: unknown, ok = true) {
  return { request: jest.fn().mockResolvedValue({ ok, body }) } as never;
}

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
  clearMyStatsCache();
  __resetPersonalBestForTests();
  __resetPersonalBestSeedForTests();
  __resetReplayDialSyncForTests();
});

describe("a kept /stats/me response", () => {
  it("seeds the local best, and returns the response unchanged", async () => {
    const res = await fetchAndRememberMyStats(() => Promise.resolve(STATS));
    expect(res).toBe(STATS);
    expect(await getBest("cascade")).toBe(700);
  });

  it("does not seed from a request that failed", async () => {
    await expect(
      fetchAndRememberMyStats(() => Promise.reject(new Error("offline")))
    ).rejects.toThrow("offline");
    expect(await getBest("cascade")).toBe(0);
  });

  it("does not seed once the cache was cleared mid-request (Delete my data)", async () => {
    await fetchAndRememberMyStats(async () => {
      clearMyStatsCache();
      return STATS;
    });
    expect(await getBest("cascade")).toBe(0);
  });
});

describe("Delete my data between the check and the write", () => {
  it("seeds nothing when it lands while the streak is being saved", async () => {
    const streak = { ...STATS, streak_days: 3 } as StatsResponse;
    await getOrCreateSessionId(); // so the mocked write below is the streak's, not the session's
    jest.mocked(AsyncStorage.setItem).mockImplementationOnce(async () => {
      clearMyStatsCache(); // the delete flow's step, mid-await
    });
    await fetchAndRememberMyStats(() => Promise.resolve(streak));
    expect(await getBest("cascade")).toBe(0);
    expect(await AsyncStorage.getItem(storageKey("cascade"))).toBeNull();
  });

  it("seeds nothing when it lands while the best is being read", async () => {
    const getMany = jest.mocked(AsyncStorage.getMany);
    const real = getMany.getMockImplementation();
    getMany.mockImplementationOnce(async (keys) => {
      clearMyStatsCache();
      return real ? real(keys) : {};
    });
    await fetchAndRememberMyStats(() => Promise.resolve(STATS));
    expect(await AsyncStorage.getItem(storageKey("cascade"))).toBeNull();
  });
});

describe("the catalog fetch carries the switch", () => {
  it("takes personal_best_seed.enabled=false, and seeding then stops", async () => {
    __resetReplayDialSyncForTests({
      api: catalogApi({ items: [], personal_best_seed: { enabled: false } }),
    });
    await refresh();
    expect(isSeedEnabled()).toBe(false);
    await fetchAndRememberMyStats(() => Promise.resolve(STATS));
    expect(await getBest("cascade")).toBe(0);
  });

  it("a failed catalog fetch leaves the switch as held", async () => {
    __resetReplayDialSyncForTests({ api: catalogApi(null, false) });
    await refresh();
    expect(isSeedEnabled()).toBe(true);
  });
});
