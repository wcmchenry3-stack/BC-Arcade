import AsyncStorage from "@react-native-async-storage/async-storage";

import { BugReportLimiter } from "../bugReportLimiter";
import { EventStore } from "../eventStore";
import { GameEventClientImpl } from "../gameEventClient";
import { logConfig, resetLogConfig } from "../eventQueueConfig";
import { PendingGamesStore } from "../pendingGamesStore";

async function flushMicrotasks(): Promise<void> {
  // Fire-and-forget operations need one or two microtask turns to land.
  await new Promise((r) => setTimeout(r, 10));
}

describe("GameEventClient", () => {
  let store: EventStore;
  let games: PendingGamesStore;
  let limiter: BugReportLimiter;
  let client: GameEventClientImpl;

  beforeEach(async () => {
    await AsyncStorage.clear();
    resetLogConfig();
    store = new EventStore();
    games = new PendingGamesStore();
    limiter = new BugReportLimiter();
    client = new GameEventClientImpl(store, games, limiter);
    await client.init();
  });

  afterEach(() => {
    resetLogConfig();
  });

  // -------------------------------------------------------------------------
  // startGame
  // -------------------------------------------------------------------------

  it("startGame returns a UUID synchronously", () => {
    const id = client.startGame("yacht");
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("startGame enqueues a game_started event at index 0", async () => {
    const id = client.startGame("yacht", { seat: 1 });
    await flushMicrotasks();
    const rows = await store.peek(10);
    expect(rows.length).toBe(1);
    const row = rows[0];
    if (row === undefined) throw new Error("Expected row");
    expect(row.log_type).toBe("game_event");
    if (row.log_type === "game_event") {
      expect(row.game_id).toBe(id);
      expect(row.event_index).toBe(0);
      expect(row.event_type).toBe("game_started");
      expect(row.payload).toMatchObject({
        game_type: "yacht",
        metadata: { seat: 1 },
      });
    }
  });

  // -------------------------------------------------------------------------
  // enqueueEvent
  // -------------------------------------------------------------------------

  it("enqueueEvent auto-increments event_index monotonically", async () => {
    const id = client.startGame("yacht");
    client.enqueueEvent(id, { type: "roll", data: { dice: [1, 2, 3, 4, 5] } });
    client.enqueueEvent(id, { type: "roll", data: { dice: [6, 6, 6, 6, 6] } });
    client.enqueueEvent(id, { type: "score", data: { category: "yacht" } });
    await flushMicrotasks();

    const rows = await store.peek(20);
    const indices = rows
      .filter((r) => r.log_type === "game_event")
      .map((r) => (r.log_type === "game_event" ? r.event_index : -1))
      .sort((a, b) => a - b);
    // peek() reorders by priority tier, so we compare the set of assigned
    // indices — the monotonic contract is about what the counter emits,
    // not about storage order.
    expect(indices).toEqual([0, 1, 2, 3]);
  });

  it("enqueueEvent drops silently if game is unknown", async () => {
    client.enqueueEvent("unknown", { type: "move" });
    await flushMicrotasks();
    const rows = await store.peek(10);
    expect(rows).toEqual([]);
  });

  it("enqueueEvent drops silently after completeGame", async () => {
    const id = client.startGame("yacht");
    client.completeGame(id, { finalScore: 100 });
    await flushMicrotasks();
    client.enqueueEvent(id, { type: "roll" });
    await flushMicrotasks();

    const rows = await store.peek(20);
    // game_started + game_ended, no roll.
    const types = rows
      .filter((r) => r.log_type === "game_event")
      .map((r) => (r.log_type === "game_event" ? r.event_type : ""));
    expect(types).toEqual(["game_started", "game_ended"]);
  });

  // -------------------------------------------------------------------------
  // completeGame
  // -------------------------------------------------------------------------

  it("completeGame enqueues game_ended with the summary", async () => {
    const id = client.startGame("yacht");
    client.completeGame(id, { finalScore: 250, outcome: "win", durationMs: 30_000 });
    await flushMicrotasks();

    const rows = await store.peek(20);
    const ended = rows.find((r) => r.log_type === "game_event" && r.event_type === "game_ended");
    expect(ended).toBeDefined();
    if (ended && ended.log_type === "game_event") {
      expect(ended.payload).toMatchObject({
        finalScore: 250,
        outcome: "win",
        durationMs: 30_000,
      });
    }
    expect(games.get(id)?.completed).toBe(true);
  });

  // -------------------------------------------------------------------------
  // discardGame (#2619)
  // -------------------------------------------------------------------------

  it("discardGame forgets the pending record and drops only its queued events", async () => {
    const discarded = client.startGame("cascade");
    client.enqueueEvent(discarded, { type: "drop" });
    const kept = client.startGame("cascade");
    client.reportBug("warn", "src", "msg");
    // Straight after startGame, before its events have landed — the discard
    // must still remove game_started.
    client.discardGame(discarded);
    await flushMicrotasks();

    expect(games.get(discarded)).toBeUndefined();
    expect(games.get(kept)).toBeDefined();
    const rows = await store.peek(20, { includeDeadLettered: true, includeFuture: true });
    const gameIds = rows.flatMap((r) => (r.log_type === "game_event" ? [r.game_id] : []));
    expect(gameIds).toEqual([kept]);
    expect(rows.filter((r) => r.log_type === "bug_log")).toHaveLength(1);

    // Persisted too: a fresh store rehydrated from AsyncStorage has no record.
    const rehydrated = new PendingGamesStore();
    await rehydrated.init();
    expect(rehydrated.get(discarded)).toBeUndefined();
    expect(rehydrated.get(kept)).toBeDefined();
  });

  it("enqueueEvent and completeGame after discardGame are dropped", async () => {
    const id = client.startGame("cascade");
    client.discardGame(id);
    client.enqueueEvent(id, { type: "drop" });
    client.completeGame(id, { outcome: "abandoned" });
    await flushMicrotasks();

    expect(games.get(id)).toBeUndefined();
    expect(await store.peek(20)).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // reportBug — rate limiter integration
  // -------------------------------------------------------------------------

  it("reportBug enqueues up to the burst allowance then drops silently", async () => {
    logConfig.REPORT_BUG_BURST_ALLOWANCE = 3;
    logConfig.REPORT_BUG_MAX_PER_MINUTE_PER_SOURCE = 0;
    for (let i = 0; i < 10; i += 1) {
      client.reportBug("warn", "loop-source", `msg${i}`);
    }
    await flushMicrotasks();
    const rows = await store.peek(20);
    const bugs = rows.filter((r) => r.log_type === "bug_log");
    expect(bugs.length).toBe(3);
  });

  it("reportBug uses isolated buckets per source", async () => {
    logConfig.REPORT_BUG_BURST_ALLOWANCE = 1;
    logConfig.REPORT_BUG_MAX_PER_MINUTE_PER_SOURCE = 0;
    client.reportBug("warn", "source-a", "first");
    client.reportBug("warn", "source-a", "dropped");
    client.reportBug("warn", "source-b", "first from b");
    await flushMicrotasks();

    const rows = await store.peek(20);
    const bugs = rows.filter((r) => r.log_type === "bug_log");
    expect(bugs.length).toBe(2);
  });

  // -------------------------------------------------------------------------
  // getQueueStats + clearAll
  // -------------------------------------------------------------------------

  it("getQueueStats passes through to the store", async () => {
    client.startGame("yacht");
    client.reportBug("warn", "test", "hi");
    await flushMicrotasks();
    const stats = await client.getQueueStats();
    expect(stats.totalRows).toBeGreaterThanOrEqual(2);
    expect(stats.byLogType.game_event).toBeGreaterThanOrEqual(1);
    expect(stats.byLogType.bug_log).toBeGreaterThanOrEqual(1);
  });

  it("clearAll empties store + games + limiter", async () => {
    logConfig.REPORT_BUG_BURST_ALLOWANCE = 1;
    logConfig.REPORT_BUG_MAX_PER_MINUTE_PER_SOURCE = 0;
    client.startGame("yacht");
    client.reportBug("warn", "test", "hi");
    client.reportBug("warn", "test", "dropped");
    await flushMicrotasks();

    await client.clearAll();
    const stats = await client.getQueueStats();
    expect(stats.totalRows).toBe(0);
    // Limiter reset → new burst allowance available.
    client.reportBug("warn", "test", "new session");
    await flushMicrotasks();
    const rows = await store.peek(10);
    expect(rows.length).toBe(1);
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

    it("uses crypto.getRandomValues when randomUUID is absent", () => {
      const getRandomValues = jest.fn((buf: Uint8Array) => {
        buf.fill(0xab);
        return buf;
      });
      Object.defineProperty(globalThis, "crypto", {
        value: { getRandomValues },
        configurable: true,
        writable: true,
      });
      const id = client.startGame("yacht");
      expect(id).toMatch(UUID_RE);
      expect(getRandomValues).toHaveBeenCalled();
    });

    it("falls back to Math.random when crypto is completely absent", () => {
      Object.defineProperty(globalThis, "crypto", {
        value: undefined,
        configurable: true,
        writable: true,
      });
      const id = client.startGame("yacht");
      expect(id).toMatch(UUID_RE);
    });

    it("uses crypto.randomUUID when available", () => {
      const mockUUID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
      Object.defineProperty(globalThis, "crypto", {
        value: { randomUUID: () => mockUUID },
        configurable: true,
        writable: true,
      });
      const id = client.startGame("yacht");
      expect(id).toBe(mockUUID);
    });
  });
});
