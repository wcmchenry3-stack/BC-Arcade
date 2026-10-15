/**
 * The replay tier (#3276): the gameplay events that rebuild a game outlive
 * the granular and diagnostic data under pressure, a replay-tier eviction
 * removes whole games, oldest first, lifecycle stays the last resort, and a
 * queue written by the build before the tier existed still loads.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

import { EventStore, type Row } from "../eventStore";
import { chunkKey, legacyTierKey } from "../eventStoreChunks";
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
});
