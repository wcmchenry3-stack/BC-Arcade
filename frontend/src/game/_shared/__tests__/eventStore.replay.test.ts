/**
 * The replay tier (#3276): the gameplay events that rebuild a game outlive
 * the granular and diagnostic data under pressure, a replay-tier eviction
 * removes whole games, oldest first, lifecycle stays the last resort, and a
 * queue written by the build before the tier existed still loads.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

import { EventStore, type Row } from "../eventStore";
import { EVICTED_KEY, chunkKey, legacyTierKey } from "../eventStoreChunks";
import {
  Priority,
  logConfig,
  resetLogConfig,
  type Priority as PriorityT,
} from "../eventQueueConfig";

const everything = { includeDeadLettered: true, includeFuture: true };

let clock = 1_000;

function row(game: string, i: number, priority: PriorityT, type: string): Row {
  clock += 1;
  return {
    id: `${game}-${priority}-${i}`,
    log_type: "game_event",
    game_id: game,
    event_index: i,
    event_type: type,
    payload: { i },
    created_at: clock,
    priority,
    retry_count: 0,
    next_retry_at: null,
  };
}

const replay = (game: string, n: number, from = 0): Row[] =>
  Array.from({ length: n }, (_, k) => row(game, from + k, Priority.REPLAY, "roll"));
const granular = (game: string, n: number): Row[] =>
  Array.from({ length: n }, (_, k) => row(game, k, Priority.GRANULAR, "diagnostic"));
const lifecycle = (game: string, n: number): Row[] =>
  Array.from({ length: n }, (_, k) => row(game, k, Priority.LIFECYCLE, "game_started"));

async function games(store: EventStore, priority: PriorityT): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const r of await store.peek(10_000, everything)) {
    if (r.log_type === "game_event" && r.priority === priority) {
      out[r.game_id] = (out[r.game_id] ?? 0) + 1;
    }
  }
  return out;
}

describe("replay tier (#3276)", () => {
  let store: EventStore;

  beforeEach(async () => {
    clock = 1_000;
    resetLogConfig();
    await AsyncStorage.clear();
    store = new EventStore();
  });

  afterEach(() => {
    resetLogConfig();
  });

  it("queues a registered gameplay type as replay and an unregistered one as granular", async () => {
    const a = await store.enqueueEvent({
      game_id: "g",
      event_index: 0,
      event_type: "roll",
      payload: {},
    });
    const b = await store.enqueueEvent({
      game_id: "g",
      event_index: 1,
      event_type: "zzz",
      payload: {},
    });
    expect([a.priority, b.priority]).toEqual([Priority.REPLAY, Priority.GRANULAR]);
    expect((await store.stats()).byPriority[Priority.REPLAY]).toBe(1);
  });

  it("evicts granular rows before replay rows, however old the replay rows are", async () => {
    logConfig.MAX_ROWS = 10;
    await store.seedRows(replay("g1", 5)); // oldest
    await store.seedRows(granular("d", 5));
    await store.seedRows(granular("d2", 3)); // 13 rows: 3 over
    const stats = await store.stats();
    expect(stats.totalRows).toBe(10);
    expect(stats.byPriority[Priority.REPLAY]).toBe(5);
    expect(stats.byPriority[Priority.GRANULAR]).toBe(5);
  });

  it("evicts replay rows before lifecycle rows", async () => {
    logConfig.MAX_ROWS = 10;
    await store.seedRows(lifecycle("g0", 4)); // oldest
    await store.seedRows(replay("g1", 8)); // 12: 2 over
    const stats = await store.stats();
    expect(stats.byPriority[Priority.LIFECYCLE]).toBe(4);
    expect(stats.byPriority[Priority.REPLAY]).toBe(0); // g1 went whole, though 2 rows would do
    expect(stats.totalRows).toBe(4);
  });

  it("drops lifecycle only once the pool and the replay tier are empty", async () => {
    logConfig.MAX_ROWS = 4;
    await store.seedRows(replay("g1", 2));
    await store.seedRows(lifecycle("g0", 5));
    const stats = await store.stats();
    expect(stats.byPriority[Priority.REPLAY]).toBe(0);
    expect(stats.byPriority[Priority.LIFECYCLE]).toBe(4);
  });

  it("evicts whole games from the replay tier, the game with the oldest row first", async () => {
    logConfig.MAX_ROWS = 12;
    await store.seedRows(replay("old", 4));
    await store.seedRows(replay("mid", 4));
    await store.seedRows(replay("new", 4)); // 12, at the cap
    expect(await games(store, Priority.REPLAY)).toEqual({ old: 4, mid: 4, new: 4 });

    // One more row: one over. "old" goes whole (not one row of each game).
    await store.seedRows(replay("new", 1, 4));
    expect(await games(store, Priority.REPLAY)).toEqual({ mid: 4, new: 5 });

    // Games go by their LATEST row: "mid" was played again after "new", so "new"
    // is the least recently active and goes first, with "mid" (8 rows) kept whole.
    await store.seedRows(replay("mid", 4, 4)); // 13: 1 over
    expect(await games(store, Priority.REPLAY)).toEqual({ mid: 8 });
  });

  it("keeps the active game: a finished game that started later goes first (A)", async () => {
    logConfig.MAX_ROWS = 30;
    await store.seedRows(replay("active", 5)); // started first, still being played
    await store.seedRows(replay("done1", 10));
    await store.seedRows(replay("done2", 10));
    await store.seedRows(replay("active", 6, 5)); // 31: 1 over
    expect(await games(store, Priority.REPLAY)).toEqual({ active: 11, done2: 10 });
  });

  it("does not evict the batch being enqueued, though its game started first (F)", async () => {
    logConfig.MAX_ROWS = 10;
    await store.seedRows(replay("cur", 2));
    await store.seedRows(replay("old_done", 8));
    const stored = await store.enqueueMany([
      { game_id: "cur", event_index: 2, event_type: "roll", payload: {} },
    ]);
    expect(stored).toHaveLength(1);
    expect(await games(store, Priority.REPLAY)).toEqual({ cur: 3 });
  });

  it("evicts the active game only when it is the only one left", async () => {
    logConfig.MAX_ROWS = 4;
    await store.seedRows(replay("done", 3));
    await store.seedRows(replay("cur", 3)); // 6: done goes, cur (3) fits
    expect(await games(store, Priority.REPLAY)).toEqual({ cur: 3 });
    await store.seedRows(replay("cur", 3, 3)); // 6 rows, one game: it goes too
    expect(await games(store, Priority.REPLAY)).toEqual({});
  });

  it("drops the later replay rows of an evicted game instead of storing a suffix", async () => {
    logConfig.MAX_ROWS = 10;
    await store.enqueueMany(
      Array.from({ length: 6 }, (_, i) => ({
        game_id: "a",
        event_index: i,
        event_type: "roll",
        payload: {},
      }))
    );
    await store.enqueueMany(
      Array.from({ length: 6 }, (_, i) => ({
        game_id: "b",
        event_index: i,
        event_type: "roll",
        payload: {},
      }))
    ); // 12: "a" goes whole
    expect(await games(store, Priority.REPLAY)).toEqual({ b: 6 });

    // The rest of "a": the replay events are not stored and not returned; its
    // lifecycle event is.
    const stored = await store.enqueueMany([
      { game_id: "a", event_index: 6, event_type: "roll", payload: {} },
      { game_id: "a", event_index: 7, event_type: "game_ended", payload: {} },
    ]);
    expect(stored.map((r) => r.event_type)).toEqual(["game_ended"]);
    expect(
      await store.enqueueEvent({ game_id: "a", event_index: 8, event_type: "roll", payload: {} })
    ).toBeNull();
    expect(await games(store, Priority.REPLAY)).toEqual({ b: 6 });
    // Another game, and a granular row of "a", are unaffected.
    expect(
      await store.enqueueEvent({ game_id: "c", event_index: 0, event_type: "roll", payload: {} })
    ).not.toBeNull();
    expect(
      await store.enqueueEvent({ game_id: "a", event_index: 9, event_type: "zzz", payload: {} })
    ).not.toBeNull();
  });

  it("remembers an evicted game even when the eviction's commit fails in part", async () => {
    logConfig.MAX_ROWS = 10;
    await store.seedRows(granular("g", 1));
    await store.seedRows(replay("a", 6)); // 7
    // The pool row's chunk (tier 3) fails to go; the replay tier lands, so
    // "a"'s rows are gone from disk.
    const prefix = chunkKey(Priority.GRANULAR, 0).replace(/0$/, "");
    const fail = (key: string) => key.startsWith(prefix);
    const setItem = AsyncStorage.setItem as jest.Mock;
    const removeItem = AsyncStorage.removeItem as jest.Mock;
    const realSet = setItem.getMockImplementation()!;
    const realRemove = removeItem.getMockImplementation()!;
    setItem.mockImplementation(async (k: string, v: string) => {
      if (fail(k)) throw new Error("disk");
      return realSet(k, v);
    });
    removeItem.mockImplementation(async (k: string) => {
      if (fail(k)) throw new Error("disk");
      return realRemove(k);
    });
    try {
      await expect(store.seedRows(replay("b", 5))).rejects.toThrow("disk"); // 12: pool, then "a"
    } finally {
      setItem.mockImplementation(realSet);
      removeItem.mockImplementation(realRemove);
    }
    expect((await games(store, Priority.REPLAY)).a).toBeUndefined();
    // The rest of "a" is not stored as a suffix.
    expect(
      await store.enqueueEvent({ game_id: "a", event_index: 6, event_type: "roll", payload: {} })
    ).toBeNull();
  });

  it("never syncs what a partly failed eviction left of a game, and evicts it first", async () => {
    logConfig.MAX_ROWS = 90;
    await store.seedRows(replay("a", 70)); // two replay chunks: 64 + 6
    await store.seedRows(replay("b", 10)); // 80
    // Removing "a"'s first chunk fails; the rest of its eviction lands.
    const removeItem = AsyncStorage.removeItem as jest.Mock;
    const realRemove = removeItem.getMockImplementation()!;
    const first = chunkKey(Priority.REPLAY, 0);
    removeItem.mockImplementation(async (k: string) => {
      if (k === first) throw new Error("disk");
      return realRemove(k);
    });
    try {
      await expect(store.seedRows(replay("c", 15))).rejects.toThrow("disk"); // 95: "a" goes
    } finally {
      removeItem.mockImplementation(realRemove);
    }
    // Some of "a" is still on disk, but none of it is offered for sync.
    expect((await store.stats()).byPriority[Priority.REPLAY]).toBeGreaterThan(25);
    expect((await games(store, Priority.REPLAY)).a).toBeUndefined();
    // The next eviction takes the remnant of "a" before any live game.
    await store.seedRows(replay("d", 5));
    const left = await games(store, Priority.REPLAY);
    expect(left.b).toBe(10);
    expect(left.c).toBe(15);
    expect(left.d).toBe(5);
  });

  it("remembers at most 64 evicted games, the most recent", async () => {
    logConfig.MAX_ROWS = 2;
    for (let g = 0; g < 70; g += 1) {
      await store.enqueueMany([
        { game_id: `g${g}`, event_index: 0, event_type: "roll", payload: {} },
        { game_id: `g${g}`, event_index: 1, event_type: "roll", payload: {} },
      ]);
    }
    // g0..g68 were evicted by the next game's rows; the first 5 are forgotten.
    const first = await store.enqueueMany([
      { game_id: "g0", event_index: 2, event_type: "roll", payload: {} },
    ]);
    const recent = await store.enqueueMany([
      { game_id: "g67", event_index: 2, event_type: "roll", payload: {} },
    ]);
    expect(first).toHaveLength(1);
    expect(recent).toHaveLength(0);
  });

  it("groups rows with no game id one by one", async () => {
    logConfig.MAX_ROWS = 4;
    await store.seedRows([
      row("", 0, Priority.REPLAY, "roll"),
      row("", 1, Priority.REPLAY, "roll"),
      row("g", 0, Priority.REPLAY, "roll"),
      row("g", 1, Priority.REPLAY, "roll"),
      row("g", 2, Priority.REPLAY, "roll"),
    ]); // 5: 1 over
    expect((await store.stats()).totalRows).toBe(4); // one id-less row went, not both
  });

  it("stops at the first game that covers the overage", async () => {
    logConfig.MAX_ROWS = 20;
    await store.seedRows(replay("a", 5));
    await store.seedRows(replay("b", 5));
    await store.seedRows(replay("c", 5));
    await store.seedRows(replay("d", 5));
    await store.seedRows(replay("e", 3)); // 23: 3 over -> "a" (5 rows) covers it
    expect(await games(store, Priority.REPLAY)).toEqual({ b: 5, c: 5, d: 5, e: 3 });
    expect((await store.stats()).totalRows).toBe(18);
  });

  it("walks the replay tier only when the pool cannot cover the overage", async () => {
    logConfig.MAX_ROWS = 10;
    await store.seedRows(replay("g1", 5));
    await store.seedRows(granular("d", 5));
    const spy = jest.spyOn(
      store as unknown as { evictOldestGames: () => number },
      "evictOldestGames"
    );
    await store.seedRows(granular("d2", 2));
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("loads a queue written by the previous build, and leaves its granular rows in place", async () => {
    // The previous build: roll rows in tier 3, score in tier 2, no tier-4 key;
    // one tier still in the #2959 one-key format.
    const oldGranular = Array.from({ length: 3 }, (_, k) => row("g", k, Priority.GRANULAR, "roll"));
    const oldMid = [row("g", 3, Priority.MID, "score")];
    const oldLifecycle = lifecycle("g", 1);
    await AsyncStorage.setItem(chunkKey(Priority.GRANULAR, 0), JSON.stringify(oldGranular));
    await AsyncStorage.setItem(chunkKey(Priority.MID, 0), JSON.stringify(oldMid));
    await AsyncStorage.setItem(legacyTierKey(Priority.LIFECYCLE), JSON.stringify(oldLifecycle));

    const fresh = new EventStore();
    const stats = await fresh.stats();
    expect(stats.totalRows).toBe(5);
    expect(stats.byPriority).toEqual({ 0: 0, 1: 1, 2: 1, 3: 3, 4: 0 });
    expect(await AsyncStorage.getItem(chunkKey(Priority.REPLAY, 0))).toBeNull(); // not re-tiered

    // New events go to the new tier next to them; the old rows still peek and delete.
    await fresh.enqueueEvent({ game_id: "g", event_index: 4, event_type: "roll", payload: {} });
    expect((await fresh.stats()).byPriority[Priority.REPLAY]).toBe(1);
    expect(await fresh.deleteByGameId("g")).toBe(6);
  });

  it("treats the old rows as pool under pressure, ahead of the new replay rows", async () => {
    logConfig.MAX_ROWS = 6;
    const oldGranular = Array.from({ length: 4 }, (_, k) =>
      row("old", k, Priority.GRANULAR, "roll")
    );
    await AsyncStorage.setItem(chunkKey(Priority.GRANULAR, 0), JSON.stringify(oldGranular));
    const fresh = new EventStore();
    await fresh.seedRows(replay("new", 5));
    const stats = await fresh.stats();
    expect(stats.byPriority[Priority.GRANULAR]).toBe(1);
    expect(stats.byPriority[Priority.REPLAY]).toBe(5);
  });

  describe("the evicted-games marker", () => {
    const setItem = AsyncStorage.setItem as jest.Mock;
    const removeItem = AsyncStorage.removeItem as jest.Mock;

    /** Run `run` with writes to keys `fail` matches rejecting; restore afterwards. */
    async function failing(fail: (k: string) => boolean, run: () => Promise<void>) {
      const realSet = setItem.getMockImplementation()!;
      const realRemove = removeItem.getMockImplementation()!;
      setItem.mockImplementation(async (k: string, v: string) => {
        if (fail(k)) throw new Error("disk");
        return realSet(k, v);
      });
      removeItem.mockImplementation(async (k: string) => {
        if (fail(k)) throw new Error("disk");
        return realRemove(k);
      });
      try {
        await run();
      } finally {
        setItem.mockImplementation(realSet);
        removeItem.mockImplementation(realRemove);
      }
    }

    const replayKeys = (k: string) => k.startsWith(chunkKey(Priority.REPLAY, 0).replace(/0$/, ""));
    const markerWrites = () => setItem.mock.calls.filter(([k]) => k === EVICTED_KEY);

    it("forgets a game whose eviction wrote nothing: its replay is intact and it accepts rows", async () => {
      logConfig.MAX_ROWS = 10;
      await store.seedRows(replay("a", 6));
      await store.seedRows(replay("b", 4)); // at the cap, same chunk as "a"
      await failing(replayKeys, async () => {
        await expect(store.seedRows(replay("b", 1, 4))).rejects.toThrow("disk"); // would evict "a"
      });
      expect(await games(store, Priority.REPLAY)).toEqual({ a: 6, b: 4 }); // nothing landed
      // Written ahead, then cleared once the rows were seen to survive.
      expect(JSON.parse((await AsyncStorage.getItem(EVICTED_KEY)) ?? "[]")).toEqual([]);
      logConfig.MAX_ROWS = 100;
      const stored = await store.enqueueMany([
        { game_id: "a", event_index: 6, event_type: "roll", payload: {} },
      ]);
      expect(stored).toHaveLength(1);
      expect((await games(store, Priority.REPLAY)).a).toBe(7);
    });

    it("persists the marker, so a new store still drops the game's later rows and hides remnants", async () => {
      logConfig.MAX_ROWS = 10;
      await store.seedRows(replay("a", 6));
      await store.seedRows(replay("b", 6)); // 12: "a" goes whole
      expect(JSON.parse((await AsyncStorage.getItem(EVICTED_KEY))!)).toEqual(["a"]);

      // A remnant of "a" on disk (an earlier partly failed eviction), next to live "b".
      await AsyncStorage.setItem(chunkKey(Priority.REPLAY, 9), JSON.stringify(replay("a", 2, 100)));
      const fresh = new EventStore();
      expect(await games(fresh, Priority.REPLAY)).toEqual({ b: 6 }); // remnants hidden
      const stored = await fresh.enqueueMany([
        { game_id: "a", event_index: 6, event_type: "roll", payload: {} },
        { game_id: "c", event_index: 0, event_type: "roll", payload: {} },
      ]);
      expect(stored.map((r) => r.game_id)).toEqual(["c"]);
    });

    it("writes the marker only when an eviction changes it", async () => {
      logConfig.MAX_ROWS = 10;
      setItem.mockClear();
      await store.enqueueMany(
        Array.from({ length: 5 }, (_, i) => ({
          game_id: "a",
          event_index: i,
          event_type: "roll",
          payload: {},
        }))
      );
      expect(markerWrites()).toHaveLength(0); // an ordinary save
      await store.seedRows(replay("b", 8)); // evicts "a"
      expect(markerWrites()).toHaveLength(1);
      await store.enqueueMany([{ game_id: "b", event_index: 9, event_type: "roll", payload: {} }]);
      expect(markerWrites()).toHaveLength(1);
    });

    it("clearAll removes the marker, and the games accept rows again", async () => {
      logConfig.MAX_ROWS = 10;
      await store.seedRows(replay("a", 6));
      await store.seedRows(replay("b", 6));
      expect(await AsyncStorage.getItem(EVICTED_KEY)).not.toBeNull();
      await store.clearAll();
      expect(await AsyncStorage.getItem(EVICTED_KEY)).toBeNull();
      const stored = await store.enqueueMany([
        { game_id: "a", event_index: 0, event_type: "roll", payload: {} },
      ]);
      expect(stored).toHaveLength(1);
    });

    it("rejects the save and deletes nothing when the marker cannot be written", async () => {
      logConfig.MAX_ROWS = 10;
      await store.seedRows(replay("a", 6));
      await failing(
        (k) => k === EVICTED_KEY,
        async () => {
          // Only the marker write fails; removals would have worked.
          await expect(store.seedRows(replay("b", 6))).rejects.toThrow("disk");
        }
      );
      expect(await AsyncStorage.getItem(EVICTED_KEY)).toBeNull();
      expect(await games(store, Priority.REPLAY)).toEqual({ a: 6 }); // intact, b not stored
      // A restart (R1) sees every row of "a" and no marker: no suffix can follow.
      const fresh = new EventStore();
      expect(await games(fresh, Priority.REPLAY)).toEqual({ a: 6 });
      logConfig.MAX_ROWS = 100;
      const stored = await fresh.enqueueMany([
        { game_id: "a", event_index: 6, event_type: "roll", payload: {} },
      ]);
      expect(stored).toHaveLength(1);
    });

    it("loads the marker before the first enqueue after a restart consults it", async () => {
      logConfig.MAX_ROWS = 10;
      await store.seedRows(replay("a", 6));
      await store.seedRows(replay("b", 6)); // "a" evicted and marked
      const fresh = new EventStore(); // first operation is an enqueue
      expect(
        await fresh.enqueueEvent({ game_id: "a", event_index: 6, event_type: "roll", payload: {} })
      ).toBeNull();
      expect(await games(fresh, Priority.REPLAY)).toEqual({ b: 6 });
    });

    it("marks every game one eviction selects", async () => {
      logConfig.MAX_ROWS = 10;
      await store.seedRows(replay("a", 3));
      await store.seedRows(replay("b", 3));
      await store.seedRows(replay("c", 3));
      await store.seedRows(replay("d", 8)); // 17: a, b and c (9 rows) go
      expect(await games(store, Priority.REPLAY)).toEqual({ d: 8 });
      expect(JSON.parse((await AsyncStorage.getItem(EVICTED_KEY))!).sort()).toEqual([
        "a",
        "b",
        "c",
      ]);
      for (const g of ["a", "b", "c"]) {
        expect(
          await store.enqueueEvent({ game_id: g, event_index: 9, event_type: "roll", payload: {} })
        ).toBeNull();
      }
    });

    it("settles a game whose outcome could not be checked at the next successful load", async () => {
      // "b" is marked on disk but all its rows are there, and a settle for it is pending
      // (as after an eviction whose mirror reload failed).
      await store.seedRows(replay("b", 3));
      const ids = (await store.peek(10, everything)).map((r) => r.id);
      await AsyncStorage.setItem(EVICTED_KEY, JSON.stringify(["b"]));
      const fresh = new EventStore();
      (fresh as unknown as { pendingSettle: Map<string, string[]> }).pendingSettle.set("b", ids);
      expect((await fresh.stats()).totalRows).toBe(3); // the load runs the pending settle
      expect(
        await fresh.enqueueMany([{ game_id: "b", event_index: 3, event_type: "roll", payload: {} }])
      ).toHaveLength(1);
      expect(JSON.parse((await AsyncStorage.getItem(EVICTED_KEY))!)).toEqual([]);
    });

    it("records the batch's own game when one enqueue alone exceeds the cap", async () => {
      logConfig.MAX_ROWS = 5;
      const stored = await store.enqueueMany(
        Array.from({ length: 8 }, (_, i) => ({
          game_id: "solo",
          event_index: i,
          event_type: "roll",
          payload: {},
        }))
      );
      expect(stored).toHaveLength(8); // returned as enqueued; the queue then cut the game
      expect(await games(store, Priority.REPLAY)).toEqual({});
      expect(
        await store.enqueueEvent({
          game_id: "solo",
          event_index: 8,
          event_type: "roll",
          payload: {},
        })
      ).toBeNull();
    });

    it("writes the marker before the rows go: a kill right after the delete leaves it durable", async () => {
      logConfig.MAX_ROWS = 10;
      await store.seedRows(replay("a", 6));
      const settle = jest
        .spyOn(
          (store as unknown as { evictedGames: { settle: () => Promise<void> } }).evictedGames,
          "settle"
        )
        .mockRejectedValue(new Error("killed"));
      await expect(store.seedRows(replay("b", 6))).rejects.toThrow("killed"); // "a" is deleted
      settle.mockRestore();
      const fresh = new EventStore(); // the next launch
      expect(await games(fresh, Priority.REPLAY)).toEqual({ b: 6 });
      const stored = await fresh.enqueueMany([
        { game_id: "a", event_index: 6, event_type: "roll", payload: {} },
      ]);
      expect(stored).toHaveLength(0);
    });

    it("rejects the load when the marker cannot be read, and the retry loads it", async () => {
      logConfig.MAX_ROWS = 10;
      await store.seedRows(replay("a", 6));
      await store.seedRows(replay("b", 6)); // "a" evicted, marker on disk
      const getItem = AsyncStorage.getItem as jest.Mock;
      const real = getItem.getMockImplementation()!;
      getItem.mockImplementation(async (k: string) => {
        if (k === EVICTED_KEY) throw new Error("read");
        return real(k);
      });
      const fresh = new EventStore();
      try {
        await expect(fresh.peek(10)).rejects.toThrow("read");
      } finally {
        getItem.mockImplementation(real);
      }
      expect(await games(fresh, Priority.REPLAY)).toEqual({ b: 6 });
      expect(
        await fresh.enqueueMany([{ game_id: "a", event_index: 6, event_type: "roll", payload: {} }])
      ).toHaveLength(0);
    });

    it("retries a failed unmark write on a later non-evicting operation", async () => {
      logConfig.MAX_ROWS = 10;
      await store.seedRows(replay("a", 6));
      await store.seedRows(replay("b", 4)); // at the cap
      // The eviction's replay write fails (nothing lands), so "a" is unmarked;
      // that second marker write fails too: the set stays dirty.
      const realSet = setItem.getMockImplementation()!;
      let markerCalls = 0;
      setItem.mockImplementation(async (k: string, v: string) => {
        if (replayKeys(k)) throw new Error("disk");
        if (k === EVICTED_KEY && (markerCalls += 1) > 1) throw new Error("disk");
        return realSet(k, v);
      });
      try {
        await expect(store.seedRows(replay("b", 1, 4))).rejects.toThrow("disk");
      } finally {
        setItem.mockImplementation(realSet);
      }
      expect(JSON.parse((await AsyncStorage.getItem(EVICTED_KEY))!)).toEqual(["a"]); // stale
      logConfig.MAX_ROWS = 100;
      await store.enqueueMany([{ game_id: "b", event_index: 5, event_type: "roll", payload: {} }]);
      expect(JSON.parse((await AsyncStorage.getItem(EVICTED_KEY))!)).toEqual([]);
      setItem.mockClear();
      await store.enqueueMany([{ game_id: "b", event_index: 6, event_type: "roll", payload: {} }]);
      expect(markerWrites()).toHaveLength(0); // clean again: no more writes
    });
  });
});
