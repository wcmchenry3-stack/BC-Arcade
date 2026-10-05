/**
 * The in-memory mirror (#2959): the tiers are loaded once, every read is
 * served from memory, every mutation writes only the tiers it changed, the
 * stats are kept per row, and the on-disk format is what it always was.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

import { EventStore, GameEventRow, QueueCounts, QueueStats, Row } from "../eventStore";
import { Priority, logConfig, resetLogConfig } from "../eventQueueConfig";

const getItem = AsyncStorage.getItem as jest.Mock;
const setItem = AsyncStorage.setItem as jest.Mock;
const removeItem = AsyncStorage.removeItem as jest.Mock;

const TIER_KEYS = [
  "event_queue_v1/tier/0",
  "event_queue_v1/tier/1",
  "event_queue_v1/tier/2",
  "event_queue_v1/tier/3",
];

function clearSpies(): void {
  getItem.mockClear();
  setItem.mockClear();
  removeItem.mockClear();
}

function tierWrites(): string[] {
  return setItem.mock.calls
    .map(([k]) => k as string)
    .filter((k) => k.startsWith("event_queue_v1/tier/"));
}

function move(store: EventStore, i: number): Promise<GameEventRow> {
  return store.enqueueEvent({ game_id: "g", event_index: i, event_type: "move", payload: { i } });
}

function lifecycle(store: EventStore, i: number): Promise<GameEventRow> {
  return store.enqueueEvent({
    game_id: "g",
    event_index: i,
    event_type: "game_started",
    payload: {},
  });
}

function bug(store: EventStore, i: number) {
  return store.enqueueBugLog({
    bug_uuid: `b${i}`,
    bug_level: "warn",
    bug_source: "t",
    payload: { i },
  });
}

const everything = { includeDeadLettered: true, includeFuture: true };

/** What the stats should be, recounted from every row the store holds. */
async function recount(store: EventStore): Promise<Pick<QueueStats, "totalRows" | "sizeBytes">> {
  const rows = await store.peek(10_000, everything);
  return {
    totalRows: rows.length,
    sizeBytes: rows.reduce((n, r) => n + JSON.stringify(r).length, 0),
  };
}

