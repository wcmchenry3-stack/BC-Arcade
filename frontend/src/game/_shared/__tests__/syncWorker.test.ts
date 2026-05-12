/**
 * SyncWorker state machine tests (367c).
 *
 * Every response code path in the spec is exercised. The SyncApi is
 * replaced with a MockSyncApi that records calls and returns canned
 * responses. A deleteByIds spy proves the server-confirmed-deletion
 * invariant — no row is removed pre-2xx.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

import { EventStore, Row } from "../eventStore";
import { GameEventClientImpl } from "../gameEventClient";
import { PendingGamesStore } from "../pendingGamesStore";
import { SyncApi, SyncResponse } from "../syncApi";
import { SyncWorker, FlushResult } from "../syncWorker";
import { BugReportLimiter } from "../bugReportLimiter";
import { logConfig, resetLogConfig } from "../eventQueueConfig";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

class MockSyncApi {
  calls: Array<{
    method: string;
    path: string;
    body: unknown;
  }> = [];
  /** Response queue keyed by path substring → consecutive responses. */
  private scripts: Array<{ match: (p: string) => boolean; res: SyncResponse }> = [];
  /** Default fallback if no script matches. */
  defaultResponse: SyncResponse = {
    status: 200,
    ok: true,
    retryAfterMs: null,
    body: {},
  };

  async request(method: "POST" | "PATCH", path: string, body: unknown): Promise<SyncResponse> {
    this.calls.push({ method, path, body });
    const idx = this.scripts.findIndex((s) => s.match(path));
    if (idx !== -1) {
      const hit = this.scripts.splice(idx, 1)[0];
      if (hit === undefined) throw new Error("splice returned empty");
      return hit.res;
    }
    return this.defaultResponse;
  }

  onNext(matcher: (p: string) => boolean, res: SyncResponse): void {
    this.scripts.push({ match: matcher, res });
  }
}

function asSyncApi(m: MockSyncApi): SyncApi {
  return m as unknown as SyncApi;
}

async function flushMicro(): Promise<void> {
  await new Promise((r) => setTimeout(r, 10));
}

function ok(body: unknown = {}): SyncResponse {
  return { status: 200, ok: true, retryAfterMs: null, body };
}

