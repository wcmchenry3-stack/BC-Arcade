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
  // #2654 — deferred create flag + startup sweep of a killed process's games
  // -------------------------------------------------------------------------

  describe("started flag (#2654)", () => {
    it("startGame records the game as not started", () => {
      const id = client.startGame("yacht");
      expect(games.get(id)?.started).toBe(false);
    });

    it("markStarted marks the pending game started", () => {
      const id = client.startGame("yacht");
      client.markStarted(id);
      expect(games.get(id)?.started).toBe(true);
    });

    it("completeGame on an unstarted game marks it started", () => {
      const id = client.startGame("yacht");
      client.completeGame(id, { outcome: "completed", finalScore: 10 });
      expect(games.get(id)?.started).toBe(true);
      expect(games.get(id)?.completed).toBe(true);
    });

    it("completeGame takes the completion time when one is given", () => {
      const id = client.startGame("yacht");
      client.completeGame(id, { outcome: "abandoned" }, undefined, { completedAt: 1234 });
      expect(games.get(id)?.completedAt).toBe(1234);
    });
  });

  describe("startup sweep (#2654)", () => {
    const DAY = 24 * 60 * 60 * 1000;

    /** A new app process on the same device storage. `init()` is not called. */
    async function relaunch(): Promise<{
      store: EventStore;
      games: PendingGamesStore;
      client: GameEventClientImpl;
    }> {
      await flushMicrotasks(); // let the killed process's writes land
      const nextStore = new EventStore();
      const nextGames = new PendingGamesStore();
      return {
        store: nextStore,
        games: nextGames,
        client: new GameEventClientImpl(nextStore, nextGames, new BugReportLimiter()),
      };
    }

    async function eventTypes(s: EventStore, gameId: string): Promise<string[]> {
      const rows = await s.peek(100, { includeDeadLettered: true, includeFuture: true });
      return rows
        .filter((r) => r.log_type === "game_event" && r.game_id === gameId)
        .map((r) => (r.log_type === "game_event" ? r.event_type : ""));
    }

    function legacyRecord(extra: Record<string, unknown>) {
      return {
        gameType: "yacht",
        metadata: {},
        startedAt: 500_000,
        startedSynced: false,
        nextEventIndex: 1,
        completed: false,
        completedAt: null,
        completeSummary: null,
        completeSynced: false,
        ...extra,
      };
    }

    let now: jest.SpyInstance<number, []>;
    beforeEach(() => {
      now = jest.spyOn(Date, "now").mockReturnValue(1_000_000);
    });
    afterEach(() => {
      now.mockRestore();
    });

    it("keeps a started game under 24 h old open, for its screen to resume", async () => {
      const id = client.startGame("yacht");
      client.markStarted(id);
      client.enqueueEvent(id, { type: "roll" });
      now.mockReturnValue(1_000_000 + DAY - 1);

      const next = await relaunch();
      await next.client.init();

      expect(next.games.get(id)?.completed).toBe(false);
      expect(next.games.get(id)?.started).toBe(true);
      expect(await eventTypes(next.store, id)).not.toContain("game_ended");
    });

    it("abandons a started game 24 h old, at its last event", async () => {
      const id = client.startGame("yacht");
      client.markStarted(id);
      now.mockReturnValue(1_090_000);
      client.enqueueEvent(id, { type: "roll" });
      // The process is killed here; the next launch is a day after the game started.
      now.mockReturnValue(1_000_000 + DAY);

      const next = await relaunch();
      await next.client.init();

      const g = next.games.get(id);
      expect(g?.completed).toBe(true);
      expect(g?.completeSummary).toEqual({ outcome: "abandoned" });
      expect(g?.completedAt).toBe(1_090_000);
      // peek() orders by priority tier, so compare as a set.
      expect((await eventTypes(next.store, id)).sort()).toEqual([
        "game_ended",
        "game_started",
        "roll",
      ]);
    });

    it("an orphan never reopened is kept on each launch until it is 24 h old, then abandoned", async () => {
      const id = client.startGame("yacht");
      client.markStarted(id);

      now.mockReturnValue(1_000_000 + DAY / 2);
      const second = await relaunch();
      await second.client.init();
      expect(second.games.get(id)?.completed).toBe(false);

      now.mockReturnValue(1_000_000 + DAY + 1);
      const third = await relaunch();
      await third.client.init();
      expect(third.games.get(id)?.completed).toBe(true);
      expect(third.games.get(id)?.completeSummary).toEqual({ outcome: "abandoned" });
    });

    it("drops an unstarted game and its events; nothing is recorded as abandoned", async () => {
      const id = client.startGame("yacht");
      client.enqueueEvent(id, { type: "deal" });

      const next = await relaunch();
      await next.client.init();

      expect(next.games.get(id)).toBeUndefined();
      expect(await eventTypes(next.store, id)).toEqual([]);
      // Gone from disk too.
      const after = await relaunch();
      await after.games.init();
      expect(after.games.get(id)).toBeUndefined();
    });

    describe("progress outcome override (#2682)", () => {
      it("a session that reported a win before the kill is closed as a win, not abandoned", async () => {
        const id = client.startGame("yacht");
        client.markStarted(id);
        client.setProgressOutcome(id, "win");
        now.mockReturnValue(1_090_000);
        client.enqueueEvent(id, { type: "roll" });
        now.mockReturnValue(1_000_000 + DAY);

        const next = await relaunch();
        await next.client.init();

        const g = next.games.get(id);
        expect(g?.completeSummary).toEqual({ outcome: "win" });
        expect(g?.completedAt).toBe(1_090_000);
      });

      it("a session with no override is still swept as abandoned", async () => {
        const id = client.startGame("yacht");
        client.markStarted(id);
        now.mockReturnValue(1_000_000 + DAY);

        const next = await relaunch();
        await next.client.init();

        expect(next.games.get(id)?.completeSummary).toEqual({ outcome: "abandoned" });
      });

      it("ignores a bad override and sweeps as abandoned", async () => {
        const id = client.startGame("yacht");
        client.markStarted(id);
        await flushMicrotasks();
        // Bypass the client's own "win"-only type to simulate corrupt/older
        // data on disk — the sweep must not trust it blindly.
        const raw = JSON.parse((await AsyncStorage.getItem("pending_games_v1")) ?? "{}");
        raw[id].progressOutcome = "loss";
        await AsyncStorage.setItem("pending_games_v1", JSON.stringify(raw));
        now.mockReturnValue(1_000_000 + DAY);

        const next = await relaunch();
        await next.client.init();

        expect(next.games.get(id)?.completeSummary).toEqual({ outcome: "abandoned" });
      });

      it("a completed game's override no-ops (nothing left to sweep)", async () => {
        const id = client.startGame("yacht");
        client.completeGame(id, { outcome: "completed" });
        client.setProgressOutcome(id, "win");
        await flushMicrotasks();

        expect(games.get(id)?.progressOutcome).toBeUndefined();
      });
    });

    describe("an older build's record, which has no `started`", () => {
      async function loadLegacy(extra: Record<string, unknown>) {
        await AsyncStorage.setItem(
          "pending_games_v1",
          JSON.stringify({ legacy: legacyRecord(extra) })
        );
        now.mockReturnValue(500_000 + DAY); // old enough to be abandoned if started
        const next = await relaunch();
        await next.client.init();
        return next;
      }

      it("already created on the server: started, so it is closed as abandoned", async () => {
        const next = await loadLegacy({ startedSynced: true });
        const g = next.games.get("legacy");
        expect(g?.started).toBe(true);
        expect(g?.completeSummary).toEqual({ outcome: "abandoned" });
        // No last-event time on an older record: its start is the last activity known.
        expect(g?.completedAt).toBe(500_000);
      });

      it("with an event beyond game_started: started, so it is closed as abandoned", async () => {
        const next = await loadLegacy({ nextEventIndex: 2 });
        expect(next.games.get("legacy")?.started).toBe(true);
        expect(next.games.get("legacy")?.completeSummary).toEqual({ outcome: "abandoned" });
      });

      it("never sent, with only game_started: unstarted, so it is discarded", async () => {
        const next = await loadLegacy({ nextEventIndex: 1 });
        expect(next.games.get("legacy")).toBeUndefined();
      });
    });

    it("leaves a completed game from the killed process as it was", async () => {
      const id = client.startGame("yacht");
      client.completeGame(id, { outcome: "completed", finalScore: 42 });

      const next = await relaunch();
      await next.client.init();

      expect(next.games.get(id)?.completeSummary).toEqual({ outcome: "completed", finalScore: 42 });
      expect(await eventTypes(next.store, id)).toEqual(["game_started", "game_ended"]);
    });

    it("does not sweep games started in this process before init() resolves", async () => {
      const killed = client.startGame("yacht");
      client.markStarted(killed);
      now.mockReturnValue(1_000_000 + DAY);

      const next = await relaunch();
      const initDone = next.client.init();
      const played = next.client.startGame("twenty48");
      next.client.markStarted(played);
      const untouched = next.client.startGame("sudoku");
      await initDone;

      expect(next.games.get(killed)?.completed).toBe(true);
      expect(next.games.get(played)?.completed).toBe(false);
      expect(next.games.get(untouched)).toBeDefined();
      expect(next.games.get(untouched)?.completed).toBe(false);
      expect(await eventTypes(next.store, played)).toEqual(["game_started"]);
      expect(await eventTypes(next.store, untouched)).toEqual(["game_started"]);
    });

    it("does not sweep a game started in this process before init() is even called", async () => {
      const killed = client.startGame("yacht");
      client.markStarted(killed);
      now.mockReturnValue(1_000_000 + DAY);

      const next = await relaunch();
      const early = next.client.startGame("twenty48");
      next.client.markStarted(early);
      await flushMicrotasks();
      await next.client.init();

      expect(next.games.get(killed)?.completed).toBe(true);
      expect(next.games.get(early)?.completed).toBe(false);
      expect(next.games.get(early)?.started).toBe(true);
      expect(await eventTypes(next.store, early)).toEqual(["game_started"]);
    });

    it("sweeps once per process, however often init() is called", async () => {
      const id = client.startGame("yacht");
      client.markStarted(id);
      now.mockReturnValue(1_000_000 + DAY);

      const next = await relaunch();
      await Promise.all([next.client.init(), next.client.init()]);
      await next.client.init();

      expect((await eventTypes(next.store, id)).filter((t) => t === "game_ended")).toHaveLength(1);
    });

    it("writes the pending games once and deletes the discarded games' events in one pass", async () => {
      for (let i = 0; i < 3; i += 1) client.startGame("yacht"); // untouched: discarded
      for (let i = 0; i < 3; i += 1) client.markStarted(client.startGame("sudoku")); // 24 h old
      now.mockReturnValue(1_000_000 + DAY);
      const next = await relaunch();
      // Killed just before the relaunch: kept.
      const young = client.startGame("hearts");
      client.markStarted(young);
      await flushMicrotasks();

      const setItem = AsyncStorage.setItem as jest.Mock;
      setItem.mockClear();
      const deleteByGameIds = jest.spyOn(next.store, "deleteByGameIds");
      const deleteByGameId = jest.spyOn(next.store, "deleteByGameId");
      await next.client.init();
      await flushMicrotasks();

      const pendingWrites = setItem.mock.calls.filter(([k]) => k === "pending_games_v1");
      expect(pendingWrites).toHaveLength(1);
      expect(deleteByGameIds).toHaveBeenCalledTimes(1);
      expect(deleteByGameIds.mock.calls[0]?.[0]).toHaveLength(3);
      expect(deleteByGameId).not.toHaveBeenCalled();
      expect(next.games.all().filter(([, g]) => g.completed)).toHaveLength(3);
      expect(next.games.get(young)?.completed).toBe(false);
    });

    describe("resuming a killed process's game", () => {
      it("continues the same session: no new create, no game_started, same event counter", async () => {
        const id = client.startGame("yacht", { mode: "solo" });
        client.markStarted(id);
        client.enqueueEvent(id, { type: "roll" });

        const next = await relaunch();
        await next.client.init();
        expect(next.client.resumeGame("yacht")).toBe(id);
        next.client.enqueueEvent(id, { type: "score" });
        next.client.completeGame(id, { outcome: "completed", finalScore: 99 });
        await flushMicrotasks();

        expect(next.games.all()).toHaveLength(1);
        expect(next.games.get(id)?.completeSummary).toEqual({
          outcome: "completed",
          finalScore: 99,
        });
        const rows = await next.store.peek(100, { includeFuture: true });
        const indices = rows
          .filter((r) => r.log_type === "game_event")
          .map((r) => (r.log_type === "game_event" ? `${r.event_index}:${r.event_type}` : ""))
          .sort();
        expect(indices).toEqual(["0:game_started", "1:roll", "2:score", "3:game_ended"]);
      });

      it("a resumed game is this process's: a later sweep or fresh game leaves it alone", async () => {
        const id = client.startGame("yacht");
        client.markStarted(id);
        const next = await relaunch();
        await next.client.init();
        expect(next.client.resumeGame("yacht")).toBe(id);
        // A second resume finds nothing: it was adopted.
        expect(next.client.resumeGame("yacht")).toBeNull();
        next.client.markStarted(next.client.startGame("yacht"));
        await flushMicrotasks();
        expect(next.games.get(id)?.completed).toBe(false);
      });

      it("finds nothing for another game type, an unstarted game, or one 24 h old", async () => {
        const started = client.startGame("yacht");
        client.markStarted(started);
        client.startGame("sudoku"); // unstarted
        now.mockReturnValue(1_000_000 + DAY / 2);
        const next = await relaunch();
        await next.client.init();
        expect(next.client.resumeGame("twenty48")).toBeNull();
        expect(next.client.resumeGame("sudoku")).toBeNull();
        now.mockReturnValue(1_000_000 + DAY);
        expect(next.client.resumeGame("yacht")).toBeNull();
      });

      it("finds nothing before the pending games are loaded", async () => {
        const id = client.startGame("yacht");
        client.markStarted(id);
        const next = await relaunch();
        expect(next.client.resumeGame("yacht")).toBeNull();
      });

      it("matches on metadata when asked", async () => {
        const monday = client.startGame("daily_word", { puzzle_id: "mon" });
        client.markStarted(monday);
        const next = await relaunch();
        await next.client.init();
        expect(next.client.resumeGame("daily_word", { puzzle_id: "tue" })).toBeNull();
        expect(next.client.resumeGame("daily_word", { puzzle_id: "mon" })).toBe(monday);
      });

      it("adopts the most recently played orphan of the type and abandons the others", async () => {
        const older = client.startGame("yacht");
        client.markStarted(older);
        now.mockReturnValue(1_050_000);
        const newer = client.startGame("yacht");
        client.markStarted(newer);
        const next = await relaunch();
        await next.client.init();

        expect(next.client.resumeGame("yacht")).toBe(newer);
        await flushMicrotasks();
        expect(next.games.get(older)?.completeSummary).toEqual({ outcome: "abandoned" });
        expect(next.games.get(newer)?.completed).toBe(false);
      });
    });

    describe("starting a fresh game instead", () => {
      it("abandons the type's orphans when the fresh game is started, not when it opens", async () => {
        const orphan = client.startGame("yacht");
        client.markStarted(orphan);
        now.mockReturnValue(1_020_000);
        client.enqueueEvent(orphan, { type: "roll" });
        const other = client.startGame("sudoku");
        client.markStarted(other);

        now.mockReturnValue(1_100_000);
        const next = await relaunch();
        await next.client.init();
        const fresh = next.client.startGame("yacht");
        await flushMicrotasks();
        expect(next.games.get(orphan)?.completed).toBe(false); // opened, not played yet

        next.client.markStarted(fresh);
        await flushMicrotasks();
        expect(next.games.get(orphan)?.completeSummary).toEqual({ outcome: "abandoned" });
        expect(next.games.get(orphan)?.completedAt).toBe(1_020_000);
        expect(next.games.get(fresh)?.completed).toBe(false);
        expect(next.games.get(other)?.completed).toBe(false); // another game type
      });

      it("a fresh game completed before any markStarted also abandons them", async () => {
        const orphan = client.startGame("yacht");
        client.markStarted(orphan);
        const next = await relaunch();
        await next.client.init();
        next.client.completeGame(next.client.startGame("yacht"), { outcome: "completed" });
        await flushMicrotasks();
        expect(next.games.get(orphan)?.completeSummary).toEqual({ outcome: "abandoned" });
      });

      it("a fresh game started before the load: the sweep abandons the type's orphans", async () => {
        const orphan = client.startGame("yacht");
        client.markStarted(orphan);
        const next = await relaunch();
        expect(next.client.resumeGame("yacht")).toBeNull(); // not loaded yet
        next.client.markStarted(next.client.startGame("yacht"));
        await next.client.init();
        expect(next.games.get(orphan)?.completeSummary).toEqual({ outcome: "abandoned" });
      });
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