describe("EventStore — in-memory mirror (#2959)", () => {
  let store: EventStore;

  beforeEach(async () => {
    await AsyncStorage.clear();
    resetLogConfig();
    store = new EventStore();
  });

  afterEach(() => {
    resetLogConfig();
  });

  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  it("the first operation reads each tier key exactly once", async () => {
    clearSpies();
    await store.peek(10);
    expect(getItem.mock.calls.map(([k]) => k).sort()).toEqual(TIER_KEYS);
  });

  it("peek, stats and the warning check read nothing once the mirror is loaded", async () => {
    await move(store, 0);
    clearSpies();
    await store.peek(100);
    await store.peek(5, everything);
    await store.stats();
    await store.shouldShowCapacityWarning();
    expect(getItem).not.toHaveBeenCalled();
  });

  it("a fresh instance over the same storage sees the rows (crash recovery still loads)", async () => {
    await move(store, 0);
    await bug(store, 0);
    const fresh = new EventStore();
    clearSpies();
    expect(await fresh.peek(10)).toHaveLength(2);
    expect(getItem.mock.calls.map(([k]) => k).sort()).toEqual(TIER_KEYS);
  });

  // -------------------------------------------------------------------------
  // Writes
  // -------------------------------------------------------------------------

  it("enqueueEvent once warm: no reads and exactly one write per call, of the row's tier", async () => {
    await move(store, 0);
    clearSpies();
    for (let i = 1; i <= 50; i += 1) await move(store, i);
    expect(getItem).not.toHaveBeenCalled();
    expect(setItem).toHaveBeenCalledTimes(50);
    expect(new Set(tierWrites())).toEqual(new Set(["event_queue_v1/tier/3"]));
  });

  it("enqueueBugLog once warm: no reads and one write", async () => {
    await move(store, 0);
    clearSpies();
    await bug(store, 0);
    expect(getItem).not.toHaveBeenCalled();
    expect(tierWrites()).toEqual(["event_queue_v1/tier/0"]);
  });

  it("against a 1,000-row queue across every tier, an enqueue still touches only its own tier", async () => {
    // The other three tiers are neither re-read nor re-written to count the
    // queue (the old stats recount), whatever its size.
    await store.seedRows(
      Array.from({ length: 1_000 }, (_, i): Row => ({
        id: `seed-${i}`,
        log_type: "game_event",
        game_id: "seed",
        event_index: i,
        event_type: "move",
        payload: { i },
        created_at: 1_000 + i,
        priority: ([1, 2, 3] as const)[i % 3] ?? Priority.GRANULAR,
        retry_count: 0,
        next_retry_at: null,
      }))
    );
    clearSpies();
    // And it measures one row — its own — not the thousand already there.
    const measured = jest.spyOn(store as unknown as { rowBytes: (row: Row) => number }, "rowBytes");
    await move(store, 1_001);
    expect(getItem).not.toHaveBeenCalled();
    expect(tierWrites()).toEqual(["event_queue_v1/tier/3"]);
    expect(measured).toHaveBeenCalledTimes(1);
    expect((await store.stats()).totalRows).toBe(1_001);
  });

  // -------------------------------------------------------------------------
  // Failures leave the mirror consistent (PR #3016 review)
  // -------------------------------------------------------------------------

  describe("failures", () => {
    /**
     * Make the next tier write (of `key`, or of any tier) fail, restoring the
     * mock whether or not it fired.
     */
    async function withFailingWrite(run: () => Promise<void>, key?: string): Promise<void> {
      const original = setItem.getMockImplementation()!;
      let armed = true;
      setItem.mockImplementation(async (k: string, value: string) => {
        if (armed && (key ? k === key : k.startsWith("event_queue_v1/tier/"))) {
          armed = false;
          throw new Error("disk full");
        }
        return original(k, value);
      });
      try {
        await run();
        expect(armed).toBe(false); // the failure was exercised
      } finally {
        setItem.mockImplementation(original);
      }
    }

    it("a load that fails on one tier counts nothing twice when the next call loads again", async () => {
      // Five real rows across four tiers, written by a first store.
      await move(store, 0);
      await move(store, 1);
      await lifecycle(store, 2);
      await bug(store, 0);
      await store.enqueueEvent({ game_id: "g", event_index: 3, event_type: "score", payload: {} });
      const fresh = new EventStore();
      const original = getItem.getMockImplementation()!;
      getItem.mockImplementation(async (key: string) => {
        if (key === "event_queue_v1/tier/2") throw new Error("CursorWindow: row too big");
        return original(key);
      });
      try {
        await expect(fresh.peek(10)).rejects.toThrow("row too big");
      } finally {
        getItem.mockImplementation(original);
      }
      logConfig.MAX_ROWS = 5;
      expect(await fresh.stats()).toMatchObject({ totalRows: 5 });
      expect(await fresh.evictToCapacity()).toBe(0);
      expect(await fresh.peek(10)).toHaveLength(5);
    });

    it("a write that fails on enqueue rejects, leaves no trace in the mirror, and notifies no one", async () => {
      const kept = await move(store, 0);
      const listener = jest.fn();
      store.onStats(listener);
      await withFailingWrite(() => expect(move(store, 1)).rejects.toThrow("disk full"));
      expect(listener).not.toHaveBeenCalled();
      expect((await store.peek(10)).map((r) => r.id)).toEqual([kept.id]);
      expect(await store.stats()).toMatchObject(await recount(store));
      // The next instance over the same storage agrees with the mirror.
      expect((await new EventStore().peek(10)).map((r) => r.id)).toEqual([kept.id]);
      // And the store still works afterwards.
      await move(store, 2);
      expect(await store.peek(10)).toHaveLength(2);
    });

    it("a write that fails after eviction puts the evicted rows back", async () => {
      logConfig.MAX_ROWS = 2;
      const a = await move(store, 0);
      const b = await move(store, 1);
      await withFailingWrite(() => expect(move(store, 2)).rejects.toThrow("disk full"));
      expect((await store.peek(10, everything)).map((r) => r.id).sort()).toEqual(
        [a.id, b.id].sort()
      );
      expect(await store.stats()).toMatchObject({ totalRows: 2, byPriority: { 3: 2 } });
      expect(await store.evictToCapacity()).toBe(0);
    });

    it("a write that fails on delete keeps the rows", async () => {
      const a = await move(store, 0);
      await move(store, 1); // the tier keeps a row, so the delete rewrites it
      await bug(store, 0);
      await withFailingWrite(() => expect(store.deleteByIds([a.id])).rejects.toThrow("disk full"));
      expect(await store.peek(10)).toHaveLength(3);
      expect(await store.stats()).toMatchObject(await recount(store));
      expect(await new EventStore().peek(10)).toHaveLength(3);
    });
  });

  it("the rows enqueue returns are copies: changing one changes nothing in the queue", async () => {
    const returned = await move(store, 0);
    returned.payload["huge"] = "x".repeat(10_000);
    (returned as { dead_lettered?: boolean }).dead_lettered = true;
    const [stored] = await store.peek(10);
    expect(stored?.dead_lettered).toBeUndefined();
    expect(stored?.payload).toEqual({ i: 0 });
    expect(await store.stats()).toMatchObject(await recount(store));
  });

  it("the mirror owns its payloads: the caller's object changed after enqueue is not what is stored", async () => {
    const data: Record<string, unknown> = { nested: { depth: 1 } };
    await store.enqueueEvent({ game_id: "g", event_index: 0, event_type: "move", payload: data });
    (data.nested as { depth: number }).depth = 2;
    data["later"] = "x".repeat(5_000);
    await bug(store, 0); // another write of the queue
    const [stored] = await store.peek(10);
    expect(stored?.payload).toEqual({ nested: { depth: 1 } });
    expect(await store.stats()).toMatchObject(await recount(store));
    // And what a restart reads is what was enqueued.
    expect((await new EventStore().peek(10))[0]?.payload).toEqual({ nested: { depth: 1 } });
  });

  it("seedRows keeps copies, payload included, not the caller's objects", async () => {
    const row: Row = { ...(await move(store, 0)), id: "seeded", payload: { i: 1 } };
    await store.seedRows([row]);
    row.payload["later"] = "x".repeat(1_000);
    (row as { dead_lettered?: boolean }).dead_lettered = true;
    await bug(store, 0); // another write of the queue
    const stored = (await store.peek(10, everything)).find((r) => r.id === "seeded");
    expect(stored?.payload).toEqual({ i: 1 });
    expect(stored?.dead_lettered).toBeUndefined();
    expect(await store.stats()).toMatchObject(await recount(store));
    expect(
      (await new EventStore().peek(10, everything)).find((r) => r.id === "seeded")?.payload
    ).toEqual({ i: 1 });
  });

  // -------------------------------------------------------------------------
  // Per tier, mirror == disk, even when a multi-tier commit lands in part
  // -------------------------------------------------------------------------

  describe("partial commit", () => {
    async function failWriteOf(key: string, run: () => Promise<void>): Promise<void> {
      const original = setItem.getMockImplementation()!;
      let armed = true;
      setItem.mockImplementation(async (k: string, value: string) => {
        if (armed && k === key) {
          armed = false;
          throw new Error("disk full");
        }
        return original(k, value);
      });
      try {
        await run();
        expect(armed).toBe(false);
      } finally {
        setItem.mockImplementation(original);
      }
    }

    it("a delete over two tiers whose second write fails keeps, per tier, what the disk holds", async () => {
      const started = await lifecycle(store, 0); // P1
      await lifecycle(store, 1);
      const granular = await move(store, 2); // P3
      await move(store, 3);
      const listener = jest.fn();
      store.onStats(listener);

      await failWriteOf("event_queue_v1/tier/3", () =>
        expect(store.deleteByIds([started.id, granular.id])).rejects.toThrow("disk full")
      );

      const ids = (await store.peek(10, everything)).map((r) => r.id);
      expect(ids).not.toContain(started.id); // tier 1 landed: gone here too
      expect(ids).toContain(granular.id); // tier 3 failed: still here, as on disk
      expect(await store.stats()).toMatchObject({ totalRows: 3, byPriority: { 1: 1, 3: 2 } });
      expect(await store.stats()).toMatchObject(await recount(store));
      const onDisk = (await new EventStore().peek(10, everything)).map((r) => r.id);
      expect(onDisk.sort()).toEqual(ids.slice().sort());
      expect(listener).toHaveBeenCalledTimes(1); // the tier that landed changed the queue
    });

    it("an enqueue whose eviction lands but whose own tier fails keeps the eviction and drops the row", async () => {
      logConfig.MAX_ROWS = 2;
      const mid: Row = {
        id: "mid-a",
        log_type: "game_event",
        game_id: "g",
        event_index: 0,
        event_type: "score",
        payload: {},
        created_at: 1_000,
        priority: Priority.MID,
        retry_count: 0,
        next_retry_at: null,
      };
      await store.seedRows([mid, { ...mid, id: "mid-b", created_at: 1_001 }]);

      await failWriteOf("event_queue_v1/tier/3", () =>
        expect(move(store, 2)).rejects.toThrow("disk full")
      );

      // mid-a was evicted (tier 2 landed); the new row was never stored (tier 3 failed).
      expect((await store.peek(10, everything)).map((r) => r.id)).toEqual(["mid-b"]);
      expect(await store.stats()).toMatchObject({ totalRows: 1, byPriority: { 2: 1, 3: 0 } });
      expect(await store.stats()).toMatchObject(await recount(store));
      expect((await new EventStore().peek(10, everything)).map((r) => r.id)).toEqual(["mid-b"]);
      // And the store is still consistent afterwards.
      await move(store, 3);
      expect(await store.stats()).toMatchObject({ totalRows: 2, byPriority: { 2: 1, 3: 1 } });
    });
  });

  describe("markDeadLetteredByGameIds", () => {
    it("flags every row of the games — parked rows included, flagged rows left alone — and no other game's", async () => {
      const a = await move(store, 0);
      const parked = await store.enqueueEvent({
        game_id: "g",
        event_index: 1,
        event_type: "score",
        payload: {},
      });
      await store.updateRows([{ ...parked, retry_count: 1, next_retry_at: Date.now() + 1e9 }]);
      const other = await store.enqueueEvent({
        game_id: "other",
        event_index: 0,
        event_type: "move",
        payload: {},
      });
      await store.markDeadLettered([a.id]);
      clearSpies();

      expect(await store.markDeadLetteredByGameIds(["g"])).toBe(1); // the parked row; a already was
      expect(tierWrites()).toEqual(["event_queue_v1/tier/2"]);
      const rows = await store.peek(10, everything);
      const ofG = rows.filter((r) => r.log_type === "game_event" && r.game_id === "g");
      expect(ofG).toHaveLength(2);
      expect(ofG.every((r) => r.dead_lettered)).toBe(true);
      expect(rows.find((r) => r.id === other.id)?.dead_lettered).toBeUndefined();
      expect(await store.peek(10)).toHaveLength(1); // only the other game's row is live
      expect(await store.markDeadLetteredByGameIds([])).toBe(0);
      expect(await store.markDeadLetteredByGameIds(["nope"])).toBe(0);
    });
  });

  it("updateRows, markDeadLettered and deleteByIds write only the tiers they change, and never read", async () => {
    const granular = await move(store, 0); // P3
    const started = await lifecycle(store, 1); // P1
    const bugRow = await bug(store, 0); // P0

    clearSpies();
    await store.updateRows([{ ...granular, retry_count: 1, next_retry_at: 99 }]);
    expect(tierWrites()).toEqual(["event_queue_v1/tier/3"]);

    clearSpies();
    await store.markDeadLettered([started.id]);
    expect(tierWrites()).toEqual(["event_queue_v1/tier/1"]);

    clearSpies();
    await store.deleteByIds([bugRow.id]);
    // The tier emptied: its key is removed, as before, rather than written.
    expect(setItem).not.toHaveBeenCalled();
    expect(removeItem).toHaveBeenCalledWith("event_queue_v1/tier/0");

    expect(getItem).not.toHaveBeenCalled();
  });

  it("a no-op mutation writes nothing", async () => {
    await move(store, 0);
    clearSpies();
    await store.deleteByIds(["nope"]);
    await store.updateRows([{ ...(await move(store, 1)), id: "nope" }]);
    await store.markDeadLettered(["nope"]);
    await store.sweepTTL(0);
    expect(tierWrites()).toEqual(["event_queue_v1/tier/3"]); // the one enqueue above
  });

  // -------------------------------------------------------------------------
  // On-disk format
  // -------------------------------------------------------------------------

  it("writes the same on-disk format: a fresh store reads exactly what the mirror holds", async () => {
    const a = await move(store, 0);
    const b = await move(store, 1);
    await lifecycle(store, 2);
    const c = await bug(store, 0);
    await store.updateRows([{ ...a, retry_count: 2, next_retry_at: 5 }]);
    await store.markDeadLettered([b.id]);
    await store.deleteByIds([c.id]);

    const mirror = await store.peek(100, everything);
    const fresh = new EventStore();
    expect(await fresh.peek(100, everything)).toEqual(mirror);

    // The tier is still a plain JSON array of rows.
    const raw = JSON.parse((await AsyncStorage.getItem("event_queue_v1/tier/3")) ?? "null");
    expect(Array.isArray(raw)).toBe(true);
    expect(raw).toEqual(mirror.filter((r) => r.priority === Priority.GRANULAR));
    expect(await AsyncStorage.getItem("event_queue_v1/tier/0")).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Incremental stats
  // -------------------------------------------------------------------------

  it("totalRows and sizeBytes stay equal to a full recount through every mutation", async () => {
    const check = async () => expect(await store.stats()).toMatchObject(await recount(store));
    const a = await move(store, 0);
    const b = await lifecycle(store, 1);
    await bug(store, 0);
    await check();
    await store.updateRows([{ ...a, retry_count: 3, next_retry_at: 1 }]);
    await check();
    await store.markDeadLettered([b.id]);
    await check();
    await store.deleteByIds([a.id]);
    await check();
    await store.seedRows([{ ...b, id: "seeded", dead_lettered: undefined }]);
    await check();
    await store.sweepTTL(Date.now() + logConfig.TTL_MS + 1);
    await check();
    expect((await store.stats()).totalRows).toBe(0);
  });

  it("oldestAt is recomputed after the oldest row leaves", async () => {
    const old: Row = {
      id: "old",
      log_type: "game_event",
      game_id: "g",
      event_index: 0,
      event_type: "move",
      payload: {},
      created_at: 1_000,
      priority: Priority.GRANULAR,
      retry_count: 0,
      next_retry_at: null,
    };
    await store.seedRows([old, { ...old, id: "mid", created_at: 2_000 }]);
    expect((await store.stats()).oldestAt).toBe(1_000);
    await store.deleteByIds(["old"]);
    expect((await store.stats()).oldestAt).toBe(2_000);
    await store.deleteByIds(["mid"]);
    expect((await store.stats()).oldestAt).toBeNull();
  });

  it("byLogType and byPriority follow the mirror", async () => {
    await move(store, 0);
    await bug(store, 0);
    const b = await bug(store, 1);
    await store.deleteByIds([b.id]);
    expect(await store.stats()).toMatchObject({
      byLogType: { game_event: 1, bug_log: 1 },
      byPriority: { 0: 1, 1: 0, 2: 0, 3: 1 },
    });
  });

  // -------------------------------------------------------------------------
  // onStats
  // -------------------------------------------------------------------------

  describe("onStats", () => {
    it("fires after each change with the new stats, not after a no-op, and not after unsubscribe", async () => {
      const seen: QueueCounts[] = [];
      const off = store.onStats((s) => seen.push(s));

      const a = await move(store, 0);
      expect(seen).toHaveLength(1);
      expect(seen[0]).toMatchObject({ totalRows: 1, byPriority: { 3: 1 } });

      await store.deleteByIds([a.id]);
      expect(seen).toHaveLength(2);
      expect(seen[1]?.totalRows).toBe(0);

      await store.deleteByIds(["nope"]);
      expect(seen).toHaveLength(2);

      off();
      await move(store, 1);
      expect(seen).toHaveLength(2);
    });

    it("fires for seedRows, markDeadLettered, updateRows, sweepTTL and clearAll", async () => {
      const listener = jest.fn();
      store.onStats(listener);
      const a = await move(store, 0);
      await store.seedRows([{ ...a, id: "s" }]);
      await store.markDeadLettered(["s"]);
      await store.updateRows([{ ...a, retry_count: 1 }]);
      await store.sweepTTL(Date.now() + logConfig.TTL_MS + 1);
      await store.clearAll();
      expect(listener).toHaveBeenCalledTimes(6);
      expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ totalRows: 0 }));
    });

    it("a throwing listener is reported and does not break the store", async () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Sentry = require("@sentry/react-native");
      store.onStats(() => {
        throw new Error("listener");
      });
      const row = await move(store, 0);
      expect(row.id).toBeTruthy();
      expect(await store.peek(10)).toHaveLength(1);
      expect(Sentry.captureException).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({ tags: { subsystem: "eventStore", op: "onStats" } })
      );
    });
  });

  // -------------------------------------------------------------------------
  // markDeadLettered
  // -------------------------------------------------------------------------

  describe("markDeadLettered", () => {
    it("flags the rows so peek skips them, keeps them for includeDeadLettered, and returns the count", async () => {
      const a = await move(store, 0);
      const b = await bug(store, 0);
      await move(store, 1);
      expect(await store.markDeadLettered([a.id, b.id, "nope"])).toBe(2);
      expect((await store.peek(10)).map((r) => r.id)).not.toContain(a.id);
      const all = await store.peek(10, { includeDeadLettered: true });
      expect(all).toHaveLength(3);
      expect(
        all
          .filter((r) => r.dead_lettered)
          .map((r) => r.id)
          .sort()
      ).toEqual([a.id, b.id].sort());
      // And they still count toward the queue.
      expect((await store.stats()).totalRows).toBe(3);
    });

    it("leaves rows already flagged alone: no write, count 0", async () => {
      const a = await move(store, 0);
      await store.markDeadLettered([a.id]);
      clearSpies();
      expect(await store.markDeadLettered([a.id])).toBe(0);
      expect(setItem).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // clearAll and the capacity check
  // -------------------------------------------------------------------------

  it("clearAll empties the mirror as well as the disk", async () => {
    await move(store, 0);
    await store.markWarningShown(5);
    await store.clearAll();
    expect(await store.peek(10)).toEqual([]);
    await move(store, 1);
    expect((await store.stats()).totalRows).toBe(1);
    // The suppression window went with the meta row.
    logConfig.MAX_ROWS = 1;
    expect(await store.shouldShowCapacityWarning(undefined, 6)).toBe(true);
  });

  it("the capacity check under cap is memory only: no read and no extra write", async () => {
    logConfig.MAX_ROWS = 1_000;
    await move(store, 0);
    clearSpies();
    await move(store, 1);
    expect(getItem).not.toHaveBeenCalled();
    expect(setItem).toHaveBeenCalledTimes(1);
    expect(await store.evictToCapacity()).toBe(0);
    expect(setItem).toHaveBeenCalledTimes(1);
  });

  it("over cap, the row's tier and the evicted tiers are each written once per enqueue", async () => {
    logConfig.MAX_ROWS = 3;
    // Older bug logs (explicit timestamps: rows enqueued in the same ms would
    // tie, and the #486 tiebreaker then drops the P3 row first).
    const old: Row = {
      id: "b0",
      log_type: "bug_log",
      bug_uuid: "b0",
      bug_level: "warn",
      bug_source: "t",
      payload: {},
      created_at: 1_000,
      priority: Priority.BUG_LOG,
      retry_count: 0,
      next_retry_at: null,
    };
    await store.seedRows([
      old,
      { ...old, id: "b1", created_at: 1_001 },
      { ...old, id: "b2", created_at: 1_002 },
    ]);
    clearSpies();
    await move(store, 0); // 4 rows: the oldest bug log goes
    expect(tierWrites().sort()).toEqual(["event_queue_v1/tier/0", "event_queue_v1/tier/3"]);
    expect(await store.stats()).toMatchObject({ totalRows: 3, byPriority: { 0: 2, 3: 1 } });
    expect((await store.peek(10, everything)).map((r) => r.id)).not.toContain("b0");
  });

  it("the warning meta is read once and markWarningShown updates it in memory", async () => {
    logConfig.MAX_ROWS = 2;
    logConfig.CAPACITY_WARNING_SUPPRESS_MS = 100;
    await move(store, 0);
    await move(store, 1);
    clearSpies();
    expect(await store.shouldShowCapacityWarning(undefined, 1_000)).toBe(true);
    await store.markWarningShown(1_000);
    expect(await store.shouldShowCapacityWarning(undefined, 1_050)).toBe(false);
    expect(await store.shouldShowCapacityWarning(undefined, 1_200)).toBe(true);
    expect(getItem.mock.calls.map(([k]) => k)).toEqual(["event_queue_v1/meta"]);
  });
});