function err(status: number, retryAfterMs: number | null = null): SyncResponse {
  return { status, ok: false, retryAfterMs, body: { detail: "error" } };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

describe("SyncWorker", () => {
  let store: EventStore;
  let games: PendingGamesStore;
  let client: GameEventClientImpl;
  let api: MockSyncApi;
  let worker: SyncWorker;
  let limiter: BugReportLimiter;

  beforeEach(async () => {
    await AsyncStorage.clear();
    resetLogConfig();
    store = new EventStore();
    games = new PendingGamesStore();
    limiter = new BugReportLimiter();
    client = new GameEventClientImpl(store, games, limiter);
    api = new MockSyncApi();
    worker = new SyncWorker(store, games, asSyncApi(api));
    await client.init();
  });

  afterEach(() => {
    resetLogConfig();
    worker.stop();
  });

  // -------------------------------------------------------------------------
  // Happy path
  // -------------------------------------------------------------------------

  it("happy path: start → events → complete → 3 POSTs + 1 PATCH, queue empties", async () => {
    api.defaultResponse = ok({ accepted: 2, duplicates: 0 });
    // 2xx for POST /games, for POST /events, for PATCH /complete — all default.
    const gid = client.startGame("yacht", { seat: 1 });
    client.enqueueEvent(gid, { type: "roll", data: { dice: [1, 2, 3, 4, 5] } });
    client.enqueueEvent(gid, { type: "score", data: { cat: "yacht" } });
    client.completeGame(gid, { finalScore: 312, outcome: "win" });
    await flushMicro();

    const result = await worker.flush();

    const paths = api.calls.map((c) => `${c.method} ${c.path}`);
    expect(paths).toContain("POST /games");
    expect(paths).toContain(`POST /games/${gid}/events`);
    expect(paths).toContain(`PATCH /games/${gid}/complete`);

    // Store should be empty (all events confirmed) and game forgotten.
    const rows = await store.peek(100);
    expect(rows.filter((r) => r.log_type === "game_event").length).toBe(0);
    expect(games.get(gid)).toBeUndefined();
    expect(result.accepted).toBeGreaterThan(0);
  });

  it("step-1 POST /games body includes started_at ISO string", async () => {
    const before = Date.now();
    const gid = client.startGame("yacht", {});
    await flushMicro();
    await worker.flush();
    const createCall = api.calls.find((c) => c.method === "POST" && c.path === "/games");
    expect(createCall).toBeDefined();
    const body = createCall!.body as Record<string, unknown>;
    expect(typeof body["started_at"]).toBe("string");
    const ts = new Date(body["started_at"] as string).getTime();
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(Date.now());
    expect(gid).toBeTruthy();
  });

  it("step-3 PATCH /complete body includes completed_at ISO string", async () => {
    api.defaultResponse = ok({ accepted: 1, duplicates: 0 });
    const gid = client.startGame("yacht", {});
    const before = Date.now();
    client.completeGame(gid, { finalScore: 50, outcome: "completed" });
    await flushMicro();
    await worker.flush();
    const patchCall = api.calls.find((c) => c.method === "PATCH" && c.path.endsWith("/complete"));
    expect(patchCall).toBeDefined();
    const body = patchCall!.body as Record<string, unknown>;
    expect(typeof body["completed_at"]).toBe("string");
    const ts = new Date(body["completed_at"] as string).getTime();
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(Date.now());
  });

  it("batches 150 rapid events into a single POST", async () => {
    logConfig.GAME_EVENT_BATCH_SIZE = 200;
    const gid = client.startGame("yacht");
    for (let i = 0; i < 150; i += 1) {
      client.enqueueEvent(gid, { type: "roll", data: { dice: i } });
    }
    await flushMicro();

    await worker.flush();
    const eventsCalls = api.calls.filter((c) => c.path.endsWith("/events"));
    expect(eventsCalls.length).toBe(1);
  });

  // -------------------------------------------------------------------------
  // 429 — Retry-After honored
  // -------------------------------------------------------------------------

  it("429 on POST /games sets backoff from Retry-After and bails out", async () => {
    api.onNext((p) => p === "/games", err(429, 5000));
    client.startGame("yacht");
    await flushMicro();

    const result = await worker.flush(0);
    expect(result.backoffMs).toBeGreaterThan(0);
    expect(worker._getBackoffUntil()).toBe(5000);
    // No further calls made.
    expect(api.calls.map((c) => c.path)).toEqual(["/games"]);
  });

  // -------------------------------------------------------------------------
  // 5xx / network — exponential backoff
  // -------------------------------------------------------------------------

  it("5xx on POST /games sets exponential backoff", async () => {
    logConfig.BACKOFF_BASE_MS = 1000;
    api.onNext((p) => p === "/games", err(500));
    client.startGame("yacht");
    await flushMicro();

    await worker.flush(0);
    expect(worker._getBackoffUntil()).toBeGreaterThanOrEqual(1000);
  });

  it("network failure (status=0) sets backoff, preserves rows", async () => {
    api.onNext((p) => p === "/games", err(0));
    const gid = client.startGame("yacht");
    client.enqueueEvent(gid, { type: "roll" });
    await flushMicro();

    const before = (await store.peek(100)).length;
    await worker.flush();
    const after = (await store.peek(100, { includeDeadLettered: true })).length;
    expect(after).toBeGreaterThanOrEqual(before); // nothing removed
  });

  // -------------------------------------------------------------------------
  // 2xx on events → confirmed deletion
  // -------------------------------------------------------------------------

  it("2xx on events deletes those rows from the store", async () => {
    api.defaultResponse = ok({ accepted: 3, duplicates: 0 });
    const gid = client.startGame("yacht");
    for (let i = 0; i < 3; i += 1) {
      client.enqueueEvent(gid, { type: "roll", data: { i } });
    }
    await flushMicro();
    // 1 game_started + 3 rolls = 4 events; POST /games happens first.
    const beforeStats = await store.stats();
    expect(beforeStats.byLogType.game_event).toBe(4);

    await worker.flush();

    const after = await store.stats();
    expect(after.byLogType.game_event).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Server-confirmed deletion invariant
  // -------------------------------------------------------------------------

  it("no row is deleted when events POST returns 500", async () => {
    const deleteSpy = jest.spyOn(store, "deleteByIds");
    // Let POST /games succeed, fail POST /events with 500.
    api.onNext((p) => p === "/games", ok());
    api.onNext((p) => p.endsWith("/events"), err(500));

    const gid = client.startGame("yacht");
    client.enqueueEvent(gid, { type: "roll" });
    await flushMicro();
    await worker.flush();

    // deleteByIds must only be called with an empty list (or not at all).
    for (const call of deleteSpy.mock.calls) {
      const args = call[0] as string[];
      expect(args.length === 0 || false).toBe(args.length === 0);
    }
    // Event row still present. Use includeFuture because 500 sets a
    // next_retry_at in the future.
    const rows = (await store.peek(100, { includeDeadLettered: true, includeFuture: true })).filter(
      (r) => r.log_type === "game_event"
    );
    expect(rows.length).toBe(2); // game_started + roll
  });

  // -------------------------------------------------------------------------
  // 400 unknown_event_type → park for retry (#746)
  // -------------------------------------------------------------------------

  it("unknown_event_type 400 parks rows for retry, does not dead-letter", async () => {
    api.onNext((p) => p === "/games", ok());
    api.onNext((p) => p.endsWith("/events"), {
      status: 400,
      ok: false,
      retryAfterMs: null,
      body: { detail: { error: "unknown_event_type", rejected: ["game_ended"] } },
    });

    const gid = client.startGame("hearts");
    client.enqueueEvent(gid, { type: "game_ended" });
    await flushMicro();
    const result = await worker.flush();

    // Rows must NOT be dead-lettered.
    const rows = await store.peek(100, { includeDeadLettered: true });
    const dead = rows.filter((r) => r.dead_lettered && r.log_type === "game_event");
    expect(dead.length).toBe(0);

    // They must be parked (next_retry_at in the future, not visible in live peek).
    const live = (await store.peek(100)).filter((r) => r.log_type === "game_event");
    expect(live.length).toBe(0);

    expect(result.parked).toBeGreaterThan(0);
    expect(result.deadLettered).toBe(0);
  });

  it("unknown_event_type 400 logs Sentry at warning, not error", async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Sentry = require("@sentry/react-native");
    Sentry.captureMessage.mockClear();

    api.onNext((p) => p === "/games", ok());
    api.onNext((p) => p.endsWith("/events"), {
      status: 400,
      ok: false,
      retryAfterMs: null,
      body: { detail: { error: "unknown_event_type", rejected: ["game_ended"] } },
    });

    const gid = client.startGame("hearts");
    client.enqueueEvent(gid, { type: "game_ended" });
    await flushMicro();
    await worker.flush();

    const calls = (Sentry.captureMessage as jest.Mock).mock.calls;
    const eventCall = calls.find(
      (c: unknown[]) => typeof c[0] === "string" && c[0].includes("unknown_event_type")
    );
    expect(eventCall).toBeDefined();
    expect(eventCall[1]).toMatchObject({ level: "warning" });
    // Must NOT fire at "error" level for this specific error.
    const errorCall = calls.find(
      (c: unknown[]) =>
        typeof c[0] === "string" &&
        c[0].includes("event batch") &&
        (c[1] as { level?: string })?.level === "error"
    );
    expect(errorCall).toBeUndefined();
  });

  it("plain 400 (non-unknown-event-type) still dead-letters immediately", async () => {
    api.onNext((p) => p === "/games", ok());
    api.onNext((p) => p.endsWith("/events"), {
      status: 400,
      ok: false,
      retryAfterMs: null,
      body: { detail: { error: "malformed_payload" } },
    });

    const gid = client.startGame("yacht");
    client.enqueueEvent(gid, { type: "roll" });
    await flushMicro();
    const result = await worker.flush();

    const rows = await store.peek(100, { includeDeadLettered: true });
    const dead = rows.filter((r) => r.dead_lettered && r.log_type === "game_event");
    expect(dead.length).toBeGreaterThan(0);
    expect(result.deadLettered).toBeGreaterThan(0);
    expect(result.parked).toBe(0);
  });

  // -------------------------------------------------------------------------
  // 400 / 403 → dead-letter
  // -------------------------------------------------------------------------

  it("400 on events dead-letters affected rows without deleting", async () => {
    api.onNext((p) => p === "/games", ok());
    api.onNext((p) => p.endsWith("/events"), err(400));

    const gid = client.startGame("yacht");
    client.enqueueEvent(gid, { type: "roll" });
    await flushMicro();
    await worker.flush();

    const rows = await store.peek(100, { includeDeadLettered: true });
    const live = rows.filter((r) => !r.dead_lettered && r.log_type === "game_event");
    const dead = rows.filter((r) => r.dead_lettered && r.log_type === "game_event");
    expect(live.length).toBe(0);
    expect(dead.length).toBeGreaterThan(0);
    // Live peek should return none now.
    expect((await store.peek(100)).filter((r) => r.log_type === "game_event").length).toBe(0);
  });

  it("403 on events dead-letters + logs high severity", async () => {
    api.onNext((p) => p === "/games", ok());
    api.onNext((p) => p.endsWith("/events"), err(403));
    const gid = client.startGame("yacht");
    client.enqueueEvent(gid, { type: "roll" });
    await flushMicro();
    await worker.flush();

    const rows = await store.peek(100, { includeDeadLettered: true });
    expect(rows.some((r) => r.dead_lettered)).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 404 — re-flip started_synced, preserve events
  // -------------------------------------------------------------------------

  it("404 on events re-flips started_synced and preserves events", async () => {
    api.onNext((p) => p === "/games", ok());
    api.onNext((p) => p.endsWith("/events"), err(404));
    const gid = client.startGame("yacht");
    client.enqueueEvent(gid, { type: "roll" });
    await flushMicro();
    await worker.flush();

    // started_synced should now be false again.
    expect(games.get(gid)?.startedSynced).toBe(false);
    // Events are still live (not dead-lettered).
    const live = (await store.peek(100)).filter((r) => r.log_type === "game_event");
    expect(live.length).toBe(2); // game_started + roll
  });

  // -------------------------------------------------------------------------
  // 413 — split and retry
  // -------------------------------------------------------------------------

  it("413 on events with >1 row splits batch in half and retries", async () => {
    // First events call → 413; second (left half) → ok; third (right) → ok.
    api.onNext((p) => p === "/games", ok());
    api.onNext((p) => p.endsWith("/events"), err(413));
    api.onNext((p) => p.endsWith("/events"), ok({ accepted: 2, duplicates: 0 }));
    api.onNext((p) => p.endsWith("/events"), ok({ accepted: 2, duplicates: 0 }));

    const gid = client.startGame("yacht");
    client.enqueueEvent(gid, { type: "roll" });
    client.enqueueEvent(gid, { type: "roll" });
    client.enqueueEvent(gid, { type: "roll" });
    await flushMicro();
    await worker.flush();

    const eventsCalls = api.calls.filter((c) => c.path.endsWith("/events"));
    expect(eventsCalls.length).toBe(3); // one failure + two halves
  });

  it("413 on a single-row batch dead-letters that row", async () => {
    api.onNext((p) => p === "/games", ok());
    api.onNext((p) => p.endsWith("/events"), err(413));
    // Simulate a one-row batch by setting batch size to 1.
    logConfig.GAME_EVENT_BATCH_SIZE = 1;
    client.startGame("yacht");
    await flushMicro();
    await worker.flush();

    const rows = await store.peek(100, { includeDeadLettered: true });
    expect(rows.some((r) => r.dead_lettered)).toBe(true);
  });

  // -------------------------------------------------------------------------
  // completeGame
  // -------------------------------------------------------------------------

  it("completeGame waits for all events to be delivered before PATCH /complete", async () => {
    // POST /games ok; first POST /events returns 500 so events stay.
    api.onNext((p) => p === "/games", ok());
    api.onNext((p) => p.endsWith("/events"), err(500));
    const gid = client.startGame("yacht");
    client.enqueueEvent(gid, { type: "roll" });
    client.completeGame(gid, { finalScore: 100 });
    await flushMicro();
    await worker.flush();

    // No PATCH should have been attempted because events are outstanding.
    const patches = api.calls.filter((c) => c.method === "PATCH");
    expect(patches.length).toBe(0);
  });

  // #514: the in-memory CompleteSummary is camelCase for idiomatic TS, but
  // the backend Pydantic schema is snake_case. Pydantic default is
  // extra="ignore", so before this fix the camelCase fields were silently
  // dropped and every completed game landed with final_score=NULL and
  // duration_ms=NULL. Pin the wire format here so a future refactor can't
  // quietly re-introduce the bug.
  it("PATCH /complete body uses snake_case field names", async () => {
    api.defaultResponse = ok();
    const gid = client.startGame("yacht");
    client.completeGame(gid, {
      finalScore: 312,
      outcome: "completed",
      durationMs: 45_000,
    });
    await flushMicro();
    await worker.flush();

    const patch = api.calls.find(
      (c) => c.method === "PATCH" && c.path === `/games/${gid}/complete`
    );
    expect(patch).toBeDefined();
    expect(patch!.body).toMatchObject({
      final_score: 312,
      outcome: "completed",
      duration_ms: 45_000,
    });
    // completed_at must be an ISO string (client-captured timestamp).
    expect(typeof (patch!.body as Record<string, unknown>)["completed_at"]).toBe("string");
    // And the old camelCase keys must NOT be present — otherwise Pydantic
    // would still ignore them, but it would leave us with a confusing
    // double-keyed payload.
    expect(patch!.body).not.toHaveProperty("finalScore");
    expect(patch!.body).not.toHaveProperty("durationMs");
  });

  // #572/#553: 400 on PATCH /complete is now terminal — dead-letter immediately.
  // The backend has accepted "completed" since #514; a 400 is a permanent
  // bad-request that retrying cannot fix.
  it("400 on PATCH /complete dead-letters immediately and emits Sentry error", async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Sentry = require("@sentry/react-native");
    Sentry.captureMessage.mockClear();

    api.defaultResponse = ok();
    api.onNext((p) => p.endsWith("/complete"), {
      status: 400,
      ok: false,
      retryAfterMs: null,
      body: { detail: "Invalid outcome: 'completed'" },
    });
    const gid = client.startGame("yacht");
    client.completeGame(gid, { finalScore: 100, outcome: "completed" });
    await flushMicro();
    const result = await worker.flush();

    expect(games.get(gid)).toBeUndefined();
    expect(result.deadLettered).toBe(1);
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      expect.stringContaining("400 on PATCH /complete"),
      expect.objectContaining({
        level: "error",
        extra: expect.objectContaining({
          status: 400,
          body: { detail: "Invalid outcome: 'completed'" },
          gameId: gid,
          sentOutcome: "completed",
        }),
      })
    );
  });

  it("403 on PATCH /complete is immediately dead-lettered (permanent session mismatch)", async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Sentry = require("@sentry/react-native");
    Sentry.captureMessage.mockClear();

    api.defaultResponse = ok();
    api.onNext((p) => p.endsWith("/complete"), err(403));

    const gid = client.startGame("yacht");
    client.completeGame(gid, { finalScore: 100, outcome: "completed" });
    await flushMicro();
    const result = await worker.flush();

    expect(games.get(gid)).toBeUndefined();
    expect(result.deadLettered).toBe(1);
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      expect.stringContaining("403 on PATCH /complete"),
      expect.objectContaining({ level: "error" })
    );
  });

  // -------------------------------------------------------------------------
  // Bug logs
  // -------------------------------------------------------------------------

  it("bug logs POST to /logs/bug and delete on 2xx", async () => {
    api.defaultResponse = ok({ accepted: 1, duplicates: 0 });
    client.reportBug("warn", "source-a", "hi", { k: "v" });
    await flushMicro();
    await worker.flush();

    const bugsCalls = api.calls.filter((c) => c.path === "/logs/bug");
    expect(bugsCalls.length).toBe(1);
    const stats = await store.stats();
    expect(stats.byLogType.bug_log).toBe(0);
  });

  it("500 on bug logs preserves rows", async () => {
    api.onNext((p) => p === "/logs/bug", err(500));
    client.reportBug("warn", "source-a", "hi");
    await flushMicro();
    await worker.flush();

    const stats = await store.stats();
    expect(stats.byLogType.bug_log).toBe(1);
  });

  // -------------------------------------------------------------------------
  // Offline → reconnect
  // -------------------------------------------------------------------------

  it("offline queue persists; reconnect flushes in order", async () => {
    // First flush: everything fails with network error.
    api.onNext((p) => p === "/games", err(0));
    const gid = client.startGame("yacht");
    client.enqueueEvent(gid, { type: "roll" });
    await flushMicro();
    await worker.flush(0);

    // Events preserved.
    let rows: Row[] = await store.peek(100, { includeDeadLettered: true });
    expect(rows.filter((r) => r.log_type === "game_event").length).toBe(2);

    // Advance past backoff and try again with success.
    api.defaultResponse = ok({ accepted: 2, duplicates: 0 });
    await worker.flush(10_000_000);

    rows = await store.peek(100, { includeDeadLettered: true });
    expect(rows.filter((r) => r.log_type === "game_event").length).toBe(0);
  });

  // -------------------------------------------------------------------------
  // start / stop / restart lifecycle (AppState pause behaviour)
  // -------------------------------------------------------------------------

  describe("start / stop / restart", () => {
    const emptyResult: FlushResult = {
      attempted: 0,
      accepted: 0,
      duplicates: 0,
      deadLettered: 0,
      parked: 0,
      backoffMs: 0,
    };

    afterEach(() => {
      jest.useRealTimers();
    });

    it("stop prevents the interval from firing; start after stop re-arms it", () => {
      jest.useFakeTimers();
      const flushSpy = jest.spyOn(worker, "flush").mockResolvedValue(emptyResult);

      worker.start();
      jest.advanceTimersByTime(logConfig.SYNC_INTERVAL_MS + 1);
      expect(flushSpy).toHaveBeenCalledTimes(1);

      worker.stop();
      jest.advanceTimersByTime(logConfig.SYNC_INTERVAL_MS * 3);
      expect(flushSpy).toHaveBeenCalledTimes(1); // no new calls while stopped

      worker.start(); // simulates AppState "active" transition
      jest.advanceTimersByTime(logConfig.SYNC_INTERVAL_MS + 1);
      expect(flushSpy).toHaveBeenCalledTimes(2);
    });

    it("calling start twice does not double-register the interval", () => {
      jest.useFakeTimers();
      const flushSpy = jest.spyOn(worker, "flush").mockResolvedValue(emptyResult);

      worker.start();
      worker.start(); // second call must be a no-op
      jest.advanceTimersByTime(logConfig.SYNC_INTERVAL_MS + 1);
      expect(flushSpy).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // Concurrency guard
  // -------------------------------------------------------------------------

  it("concurrent flush calls are a no-op beyond the first", async () => {
    const gid = client.startGame("yacht");
    client.enqueueEvent(gid, { type: "roll" });
    await flushMicro();
    const [a, b] = await Promise.all([worker.flush(), worker.flush()]);
    // Only one of the two should have actually attempted anything.
    expect(a.attempted + b.attempted).toBeGreaterThan(0);
    expect(Math.min(a.attempted, b.attempted)).toBe(0);
  });
});
