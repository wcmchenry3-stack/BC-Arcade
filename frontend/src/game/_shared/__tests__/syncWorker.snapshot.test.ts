/**
 * One snapshot per pass (#2959): a flush peeks the queue once and derives the
 * per-game batches, the bug logs and the completion check from it; every
 * 429/5xx/network response goes through one `transientFailure`; dead-lettering
 * and the 404 re-flip go through the stores; storage reads per flush are
 * bounded.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

import { BugReportLimiter } from "../bugReportLimiter";
import { EventStore } from "../eventStore";
import { GameEventClientImpl } from "../gameEventClient";
import { PendingGamesStore } from "../pendingGamesStore";
import { SyncResponse } from "../syncApi";
import { SyncWorker } from "../syncWorker";
import { logConfig, resetLogConfig } from "../eventQueueConfig";
import { MockSyncApi, asSyncApi, err, flushMicro, ok } from "./helpers/syncWorkerFixtures";

const getItem = AsyncStorage.getItem as jest.Mock;

describe("SyncWorker — one snapshot per pass (#2959)", () => {
  let store: EventStore;
  let games: PendingGamesStore;
  let client: GameEventClientImpl;
  let api: MockSyncApi;
  let worker: SyncWorker;

  beforeEach(async () => {
    await AsyncStorage.clear();
    resetLogConfig();
    store = new EventStore();
    games = new PendingGamesStore();
    client = new GameEventClientImpl(store, games, new BugReportLimiter());
    api = new MockSyncApi();
    worker = new SyncWorker(store, games, asSyncApi(api));
    await client.init();
  });

  afterEach(() => {
    resetLogConfig();
    worker.stop();
  });

  /** Open a game the player has acted in (#2654), so SyncWorker will send it. */
  function startPlayed(gameType: string): string {
    const gameId = client.startGame(gameType);
    client.markStarted(gameId);
    return gameId;
  }

  const paths = () => api.calls.map((c) => `${c.method} ${c.path}`);

  // -------------------------------------------------------------------------
  // Storage reads per flush
  // -------------------------------------------------------------------------

  describe("storage reads", () => {
    it("an empty queue: at most 4 reads cold (the tiers' first load), none once warm", async () => {
      getItem.mockClear();
      await worker.flush();
      expect(getItem.mock.calls.length).toBeLessThanOrEqual(4);

      getItem.mockClear();
      await worker.flush();
      expect(getItem).not.toHaveBeenCalled();
    });

    it("3 pending games in a cold process: at most 8 reads, one peek, and the full sync", async () => {
      const ids: string[] = [];
      for (let i = 0; i < 3; i += 1) {
        const gid = startPlayed("yacht");
        client.enqueueEvent(gid, { type: "roll", data: { i } });
        client.enqueueEvent(gid, { type: "score", data: { i } });
        ids.push(gid);
      }
      client.completeGame(ids[0]!, { outcome: "completed", finalScore: 9 });
      await flushMicro();

      // A new process over the same device storage: pending games and tiers
      // both load from disk inside this one flush.
      const nextStore = new EventStore();
      const nextGames = new PendingGamesStore();
      const next = new SyncWorker(nextStore, nextGames, asSyncApi(api));
      const peek = jest.spyOn(nextStore, "peek");
      api.defaultResponse = ok();
      getItem.mockClear();

      const result = await next.flush();

      expect(getItem.mock.calls.length).toBeLessThanOrEqual(8);
      expect(peek).toHaveBeenCalledTimes(1);
      expect(result.deadLettered).toBe(0);
      for (const gid of ids) {
        expect(paths()).toContain(`POST /games/${gid}/events`);
      }
      // The completion rode the same snapshot: after its events, in the same pass.
      const first = ids[0]!;
      const eventsAt = paths().indexOf(`POST /games/${first}/events`);
      const patchAt = paths().indexOf(`PATCH /games/${first}/complete`);
      expect(eventsAt).toBeGreaterThanOrEqual(0);
      expect(patchAt).toBeGreaterThan(eventsAt);
      expect(await nextStore.peek(100)).toEqual([]);

      getItem.mockClear();
      await next.flush();
      expect(getItem).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // The completion check is derived from the snapshot
  // -------------------------------------------------------------------------

  describe("completions", () => {
    it("a game completed during the pass waits for the next one, so its game_ended goes first", async () => {
      const gid = startPlayed("yacht");
      client.enqueueEvent(gid, { type: "roll" });
      await flushMicro();
      api.defaultResponse = ok();
      // The player finishes while this pass is posting the game's events.
      const request = jest.spyOn(api, "request");
      request.mockImplementation(async (method, path, body) => {
        const res: SyncResponse = await MockSyncApi.prototype.request.call(api, method, path, body);
        if (path.endsWith("/events") && !games.get(gid)?.completed) {
          client.completeGame(gid, { outcome: "completed", finalScore: 9 });
        }
        return res;
      });

      await worker.flush();
      expect(paths()).toEqual(["POST /games", `POST /games/${gid}/events`]);
      expect(games.get(gid)?.completed).toBe(true);

      await flushMicro();
      await worker.flush();
      expect(paths()).toEqual([
        "POST /games",
        `POST /games/${gid}/events`,
        `POST /games/${gid}/events`,
        `PATCH /games/${gid}/complete`,
      ]);
      const second = api.calls[2]!.body as { events: Array<{ event_type: string }> };
      expect(second.events.map((e) => e.event_type)).toEqual(["game_ended"]);
      expect(games.get(gid)).toBeUndefined();
    });

    it("a game with an event the server rejected (404) stays outstanding: no PATCH", async () => {
      api.defaultResponse = ok();
      api.onNext((p) => p.endsWith("/events"), err(404));
      const gid = startPlayed("yacht");
      client.completeGame(gid, { outcome: "completed" });
      await flushMicro();

      await worker.flush();

      expect(paths().filter((p) => p.startsWith("PATCH"))).toEqual([]);
      expect(games.get(gid)?.startedSynced).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // The snapshot sees every row (PR #3016 review)
  // -------------------------------------------------------------------------

  describe("snapshot limit", () => {
    it("a MAX_ROWS lowered under the queue on disk still sends every event before the PATCH", async () => {
      api.defaultResponse = ok();
      const gid = startPlayed("yacht");
      for (let i = 0; i < 6; i += 1) client.enqueueEvent(gid, { type: "roll", data: { i } });
      client.completeGame(gid, { outcome: "completed", finalScore: 1 });
      await flushMicro();
      // 8 rows queued (game_started, 6 rolls, game_ended); the cap drops under them.
      logConfig.MAX_ROWS = 3;

      await worker.flush();

      const sent = api.calls
        .filter((c) => c.path.endsWith("/events"))
        .flatMap((c) => (c.body as { events: Array<{ event_type: string }> }).events)
        .map((e) => e.event_type);
      expect(sent).toHaveLength(8);
      expect(sent.filter((t) => t === "roll")).toHaveLength(6);
      expect(sent).toContain("game_ended");
      expect(paths()[paths().length - 1]).toBe(`PATCH /games/${gid}/complete`);
      expect(await store.peek(100, { includeFuture: true })).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // Step 1's terminal 4xx dead-letters the parked rows too (PR #3016 review)
  // -------------------------------------------------------------------------

  describe("deadLetterGameAndEvents", () => {
    it("rows parked by a per-row backoff do not come back as orphans once the game is forgotten", async () => {
      const gid = startPlayed("yacht");
      client.enqueueEvent(gid, { type: "roll" });
      await flushMicro();
      // Pass 1: created, then its events are refused with a 500 → parked.
      api.onNext((p) => p === "/games", ok());
      api.onNext((p) => p.endsWith("/events"), err(500));
      await worker.flush(0);
      const parked = await store.peek(100, { includeFuture: true });
      expect(parked.every((r) => r.next_retry_at !== null && r.next_retry_at > 0)).toBe(true);
      // The server loses the game; step 1 will recreate it...
      await games.update(gid, { startedSynced: false });
      // ...and refuses it for good.
      api.onNext((p) => p === "/games", err(400));
      const pass2 = await worker.flush(1_500);
      expect(pass2.deadLettered).toBe(1);
      expect(games.get(gid)).toBeUndefined();
      const rows = await store.peek(100, { includeDeadLettered: true, includeFuture: true });
      expect(rows).toHaveLength(2);
      expect(rows.every((r) => r.dead_lettered)).toBe(true);

      // Long after the backoff: nothing is posted as an orphan.
      api.calls = [];
      const pass3 = await worker.flush(1_000_000);
      expect(pass3.deadLettered).toBe(0);
      expect(paths()).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // One 404 stops the game's chunks (PR #3016 review)
  // -------------------------------------------------------------------------

  describe("404 on a multi-chunk game", () => {
    it("re-flips once and posts no further chunk of that game in the pass", async () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Sentry = require("@sentry/react-native");
      Sentry.captureMessage.mockClear();
      logConfig.GAME_EVENT_BATCH_SIZE = 2;
      api.defaultResponse = ok();
      api.onNext((p) => p.endsWith("/events"), err(404));
      const gid = startPlayed("yacht");
      for (let i = 0; i < 5; i += 1) client.enqueueEvent(gid, { type: "roll", data: { i } });
      const other = startPlayed("sudoku");
      await flushMicro();
      const update = jest.spyOn(games, "update");

      await worker.flush();

      expect(paths().filter((p) => p === `POST /games/${gid}/events`)).toHaveLength(1);
      expect(update).toHaveBeenCalledTimes(1);
      expect(
        (Sentry.captureMessage as jest.Mock).mock.calls.filter(([m]: [string]) => m.includes("404"))
      ).toHaveLength(1);
      // The other game's events still went out in the same pass.
      expect(paths()).toContain(`POST /games/${other}/events`);
      // All 6 rows of the 404'd game are still live for the next pass.
      const live = (await store.peek(100)).filter(
        (r) => r.log_type === "game_event" && r.game_id === gid
      );
      expect(live).toHaveLength(6);
    });
  });

  // -------------------------------------------------------------------------
  // transientFailure
  // -------------------------------------------------------------------------

  describe("transientFailure", () => {
    type Spied = { transientFailure: (...args: unknown[]) => Promise<boolean> };

    // Global backoff: Retry-After on a 429, else BACKOFF_BASE_MS × 2^(exponent−1).
    // Per-row: Retry-After on a 429, else BACKOFF_BASE_MS × 2^(retry_count+1).
    it.each([
      [429, 5_000, 5_000, 5_000],
      [500, null, 1_000, 2_000],
      [503, null, 1_000, 2_000],
    ])(
      "a %s on events goes through transientFailure once and stops the pass",
      async (status, retryAfterMs, backoffMs, rowDelayMs) => {
        const spy = jest.spyOn(worker as unknown as Spied, "transientFailure");
        api.onNext((p) => p === "/games", ok());
        api.onNext((p) => p.endsWith("/events"), err(status, retryAfterMs));
        const gid = startPlayed("yacht");
        client.enqueueEvent(gid, { type: "roll" });
        client.reportBug("warn", "src", "msg");
        await flushMicro();

        const result = await worker.flush(0);

        expect(spy).toHaveBeenCalledTimes(1);
        expect(result.backoffMs).toBe(backoffMs);
        expect(worker.getBackoffUntil()).toBe(backoffMs);
        // The pass stopped: bug logs never went out.
        expect(paths()).toEqual(["POST /games", `POST /games/${gid}/events`]);
        // The refused rows are backed off per row, not deleted.
        const rows = await store.peek(100, { includeFuture: true });
        const events = rows.filter((r) => r.log_type === "game_event");
        expect(events).toHaveLength(2);
        expect(events.every((r) => r.retry_count === 1 && r.next_retry_at === rowDelayMs)).toBe(
          true
        );
      }
    );

    it("a 503 on PATCH /complete goes through it too, with no rows to back off", async () => {
      const spy = jest.spyOn(worker as unknown as Spied, "transientFailure");
      api.defaultResponse = ok();
      api.onNext((p) => p.endsWith("/complete"), err(503));
      const gid = startPlayed("yacht");
      client.completeGame(gid, { outcome: "completed" });
      await flushMicro();

      const result = await worker.flush(0);

      expect(spy).toHaveBeenCalledTimes(1);
      expect(result.backoffMs).toBe(1_000);
      expect(games.get(gid)?.completeSynced).toBe(false);
    });

    it("a 2xx never reaches it", async () => {
      const spy = jest.spyOn(worker as unknown as Spied, "transientFailure");
      api.defaultResponse = ok();
      const gid = startPlayed("yacht");
      client.completeGame(gid, { outcome: "completed" });
      await flushMicro();
      await worker.flush();
      expect(spy).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Store-side bookkeeping
  // -------------------------------------------------------------------------

  describe("store bookkeeping", () => {
    it("orphan events are dead-lettered through store.markDeadLettered", async () => {
      const gid = startPlayed("yacht");
      client.enqueueEvent(gid, { type: "roll" });
      await flushMicro();
      await games.forget(gid);
      const mark = jest.spyOn(store, "markDeadLettered");

      const result = await worker.flush();

      expect(mark).toHaveBeenCalledTimes(1);
      expect(result.deadLettered).toBe(2);
      expect(await store.peek(100)).toEqual([]);
      const dead = await store.peek(100, { includeDeadLettered: true });
      expect(dead).toHaveLength(2);
      expect(dead.every((r) => r.dead_lettered)).toBe(true);
    });

    it("a 404 on events re-flips startedSynced through games.update, persisted", async () => {
      api.onNext((p) => p === "/games", ok());
      api.onNext((p) => p.endsWith("/events"), err(404));
      const update = jest.spyOn(games, "update");
      const gid = startPlayed("yacht");
      await flushMicro();

      await worker.flush();

      expect(update).toHaveBeenCalledWith(gid, { startedSynced: false });
      const fresh = new PendingGamesStore();
      await fresh.init();
      expect(fresh.get(gid)?.startedSynced).toBe(false);
    });

    it("a 404 on PATCH /complete re-flips startedSynced the same way", async () => {
      api.defaultResponse = ok();
      api.onNext((p) => p.endsWith("/complete"), err(404));
      const update = jest.spyOn(games, "update");
      const gid = startPlayed("yacht");
      client.completeGame(gid, { outcome: "completed" });
      await flushMicro();

      await worker.flush();

      expect(update).toHaveBeenCalledWith(gid, { startedSynced: false });
      const fresh = new PendingGamesStore();
      await fresh.init();
      expect(fresh.get(gid)?.startedSynced).toBe(false);
      expect(fresh.get(gid)?.completed).toBe(true);
    });
  });
});
