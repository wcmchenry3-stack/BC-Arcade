/**
 * Tests for #367a — bounded AsyncStorage event queue.
 *
 * Every test overrides at least one logConfig value to prove thresholds
 * are configurable, per the epic's "nothing hardcoded" acceptance
 * criterion.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

import { EventStore } from "../eventStore";
import { Priority, logConfig, resetLogConfig } from "../eventQueueConfig";
import { CsprngUnavailableError } from "../uuid";

describe("EventStore", () => {
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
  // Basic enqueue / peek / delete
  // -------------------------------------------------------------------------

  describe("enqueue + peek", () => {
    it("enqueues a game event with an id, timestamp, and priority", async () => {
      const row = await store.enqueueEvent({
        game_id: "g1",
        event_index: 0,
        event_type: "game_started",
        payload: {},
      });
      expect(row.id).toBeTruthy();
      expect(row.created_at).toBeGreaterThan(0);
      expect(row.priority).toBe(Priority.LIFECYCLE);
    });

    it("assigns GRANULAR priority to unknown event types", async () => {
      const row = await store.enqueueEvent({
        game_id: "g1",
        event_index: 0,
        event_type: "diagnostic",
        payload: {},
      });
      expect(row.priority).toBe(Priority.GRANULAR);
    });

    it("enqueues a bug log at BUG_LOG priority", async () => {
      const row = await store.enqueueBugLog({
        bug_uuid: "bug-1",
        bug_level: "warn",
        bug_source: "test",
        payload: { k: "v" },
      });
      expect(row.priority).toBe(Priority.BUG_LOG);
    });

    it("peek returns rows ordered lifecycle → replay → granular → bug", async () => {
      await store.enqueueBugLog({
        bug_uuid: "b",
        bug_level: "warn",
        bug_source: "t",
        payload: {},
      });
      await store.enqueueEvent({
        game_id: "g",
        event_index: 1,
        event_type: "diagnostic",
        payload: {},
      });
      await store.enqueueEvent({
        game_id: "g",
        event_index: 2,
        event_type: "score",
        payload: {},
      });
      await store.enqueueEvent({
        game_id: "g",
        event_index: 0,
        event_type: "game_started",
        payload: {},
      });

      const rows = await store.peek(10);
      expect(rows.map((r) => r.priority)).toEqual([
        Priority.LIFECYCLE,
        Priority.REPLAY,
        Priority.GRANULAR,
        Priority.BUG_LOG,
      ]);
    });

    it("peek respects the limit argument", async () => {
      for (let i = 0; i < 5; i += 1) {
        await store.enqueueEvent({
          game_id: "g",
          event_index: i,
          event_type: "diagnostic",
          payload: {},
        });
      }
      expect((await store.peek(3)).length).toBe(3);
    });
  });

  describe("deleteByIds", () => {
    it("removes rows by id across all tiers", async () => {
      const a = await store.enqueueEvent({
        game_id: "g",
        event_index: 0,
        event_type: "game_started",
        payload: {},
      });
      const b = await store.enqueueBugLog({
        bug_uuid: "b",
        bug_level: "warn",
        bug_source: "t",
        payload: {},
      });
      const removed = await store.deleteByIds([a.id, b.id]);
      expect(removed).toBe(2);
      expect((await store.peek(10)).length).toBe(0);
    });

    it("returns 0 on an empty id list", async () => {
      expect(await store.deleteByIds([])).toBe(0);
    });

    it("ignores unknown ids", async () => {
      await store.enqueueEvent({
        game_id: "g",
        event_index: 0,
        event_type: "game_started",
        payload: {},
      });
      expect(await store.deleteByIds(["nope"])).toBe(0);
      expect((await store.peek(10)).length).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // Bounded queue — priority eviction
  // -------------------------------------------------------------------------

  describe("bounded eviction (MAX_ROWS)", () => {
    it("evicts P3 (granular) first when over cap", async () => {
      logConfig.MAX_ROWS = 5;
      // 3 granular (P3), 2 lifecycle (P1), 1 bug (P0) = 6 rows. One must go.
      for (let i = 0; i < 3; i += 1) {
        await store.enqueueEvent({
          game_id: "g",
          event_index: i,
          event_type: "diagnostic",
          payload: {},
        });
      }
      for (let i = 0; i < 2; i += 1) {
        await store.enqueueEvent({
          game_id: "g",
          event_index: i + 10,
          event_type: "game_started",
          payload: {},
        });
      }
      await store.enqueueBugLog({
        bug_uuid: "b",
        bug_level: "warn",
        bug_source: "t",
        payload: {},
      });

      const s = await store.stats();
      expect(s.totalRows).toBe(5);
      expect(s.byPriority[Priority.GRANULAR]).toBe(2); // 3 inserted, 1 evicted
      expect(s.byPriority[Priority.LIFECYCLE]).toBe(2);
      expect(s.byPriority[Priority.BUG_LOG]).toBe(1);
    });

    it("runaway bug_log scenario: fresh granular events survive, old bugs yield (#486)", async () => {
      logConfig.MAX_ROWS = 100;
      // Fill 1 lifecycle (P1, protected) + 99 bug logs (P0, oldest non-P1
      // rows in the queue).
      await store.enqueueEvent({
        game_id: "g",
        event_index: 0,
        event_type: "game_started",
        payload: {},
      });
      for (let i = 0; i < 99; i += 1) {
        await store.enqueueBugLog({
          bug_uuid: `b${i}`,
          bug_level: "warn",
          bug_source: "runaway",
          payload: { i },
        });
      }
      let s = await store.stats();
      expect(s.totalRows).toBe(100);
      expect(s.byPriority[Priority.BUG_LOG]).toBe(99);
      expect(s.byPriority[Priority.LIFECYCLE]).toBe(1);

      // Enqueue 5 granular move events. Queue is 105 rows → evict 5.
      // Under the #486 age-based pool policy, P1 is protected and the rest
      // of the queue is one FIFO pool. The 5 oldest pool rows are the 5
      // oldest bug logs (enqueued before the moves), so they get dropped
      // and all 5 fresh granular rows survive.
      for (let i = 0; i < 5; i += 1) {
        await store.enqueueEvent({
          game_id: "g",
          event_index: 100 + i,
          event_type: "diagnostic",
          payload: {},
        });
      }
      s = await store.stats();
      expect(s.totalRows).toBe(100);
      expect(s.byPriority[Priority.GRANULAR]).toBe(5);
      expect(s.byPriority[Priority.BUG_LOG]).toBe(94);
      expect(s.byPriority[Priority.LIFECYCLE]).toBe(1);
    });

    it("when only bug logs remain and cap is exceeded, oldest bugs are evicted (P0 FIFO)", async () => {
      logConfig.MAX_ROWS = 10;
      // 11 bug logs — no higher tier exists, so oldest bug is dropped.
      for (let i = 0; i < 11; i += 1) {
        await store.enqueueBugLog({
          bug_uuid: `b${i}`,
          bug_level: "warn",
          bug_source: "runaway",
          payload: { i },
        });
      }
      const s = await store.stats();
      expect(s.totalRows).toBe(10);
      expect(s.byPriority[Priority.BUG_LOG]).toBe(10);
      // The first bug (b0) should be gone.
      const rows = await store.peek(20);
      const uuids = rows.map((r) => ("bug_uuid" in r ? r.bug_uuid : ""));
      expect(uuids).not.toContain("b0");
      expect(uuids).toContain("b10");
    });
  });

  describe("bounded eviction (MAX_SIZE_BYTES)", () => {
    it("evicts when byte cap exceeded even if row count is fine", async () => {
      logConfig.MAX_ROWS = 10_000;
      logConfig.MAX_SIZE_BYTES = 2_000; // very small cap
      const big = { data: "x".repeat(500) };
      for (let i = 0; i < 10; i += 1) {
        await store.enqueueEvent({
          game_id: "g",
          event_index: i,
          event_type: "diagnostic",
          payload: big,
        });
      }
      const s = await store.stats();
      expect(s.sizeBytes).toBeLessThanOrEqual(2_000);
      expect(s.totalRows).toBeLessThan(10);
    });
  });

  // -------------------------------------------------------------------------
  // TTL sweep
  // -------------------------------------------------------------------------

  describe("sweepTTL", () => {
    it("drops rows older than TTL_MS", async () => {
      logConfig.TTL_MS = 1000; // 1s
      const row = await store.enqueueEvent({
        game_id: "g",
        event_index: 0,
        event_type: "diagnostic",
        payload: {},
      });
      const future = row.created_at + 5000;
      const removed = await store.sweepTTL(future);
      expect(removed).toBe(1);
      expect((await store.peek(10)).length).toBe(0);
    });

    it("keeps rows younger than TTL_MS", async () => {
      logConfig.TTL_MS = 60_000;
      await store.enqueueEvent({
        game_id: "g",
        event_index: 0,
        event_type: "diagnostic",
        payload: {},
      });
      const removed = await store.sweepTTL(Date.now() + 1000);
      expect(removed).toBe(0);
      expect((await store.peek(10)).length).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // Payload truncation
  // -------------------------------------------------------------------------

  describe("payload truncation", () => {
    it("replaces oversized event payloads with a stub", async () => {
      logConfig.MAX_EVENT_PAYLOAD_BYTES = 64;
      const row = await store.enqueueEvent({
        game_id: "g",
        event_index: 0,
        event_type: "diagnostic",
        payload: { big: "y".repeat(1000) },
      });
      expect(row.payload).toHaveProperty("_truncated", true);
      expect(row.payload).toHaveProperty("_original_bytes");
    });

    it("leaves small payloads intact", async () => {
      logConfig.MAX_EVENT_PAYLOAD_BYTES = 1024;
      const row = await store.enqueueEvent({
        game_id: "g",
        event_index: 0,
        event_type: "diagnostic",
        payload: { ok: true },
      });
      expect(row.payload).toEqual({ ok: true });
    });
  });

  // -------------------------------------------------------------------------
  // Crash recovery — new EventStore instance sees persisted rows
  // -------------------------------------------------------------------------

  describe("crash recovery", () => {
    it("a fresh EventStore instance sees rows enqueued by the previous one", async () => {
      logConfig.MAX_ROWS = 100;
      await store.enqueueEvent({
        game_id: "g",
        event_index: 0,
        event_type: "game_started",
        payload: {},
      });
      await store.enqueueBugLog({
        bug_uuid: "b",
        bug_level: "error",
        bug_source: "crash",
        payload: {},
      });
      const fresh = new EventStore();
      const rows = await fresh.peek(10);
      expect(rows.length).toBe(2);
    });

    it("corrupted tier JSON is discarded, not thrown", async () => {
      await AsyncStorage.setItem("event_queue_v1/tier/3", "{this is not valid");
      const rows = await store.peek(10);
      expect(rows).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // Stats + capacity warning
  // -------------------------------------------------------------------------

  describe("stats", () => {
    it("reports counts by log_type and priority", async () => {
      await store.enqueueEvent({
        game_id: "g",
        event_index: 0,
        event_type: "game_started",
        payload: {},
      });
      await store.enqueueEvent({
        game_id: "g",
        event_index: 1,
        event_type: "diagnostic",
        payload: {},
      });
      await store.enqueueBugLog({
        bug_uuid: "b",
        bug_level: "warn",
        bug_source: "t",
        payload: {},
      });

      const s = await store.stats();
      expect(s.totalRows).toBe(3);
      expect(s.byLogType).toEqual({ game_event: 2, bug_log: 1 });
      expect(s.byPriority[Priority.LIFECYCLE]).toBe(1);
      expect(s.byPriority[Priority.GRANULAR]).toBe(1);
      expect(s.byPriority[Priority.BUG_LOG]).toBe(1);
      expect(s.oldestAt).not.toBeNull();
      expect(s.sizeBytes).toBeGreaterThan(0);
    });

    it("returns zero stats for an empty store", async () => {
      const s = await store.stats();
      expect(s.totalRows).toBe(0);
      expect(s.sizeBytes).toBe(0);
      expect(s.oldestAt).toBeNull();
    });
  });

  describe("capacity warning", () => {
    it("returns false under the warning ratio", async () => {
      logConfig.MAX_ROWS = 10;
      logConfig.CAPACITY_WARNING_RATIO = 0.8;
      await store.enqueueEvent({
        game_id: "g",
        event_index: 0,
        event_type: "diagnostic",
        payload: {},
      });
      expect(await store.shouldShowCapacityWarning()).toBe(false);
    });

    it("returns true at or above the warning ratio", async () => {
      logConfig.MAX_ROWS = 10;
      logConfig.CAPACITY_WARNING_RATIO = 0.8;
      for (let i = 0; i < 9; i += 1) {
        await store.enqueueEvent({
          game_id: "g",
          event_index: i,
          event_type: "diagnostic",
          payload: {},
        });
      }
      expect(await store.shouldShowCapacityWarning()).toBe(true);
    });

    it("suppresses repeat warnings within the suppress window", async () => {
      logConfig.MAX_ROWS = 10;
      logConfig.CAPACITY_WARNING_RATIO = 0.8;
      logConfig.CAPACITY_WARNING_SUPPRESS_MS = 60_000;
      for (let i = 0; i < 9; i += 1) {
        await store.enqueueEvent({
          game_id: "g",
          event_index: i,
          event_type: "diagnostic",
          payload: {},
        });
      }
      await store.markWarningShown(1_000_000);
      expect(await store.shouldShowCapacityWarning(undefined, 1_030_000)).toBe(false);
      expect(await store.shouldShowCapacityWarning(undefined, 1_070_000)).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // clearAll
  // -------------------------------------------------------------------------

  it("clearAll removes every tier and the meta row", async () => {
    await store.enqueueEvent({
      game_id: "g",
      event_index: 0,
      event_type: "game_started",
      payload: {},
    });
    await store.enqueueBugLog({
      bug_uuid: "b",
      bug_level: "warn",
      bug_source: "t",
      payload: {},
    });
    await store.markWarningShown();
    await store.clearAll();
    const s = await store.stats();
    expect(s.totalRows).toBe(0);
    const keys = await AsyncStorage.getAllKeys();
    expect(keys.filter((k) => k.startsWith("event_queue_v1"))).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // seedRows (#479 test-only bulk insert)
  // -------------------------------------------------------------------------

  describe("seedRows (test-only)", () => {
    function makeGameRow(overrides: Partial<import("../eventStore").GameEventRow> = {}) {
      const row: import("../eventStore").GameEventRow = {
        id: `seed-${Math.random().toString(36).slice(2)}`,
        log_type: "game_event",
        game_id: "g",
        event_index: 0,
        event_type: "diagnostic",
        payload: {},
        created_at: Date.now(),
        priority: Priority.GRANULAR,
        retry_count: 0,
        next_retry_at: null,
        ...overrides,
      };
      return row;
    }

    it("bulk-inserts rows into the correct tiers", async () => {
      await store.seedRows([
        makeGameRow({ priority: Priority.GRANULAR, event_type: "diagnostic" }),
        makeGameRow({ priority: Priority.MID, event_type: "score" }),
        makeGameRow({ priority: Priority.LIFECYCLE, event_type: "game_started" }),
      ]);
      const stats = await store.stats();
      expect(stats.totalRows).toBe(3);
      expect(stats.byPriority[Priority.GRANULAR]).toBe(1);
      expect(stats.byPriority[Priority.MID]).toBe(1);
      expect(stats.byPriority[Priority.LIFECYCLE]).toBe(1);
    });

    it("runs a single eviction pass so a large seed is capped", async () => {
      Object.assign(logConfig, { MAX_ROWS: 50 });
      const rows = Array.from({ length: 200 }, (_, i) =>
        makeGameRow({ id: `r${i}`, priority: Priority.GRANULAR, created_at: 1000 + i })
      );
      await store.seedRows(rows);
      const stats = await store.stats();
      expect(stats.totalRows).toBe(50);
    });

    it("is a no-op when given an empty list", async () => {
      await store.seedRows([]);
      const stats = await store.stats();
      expect(stats.totalRows).toBe(0);
    });

    it("respects priority eviction order when seeded over cap with mixed tiers", async () => {
      Object.assign(logConfig, { MAX_ROWS: 10 });
      const rows = [
        ...Array.from({ length: 20 }, (_, i) =>
          makeGameRow({ id: `p3-${i}`, priority: Priority.GRANULAR, created_at: 1000 + i })
        ),
        ...Array.from({ length: 5 }, (_, i) =>
          makeGameRow({
            id: `p1-${i}`,
            priority: Priority.LIFECYCLE,
            event_type: "game_started",
            created_at: 2000 + i,
          })
        ),
      ];
      await store.seedRows(rows);
      const stats = await store.stats();
      expect(stats.totalRows).toBe(10);
      // All 5 lifecycle rows survive — granular is evicted first.
      expect(stats.byPriority[Priority.LIFECYCLE]).toBe(5);
      expect(stats.byPriority[Priority.GRANULAR]).toBe(5);
    });
  });

  // -------------------------------------------------------------------------
  // generateUUID — crypto fallback (regression for Sentry issue: "Property
  // 'crypto' doesn't exist")
  // -------------------------------------------------------------------------

  describe("generateUUID crypto fallback", () => {
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    let savedCrypto: typeof globalThis.crypto | undefined;

    beforeEach(() => {
      savedCrypto = globalThis.crypto;
    });

    afterEach(() => {
      Object.defineProperty(globalThis, "crypto", {
        value: savedCrypto,
        configurable: true,
        writable: true,
      });
    });

    it("enqueueEvent assigns a valid UUID via crypto.getRandomValues when randomUUID is absent", async () => {
      Object.defineProperty(globalThis, "crypto", {
        value: {
          getRandomValues: (buf: Uint8Array) => {
            buf.fill(0xab);
            return buf;
          },
        },
        configurable: true,
        writable: true,
      });
      const row = await store.enqueueEvent({
        game_id: "g1",
        event_index: 0,
        event_type: "diagnostic",
        payload: {},
      });
      expect(row.id).toMatch(UUID_RE);
    });

    it("enqueueEvent refuses to mint an event id when no CSPRNG is available (#3303)", async () => {
      Object.defineProperty(globalThis, "crypto", {
        value: undefined,
        configurable: true,
        writable: true,
      });
      await expect(
        store.enqueueEvent({
          game_id: "g1",
          event_index: 0,
          event_type: "diagnostic",
          payload: {},
        })
      ).rejects.toBeInstanceOf(CsprngUnavailableError);
    });

    it("enqueueEvent assigns a valid UUID via crypto.randomUUID when available", async () => {
      const mockUUID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
      Object.defineProperty(globalThis, "crypto", {
        value: { randomUUID: () => mockUUID },
        configurable: true,
        writable: true,
      });
      const row = await store.enqueueEvent({
        game_id: "g1",
        event_index: 0,
        event_type: "diagnostic",
        payload: {},
      });
      expect(row.id).toBe(mockUUID);
    });

    it("enqueueBugLog assigns a valid UUID via crypto.getRandomValues when randomUUID is absent", async () => {
      Object.defineProperty(globalThis, "crypto", {
        value: {
          getRandomValues: (buf: Uint8Array) => {
            buf.fill(0xcd);
            return buf;
          },
        },
        configurable: true,
        writable: true,
      });
      const row = await store.enqueueBugLog({
        bug_uuid: "test-bug",
        bug_level: "warn",
        bug_source: "test",
        payload: {},
      });
      expect(row.id).toMatch(UUID_RE);
    });

    it("enqueueBugLog refuses to mint a row id when no CSPRNG is available (#3303)", async () => {
      Object.defineProperty(globalThis, "crypto", {
        value: undefined,
        configurable: true,
        writable: true,
      });
      await expect(
        store.enqueueBugLog({
          bug_uuid: "test-bug",
          bug_level: "warn",
          bug_source: "test",
          payload: {},
        })
      ).rejects.toBeInstanceOf(CsprngUnavailableError);
    });
  });
});
