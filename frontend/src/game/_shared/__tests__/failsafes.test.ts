/**
 * The replay fail-safe suite, device side (#3399, part 2 of #3294, epic #3273).
 *
 * One place to look for every safeguard that keeps the replay pipeline inside
 * the cost / performance budget (CLAUDE.md: Cost, then Performance, then
 * Data). The server half is `backend/tests/test_replay_failsafes.py`. Each test
 * here fails if its safeguard is removed. "(a)" tests are written for this
 * suite; "(b)" tests re-check a safeguard that has a strong test elsewhere,
 * through the public API, and name that test.
 *
 * The real EventStore, PendingGamesStore, GameEventClient, SyncWorker, SyncApi
 * and GameRecorder run over the mocked AsyncStorage and fake timers; only the
 * network (a scripted `fetch`) is a double.
 *
 * | #  | Safeguard                                  | Test (describe > it)                                      | Kind | Mutation check: the test fails if ...                                         |
 * |----|--------------------------------------------|-----------------------------------------------------------|------|-------------------------------------------------------------------------------|
 * | 1a | queue stays within its row and byte caps   | backend down for an hour > the queue never passes ...     | (b)  | EventStore.evictToCapacityUnlocked evicts nothing                             |
 * | 1b | chunk caps (rows and bytes per key)        | backend down for an hour > no chunk passes its caps       | (b)  | CHUNK_MAX_ROWS or CHUNK_MAX_BYTES is raised                                   |
 * | 1c | retries back off, to a ceiling             | backend down for an hour > retries back off ...           | (b)  | SyncWorker.scheduleBackoff sets no deadline                                   |
 * | 1d | the backoff doubles up to BACKOFF_MAX_MS   | backend down for an hour > each failure doubles ...       | (b)  | scheduleBackoff stops doubling, or ignores BACKOFF_MAX_MS                     |
 * | 1e | refused rows are parked per row            | backend down for an hour > a refused batch parks ...      | (a)  | applyPerRowBackoff stops writing next_retry_at                                |
 * | 1f | no request storm on recovery               | backend down for an hour > recovery: a bounded number ... | (a)  | GAME_EVENT_BATCH_SIZE is 1, or flush() loses its flushInProgress guard        |
 * | 1g | Sentry calls stay bounded in an outage     | backend down for an hour > Sentry stays quiet ...         | (a)  | the transient-failure path reports to Sentry on every failure                 |
 * | 1h | Sentry throttle: per key, per hour         | backend down for an hour > the Sentry throttle caps ...   | (b)  | SentryThrottle.allow ignores maxPerHour or the per-key window                 |
 * | 1i | recorder drop reports are throttled        | backend down for an hour > recorder drop reports ...      | (a)  | gameRecorder.reportToSentry calls Sentry.captureMessage directly             |
 * | 2a | 429 Retry-After honoured, POST /games      | 429 with Retry-After > on POST /games ...                 | (a)  | scheduleBackoff ignores retryAfterMs                                          |
 * | 2b | 429 Retry-After honoured, event batch      | 429 with Retry-After > on an event batch ...              | (a)  | transientFailure drops retryAfterMs for the rows                              |
 * | 3a | kill switch, catalog: no recorder work     | kill switch > catalog replay_enabled=false: zero ...      | (b)  | isRecordingEnabled ignores the dial, or decideReplay never returns "off"      |
 * | 3b | kill switch: no replay row queued or sent  | kill switch > replay rows never reach the queue ...       | (b)  | GameEventClientImpl.enqueueEvents stops filtering an off session              |
 * | 3c | kill switch, env flag (as catalog serves)  | kill switch > REPLAY_RECORDING_ENABLED=false, as ...      | (b)  | decideReplay ignores `enabled` (the env flag reaches the app only by it)      |
 * | 4a | sample rate 0 %: lifecycle + keep-list     | sample rate > 0 %: only lifecycle and keep-list ...       | (b)  | uploadsWhenSampledOut returns true, or decideReplay never returns "local"     |
 * | 4b | sample rate 100 %: the full replay         | sample rate > 100 %: the full replay uploads              | (b)  | decideReplay never returns "full"                                             |
 * | 4c | default is 10 %, never 100 %               | sample rate > a game with no catalog entry ...            | (a)  | REPLAY_DEFAULT_SAMPLE_RATE is 1, or the bucket test is not honoured           |
 * | 5  | server caps and the 90 % storage trip      | backend/tests/test_replay_failsafes.py                    | (b)  | see that file's table                                                         |
 * | 6a | an oversized event is chunked, whole       | oversized events > a chunkable event is split ...         | (b)  | splitEvent truncates, or the recorder lets the store stub the row             |
 * | 6b | an unsplittable one is reported, not stub  | oversized events > one that cannot be split ...           | (b)  | the recorder queues the event (the store would stub it) instead of reporting  |
 *
 * Existing tests re-checked: replayDial.integration.test.ts, replayDial.test.ts,
 * gameRecorder.dial.test.ts, gameRecorder.test.ts, syncWorker.test.ts,
 * sentryThrottle.test.ts, eventStore.chunks.test.ts.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Sentry from "@sentry/react-native";
import { AppState } from "react-native";

import { BugReportLimiter } from "../bugReportLimiter";
import {
  Priority,
  REPLAY_DEFAULT_SAMPLE_RATE,
  logConfig,
  resetLogConfig,
} from "../eventQueueConfig";
import { EventStore, type GameEventRow } from "../eventStore";
import { CHUNK_MAX_BYTES, CHUNK_MAX_ROWS, QUEUE_KEY_PREFIX } from "../eventStoreChunks";
import { GameEventClientImpl, type ReplayHooks } from "../gameEventClient";
import { GameRecorder, type RecorderSink, type RecordingDropReport } from "../gameRecorder";
import { PendingGamesStore } from "../pendingGamesStore";
import {
  __resetReplayDialForTests,
  decideReplay,
  isRecordingEnabled,
  replayBucket,
} from "../replayDial";
import { __resetReplayDialSyncForTests, refresh } from "../replayDialSync";
import {
  DEFAULT_MAX_PER_HOUR,
  HOUR_MS,
  SentryThrottle,
  captureThrottledMessage,
  resetSentryThrottle,
} from "../sentryThrottle";
import { SyncApi, type FetchLike, type SyncResponse } from "../syncApi";
import { SyncWorker } from "../syncWorker";

const appState = AppState as unknown as { currentState: unknown };
const BASE = "http://api.test";
const SYNC_INTERVAL = (): number => logConfig.SYNC_INTERVAL_MS;
const MINUTE = 60 * 1000;

// ---------------------------------------------------------------------------
// The network double: a scripted `fetch` under the real SyncApi
// ---------------------------------------------------------------------------

interface Reply {
  status: number;
  /** Sent as the Retry-After header, in seconds. */
  retryAfterS?: number;
  body?: unknown;
}

interface Request {
  /** Fake clock, ms. */
  t: number;
  method: string;
  path: string;
  body: unknown;
  status: number;
}

class Backend {
  /** What the backend answers; "network" is a failed fetch (offline, DNS, timeout). */
  respond: (method: string, path: string) => Reply | "network" = () => ({ status: 200 });
  readonly log: Request[] = [];

  readonly fetch: FetchLike = async (url, init) => {
    const path = url.slice(BASE.length);
    const method = init?.method ?? "GET";
    const reply = this.respond(method, path);
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    this.log.push({
      t: Date.now(),
      method,
      path,
      body,
      status: reply === "network" ? 0 : reply.status,
    });
    if (reply === "network") throw new TypeError("Network request failed");
    return {
      status: reply.status,
      ok: reply.status >= 200 && reply.status < 300,
      headers: {
        get: (name: string) =>
          name.toLowerCase() === "retry-after" && reply.retryAfterS !== undefined
            ? String(reply.retryAfterS)
            : null,
      },
      json: async () => reply.body ?? {},
    } as unknown as Response;
  };

  /** The event rows POSTed, in order, with their game. */
  posted(): { gameId: string; event_type: string; event_index: number }[] {
    return this.log
      .filter((r) => r.method === "POST" && /^\/games\/[^/]+\/events$/.test(r.path))
      .flatMap((r) =>
        (r.body as { events: { event_type: string; event_index: number }[] }).events.map((e) => ({
          gameId: r.path.split("/")[2] as string,
          event_type: e.event_type,
          event_index: e.event_index,
        }))
      );
  }

  at(method: string, path: string): Request[] {
    return this.log.filter((r) => r.method === method && r.path === path);
  }
}

const catalogReply = (
  dial: Record<string, { enabled: boolean; sample_rate: number }>
): SyncResponse => ({
  status: 200,
  ok: true,
  retryAfterMs: null,
  body: { items: Object.entries(dial).map(([name, replay]) => ({ name, replay })) },
});

/** The catalog the app fetched: `refresh()` is the production path that takes it. */
async function serveCatalog(
  dial: Record<string, { enabled: boolean; sample_rate: number }>
): Promise<void> {
  __resetReplayDialSyncForTests({ api: { request: async () => catalogReply(dial) } });
  expect(await refresh()).toBe(true);
}

// ---------------------------------------------------------------------------
// One app process: the real stores, client and worker
// ---------------------------------------------------------------------------

interface Process {
  store: EventStore;
  games: PendingGamesStore;
  client: GameEventClientImpl;
  worker: SyncWorker;
}

describe("replay fail-safes (#3399)", () => {
  const originalState = appState.currentState;
  let backend: Backend;
  let p: Process;
  const workers: SyncWorker[] = [];

  async function launch(): Promise<Process> {
    const store = new EventStore();
    const games = new PendingGamesStore();
    const replay: ReplayHooks = {
      decide: decideReplay, // the real dial
      crashedLastRun: async () => null,
    };
    const client = new GameEventClientImpl(store, games, new BugReportLimiter(), replay);
    await client.init();
    const worker = new SyncWorker(store, games, new SyncApi(backend.fetch, () => BASE));
    workers.push(worker);
    return { store, games, client, worker };
  }

  /** Let timers and the fire-and-forget persists run. */
  const tick = (ms: number): Promise<void> => jest.advanceTimersByTimeAsync(ms);

  /** One finished game: started, `rolls` replay events, completed. */
  function play(gameType = "yacht", rolls = 20, pad = 100): string {
    const gid = p.client.startGame(gameType);
    p.client.markStarted(gid);
    for (let i = 0; i < rolls; i += 1) {
      p.client.enqueueEvent(gid, { type: "roll", data: { i, pad: "x".repeat(pad) } });
    }
    p.client.completeGame(gid, { outcome: "completed", finalScore: 10 });
    return gid;
  }

  async function everyRow(store: EventStore = p.store): Promise<GameEventRow[]> {
    return (
      await store.peek(Number.POSITIVE_INFINITY, { includeFuture: true, includeDeadLettered: true })
    ).filter((r): r is GameEventRow => r.log_type === "game_event");
  }

  beforeEach(async () => {
    jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate", "queueMicrotask"] });
    jest.setSystemTime(new Date("2026-03-01T12:00:00Z"));
    await AsyncStorage.clear();
    resetLogConfig();
    resetSentryThrottle();
    appState.currentState = "active";
    backend = new Backend();
    p = await launch();
    jest.clearAllMocks();
  });

  afterEach(() => {
    for (const w of workers.splice(0)) w.stop();
    appState.currentState = originalState;
    resetLogConfig();
    jest.useRealTimers();
  });

  // -------------------------------------------------------------------------
  // 1. Backend down for an hour
  // -------------------------------------------------------------------------

  describe("backend down for an hour", () => {
    /** An hour of play against a backend that answers `outage`; the interval flush is running. */
    async function anHourDown(outage: Reply | "network" = { status: 503 }): Promise<void> {
      backend.respond = () => outage;
      p.worker.start();
      for (let minute = 0; minute < 60; minute += 1) {
        play();
        await tick(MINUTE);
      }
    }

    it("the queue never passes its row and byte caps", async () => {
      // (b) eventStore.test.ts / eventStore.chunks.test.ts hold the eviction rules.
      logConfig.MAX_ROWS = 300;
      logConfig.MAX_SIZE_BYTES = 80 * 1024;
      await anHourDown();
      const stats = await p.store.stats();
      // 60 games x 22 rows ~ 330 KB went in: the caps held it down.
      expect(stats.totalRows).toBeLessThanOrEqual(logConfig.MAX_ROWS);
      expect(stats.sizeBytes).toBeLessThanOrEqual(logConfig.MAX_SIZE_BYTES);
      expect(stats.totalRows).toBeGreaterThan(0);
    });

    it("no chunk passes its caps", async () => {
      // (b) eventStore.chunks.test.ts. Small rows hit the row cap, big rows the byte cap.
      await p.store.enqueueMany(
        Array.from({ length: 300 }, (_, i) => ({
          game_id: "g-small",
          event_index: i,
          event_type: "roll",
          payload: { i },
        }))
      );
      await p.store.enqueueMany(
        Array.from({ length: 100 }, (_, i) => ({
          game_id: "g-big",
          event_index: i,
          event_type: "roll",
          payload: { pad: "y".repeat(900) },
        }))
      );
      const keys = (await AsyncStorage.getAllKeys()).filter(
        (k) => k.startsWith(QUEUE_KEY_PREFIX) && k.includes("/chunk/")
      );
      expect(keys.length).toBeGreaterThan(4);
      let fullestRows = 0;
      let fullestBytes = 0;
      for (const key of keys) {
        const raw = (await AsyncStorage.getItem(key)) ?? "[]";
        const rows = JSON.parse(raw) as unknown[];
        fullestRows = Math.max(fullestRows, rows.length);
        fullestBytes = Math.max(fullestBytes, raw.length);
        expect(rows.length).toBeLessThanOrEqual(CHUNK_MAX_ROWS);
        // The cap counts each row's JSON; the key adds a comma per row and the brackets.
        expect(raw.length).toBeLessThanOrEqual(CHUNK_MAX_BYTES + rows.length + 2);
      }
      // Both caps were reached, so a higher cap would show.
      expect(fullestRows).toBe(CHUNK_MAX_ROWS);
      expect(fullestBytes).toBeGreaterThan(CHUNK_MAX_BYTES * 0.8);
    });

    it("retries back off: the requests of the hour stay far below one per tick", async () => {
      await anHourDown();
      const attempts = backend.log;
      const everyTick = (60 * MINUTE) / SYNC_INTERVAL(); // 120 without a backoff
      expect(attempts.length).toBeGreaterThan(4); // it did keep trying
      expect(attempts.length).toBeLessThanOrEqual(20);
      expect(attempts.length).toBeLessThan(everyTick / 5);
      // Never faster than the interval, and each wait at least as long as the one before.
      const gaps = attempts.slice(1).map((r, i) => r.t - (attempts[i] as Request).t);
      expect(Math.min(...gaps)).toBeGreaterThanOrEqual(SYNC_INTERVAL());
      gaps.slice(1).forEach((gap, i) => expect(gap).toBeGreaterThanOrEqual(gaps[i] as number));
      // The last waits are minutes, not seconds.
      expect(gaps[gaps.length - 1]).toBeGreaterThanOrEqual(10 * MINUTE);
    });

    it("each failure doubles the backoff, up to the ceiling", async () => {
      // (b) syncWorker.test.ts. Driven by hand: `flush(now)` is the worker's own clock.
      backend.respond = () => ({ status: 503 });
      play();
      await tick(50);
      let now = Date.now();
      const waits: number[] = [];
      for (let i = 0; i < 40; i += 1) {
        const result = await p.worker.flush(now);
        waits.push(result.backoffMs);
        now += result.backoffMs;
      }
      const expected = waits.map((_, i) =>
        Math.min(logConfig.BACKOFF_BASE_MS * 2 ** i, logConfig.BACKOFF_MAX_MS)
      );
      expect(waits).toEqual(expected);
      expect(waits[0]).toBe(logConfig.BACKOFF_BASE_MS);
      expect(waits[waits.length - 1]).toBe(logConfig.BACKOFF_MAX_MS);
      // And nothing is sent inside a wait.
      const sent = backend.log.length;
      await p.worker.flush(now - 1);
      expect(backend.log.length).toBe(sent);
    });

    it("a refused batch parks its rows: each failure moves their next_retry_at out", async () => {
      // The game exists on the server; the event batches are refused.
      backend.respond = (_m, path) =>
        path.endsWith("/events") ? { status: 503 } : { status: 200 };
      const gid = play("yacht", 3);
      await tick(50);
      let now = Date.now();
      const retryAt: number[] = [];
      for (let i = 0; i < 4; i += 1) {
        await p.worker.flush(now);
        const rows = (await everyRow()).filter((r) => r.game_id === gid);
        expect(rows.length).toBeGreaterThan(0);
        const next = rows[0]?.next_retry_at ?? null;
        expect(next).not.toBeNull();
        retryAt.push((next as number) - now);
        now = (next as number) + 1; // the earliest the rows can go again
        expect(rows.every((r) => r.retry_count === i + 1)).toBe(true);
      }
      expect(retryAt[0]).toBeGreaterThanOrEqual(logConfig.BACKOFF_BASE_MS);
      for (let i = 1; i < retryAt.length; i += 1) {
        expect(retryAt[i]).toBeGreaterThan(retryAt[i - 1] as number);
      }
    });

    it("recovery: a bounded number of requests in the first minute back, none before the deadline", async () => {
      logConfig.MAX_ROWS = 300;
      await anHourDown();
      const pending = p.games.all().length;
      expect(pending).toBe(60);
      // The backend is back. The worker still honours its backoff: nothing goes before it.
      backend.respond = () => ({ status: 200 });
      const deadline = p.worker.getBackoffUntil();
      expect(deadline).toBeGreaterThan(Date.now());
      backend.log.length = 0;
      await tick(deadline - Date.now() - 1);
      expect(backend.log).toEqual([]);

      // The first moment a request may go: every trigger the app has fires at once
      // (the interval, NetworkContext's reconnect flush, the foreground flush ...).
      jest.setSystemTime(deadline);
      await Promise.all([
        p.worker.flush(),
        p.worker.flush(),
        p.worker.flush(),
        p.worker.flush(),
        p.worker.flush(),
      ]);
      await tick(MINUTE); // and the interval carries on for the rest of the minute

      // One create, at most one event batch (22 rows < the batch size) and one completion a game.
      expect(backend.log.length).toBeLessThanOrEqual(3 * pending);
      expect(backend.log.length).toBeGreaterThanOrEqual(pending); // it did drain
      // No row went twice, and nothing was left behind.
      const keys = backend.posted().map((e) => `${e.gameId}:${e.event_index}`);
      expect(new Set(keys).size).toBe(keys.length);
      expect(await everyRow()).toEqual([]);
      expect(backend.log.every((r) => r.status === 200)).toBe(true);
    });

    it("Sentry stays quiet: an outage sends no error and one breadcrumb per request at most", async () => {
      await anHourDown("network");
      const requests = backend.log.length;
      expect(requests).toBeGreaterThan(4);
      expect(requests).toBeLessThanOrEqual(20);
      const sentry = Sentry as unknown as Record<string, jest.Mock>;
      const reports =
        sentry.captureMessage!.mock.calls.length + sentry.captureException!.mock.calls.length;
      expect(reports).toBeLessThanOrEqual(DEFAULT_MAX_PER_HOUR);
      expect(reports).toBe(0);
      // The only trace of a network failure is SyncApi's breadcrumb: free, local, bounded by the requests.
      const network = sentry.addBreadcrumb!.mock.calls.filter(
        (c) => (c[0] as { category: string }).category === "syncWorker.network"
      );
      expect(network.length).toBe(requests);
    });

    it("the Sentry throttle caps what any reporter can send in an hour", () => {
      // (b) sentryThrottle.test.ts. 500 distinct keys of each kind, as a broken backend could produce.
      const throttle = new SentryThrottle({ now: () => 0 });
      let warnings = 0;
      let errors = 0;
      for (let i = 0; i < 500; i += 1) {
        if (captureThrottledMessage(`w${i}`, "w", { level: "warning" }, throttle)) warnings += 1;
        if (captureThrottledMessage(`e${i}`, "e", { level: "error" }, throttle)) errors += 1;
      }
      expect(warnings).toBe(DEFAULT_MAX_PER_HOUR);
      expect(errors).toBe(DEFAULT_MAX_PER_HOUR); // its own budget: warnings never starve an error
      // One event per key per app session ...
      const once = new SentryThrottle({ now: () => 0 });
      expect(captureThrottledMessage("same", "m", { level: "warning" }, once)).toBe(true);
      for (let i = 0; i < 50; i += 1) {
        expect(captureThrottledMessage("same", "m", { level: "warning" }, once)).toBe(false);
      }
      // ... and the hour window rolls.
      let now = 0;
      const rolling = new SentryThrottle({ now: () => now });
      for (let i = 0; i < DEFAULT_MAX_PER_HOUR; i += 1) rolling.allow(`k${i}`);
      expect(rolling.allow("late")).toBe(false);
      now = HOUR_MS;
      expect(rolling.allow("later")).toBe(true);
    });

    it("recorder drop reports reach Sentry once per game type, however many sessions drop", () => {
      // The real recorder, its default reporter: 30 sessions that each drop an oversized event.
      const sink: RecorderSink = { canAccept: () => true, enqueueMany: () => true };
      for (let session = 0; session < 30; session += 1) {
        const recorder = new GameRecorder({
          gameType: "hearts",
          sink,
          schedule: () => undefined,
          config: { sessionMaxBytes: 64 * 1024, defaultEventMaxBytes: 60, events: {} },
        });
        recorder.startSession();
        recorder.beginUnit(1);
        recorder.record("card_played", { big: "x".repeat(200) }); // over the 60-byte cap
        recorder.endSession();
      }
      expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // 2. 429 with Retry-After
  // -------------------------------------------------------------------------

  describe("429 with Retry-After", () => {
    const RETRY_AFTER_S = 120;

    it("on POST /games: no request before the Retry-After, the next one right after", async () => {
      backend.respond = () => ({ status: 429, retryAfterS: RETRY_AFTER_S });
      const start = Date.now();
      play("yacht", 2);
      p.worker.start();
      await tick(SYNC_INTERVAL()); // the first pass
      expect(backend.log).toHaveLength(1);
      const deadline = (backend.log[0] as Request).t + RETRY_AFTER_S * 1000;
      // Three more interval ticks fall inside the wait: not one request.
      await tick(deadline - Date.now() - 1);
      expect(backend.log).toHaveLength(1);
      expect(Date.now()).toBeLessThan(deadline);
      expect(Date.now() - start).toBeGreaterThanOrEqual(SYNC_INTERVAL() * 3);
      // The server is willing again: the next tick at or after the deadline goes out.
      backend.respond = () => ({ status: 200 });
      await tick(SYNC_INTERVAL());
      expect(backend.log.length).toBeGreaterThan(1);
      expect((backend.log[1] as Request).t).toBeGreaterThanOrEqual(deadline);
    });

    it("on an event batch: nothing before the Retry-After, rows parked until then", async () => {
      backend.respond = (_m, path) =>
        path.endsWith("/events") ? { status: 429, retryAfterS: RETRY_AFTER_S } : { status: 200 };
      const gid = play("yacht", 3);
      await tick(50);
      p.worker.start();
      await tick(SYNC_INTERVAL());
      const refused = backend.log.filter((r) => r.status === 429);
      expect(refused).toHaveLength(1);
      const deadline = (refused[0] as Request).t + RETRY_AFTER_S * 1000;
      const parked = (await everyRow()).filter((r) => r.game_id === gid);
      expect(parked.length).toBeGreaterThan(0);
      expect(parked.every((r) => r.next_retry_at === deadline)).toBe(true);
      const sent = backend.log.length;
      await tick(deadline - Date.now() - 1);
      expect(backend.log.length).toBe(sent);
      backend.respond = () => ({ status: 200 });
      await tick(SYNC_INTERVAL());
      expect(backend.log.slice(sent).some((r) => r.path === `/games/${gid}/events`)).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // 3. Kill switch off
  // -------------------------------------------------------------------------

  describe("kill switch", () => {
    /** A recorder with the real dial lookup, whose every call is counted. */
    function countingRecorder(gameType: "yacht" | "hearts") {
      const calls = { canAccept: 0, enqueueMany: 0, schedule: 0, report: 0 };
      const recorder = new GameRecorder({
        gameType,
        sink: {
          canAccept: () => {
            calls.canAccept += 1;
            return true;
          },
          enqueueMany: () => {
            calls.enqueueMany += 1;
            return true;
          },
        },
        schedule: () => {
          calls.schedule += 1;
        },
        report: () => {
          calls.report += 1;
        },
      });
      return { recorder, calls };
    }

    function recordAGame(recorder: GameRecorder<"hearts">): void {
      recorder.startSession();
      for (let unit = 1; unit <= 3; unit += 1) {
        recorder.beginUnit(unit);
        for (let i = 0; i < 100; i += 1) recorder.record("card_played", { c: i });
        recorder.closeUnit();
      }
      recorder.requestSave();
      recorder.flush();
      recorder.endSession();
    }

    it("catalog replay_enabled=false: zero recorder work and zero replay uploads, lifecycle rows go", async () => {
      // (b) gameRecorder.dial.test.ts, replayDial.integration.test.ts.
      await serveCatalog({ hearts: { enabled: false, sample_rate: 1 } });
      expect(isRecordingEnabled("hearts")).toBe(false);
      expect(decideReplay("hearts", "any-game")).toBe("off");

      const { recorder, calls } = countingRecorder("hearts");
      recordAGame(recorder as unknown as GameRecorder<"hearts">);
      expect(recorder.held).toBe(0);
      expect(calls).toEqual({ canAccept: 0, enqueueMany: 0, schedule: 0, report: 0 });
      expect(Sentry.captureMessage).not.toHaveBeenCalled();

      // The game itself still reports its lifecycle: started, ended, and the PATCH.
      const gid = p.client.startGame("hearts");
      p.client.markStarted(gid);
      p.client.completeGame(gid, { outcome: "completed" });
      await tick(50);
      await p.worker.flush();
      expect(backend.posted().map((e) => e.event_type)).toEqual(["game_started", "game_ended"]);
      expect(backend.at("PATCH", `/games/${gid}/complete`)).toHaveLength(1);
    });

    it("replay rows never reach the queue or the network for an off session, even enqueued by hand", async () => {
      // (b) replayDial.integration.test.ts: "An off session queues lifecycle events only".
      await serveCatalog({ yacht: { enabled: false, sample_rate: 1 } });
      const gid = p.client.startGame("yacht");
      p.client.markStarted(gid);
      p.client.enqueueEvent(gid, { type: "roll", data: { i: 1 } });
      p.client.enqueueEvents(gid, [
        { type: "roll", data: { i: 2 } },
        { type: "score", data: { i: 3 } },
      ]);
      await tick(50);
      expect((await everyRow()).map((r) => r.event_type)).toEqual(["game_started"]);
      p.client.completeGame(gid, { outcome: "completed" });
      await tick(50);
      await p.worker.flush();
      expect(backend.posted().map((e) => e.event_type)).toEqual(["game_started", "game_ended"]);
      expect(await everyRow()).toEqual([]);
    });

    it("REPLAY_RECORDING_ENABLED=false, as the catalog serves it (every game off): nothing records or uploads", async () => {
      // (b) backend tests/test_replay_dial.py: the env flag is folded into every game's `enabled`.
      const games = ["yacht", "hearts", "starswarm", "blackjack", "daily_word"];
      await serveCatalog(
        Object.fromEntries(games.map((g) => [g, { enabled: false, sample_rate: 1 }]))
      );
      for (const game of games) {
        expect(isRecordingEnabled(game)).toBe(false);
        const gid = p.client.startGame(game);
        p.client.markStarted(gid);
        // The keep-list types are replay rows too: an off session drops them as well.
        p.client.enqueueEvents(gid, [
          { type: "wave_completed" as never, data: { w: 1 } },
          { type: "guess_submitted" as never, data: { g: 1 } },
          { type: "roll", data: { i: 1 } },
        ]);
        p.client.completeGame(gid, { outcome: "completed" });
      }
      await tick(50);
      await p.worker.flush();
      expect(new Set(backend.posted().map((e) => e.event_type))).toEqual(
        new Set(["game_started", "game_ended"])
      );
      expect(backend.posted()).toHaveLength(games.length * 2);
    });
  });

  // -------------------------------------------------------------------------
  // 4. Sample rate
  // -------------------------------------------------------------------------

  describe("sample rate", () => {
    it("0 %: only lifecycle and keep-list rows upload; the rest never leaves the device", async () => {
      // (b) replayDial.integration.test.ts: "a local (sampled-out) session sends lifecycle rows only".
      await serveCatalog({
        yacht: { enabled: true, sample_rate: 0 },
        starswarm: { enabled: true, sample_rate: 0 },
      });
      for (let i = 0; i < 25; i += 1) expect(decideReplay("yacht", `g${i}`)).toBe("local");
      for (let i = 0; i < 20; i += 1) play("yacht", 5);
      for (let i = 0; i < 3; i += 1) {
        const gid = p.client.startGame("starswarm");
        p.client.markStarted(gid);
        p.client.enqueueEvents(gid, [
          { type: "wave_completed" as never, data: { w: 1 } },
          { type: "wave_completed" as never, data: { w: 2 } },
        ]);
        p.client.enqueueEvent(gid, { type: "diagnostic" as never, data: {} });
        p.client.completeGame(gid, { outcome: "completed" });
      }
      await tick(50);
      await p.worker.flush();
      const types = backend.posted().map((e) => e.event_type);
      expect(new Set(types)).toEqual(new Set(["game_started", "game_ended", "wave_completed"]));
      expect(types.filter((t) => t === "wave_completed")).toHaveLength(6);
      expect(types.filter((t) => t === "game_started")).toHaveLength(23);
      expect(types.filter((t) => t === "game_ended")).toHaveLength(23);
      // Every game still completes, and the gameplay rows were deleted, not left to pile up.
      expect(backend.log.filter((r) => r.method === "PATCH")).toHaveLength(23);
      expect(await everyRow()).toEqual([]);
    });

    it("100 %: the full replay uploads", async () => {
      // (b) replayDial.integration.test.ts: a `full` session's rows all go.
      await serveCatalog({ yacht: { enabled: true, sample_rate: 1 } });
      for (let i = 0; i < 25; i += 1) expect(decideReplay("yacht", `g${i}`)).toBe("full");
      for (let i = 0; i < 4; i += 1) play("yacht", 5);
      await tick(50);
      await p.worker.flush();
      const types = backend.posted().map((e) => e.event_type);
      expect(types.filter((t) => t === "roll")).toHaveLength(20);
      expect(types).toHaveLength(4 * (5 + 2));
      expect(await everyRow()).toEqual([]);
    });

    it("a game with no catalog entry samples at 10 %, never 100 %", () => {
      // The production default (the jest setup's is 100 %): no catalog fetched, or the game is not in it.
      __resetReplayDialForTests();
      expect(REPLAY_DEFAULT_SAMPLE_RATE).toBeGreaterThan(0);
      expect(REPLAY_DEFAULT_SAMPLE_RATE).toBeLessThan(1);
      const ids = Array.from({ length: 4000 }, (_, i) => `session-${i}`);
      const full = ids.filter((id) => decideReplay("yacht", id) === "full").length;
      expect(full / ids.length).toBeGreaterThan(0.07);
      expect(full / ids.length).toBeLessThan(0.13);
      // The decision is per id, not per call: the same id lands in the same bucket.
      expect(replayBucket("session-7")).toBe(replayBucket("session-7"));
      expect(decideReplay("yacht", "session-7")).toBe(decideReplay("yacht", "session-7"));
    });
  });

  // -------------------------------------------------------------------------
  // 5. Server-side caps and the storage-budget trip
  // -------------------------------------------------------------------------

  describe("server-side caps and the 90 % storage trip", () => {
    it("are tested in backend/tests/test_replay_failsafes.py; the app's half is a catalog of rates at 0", async () => {
      // What the 90 % trip leaves in the catalog: every game enabled, every rate 0. No session of any
      // game then uploads its replay in full (the sample-rate tests above show what `local` sends).
      const games = ["yacht", "hearts", "starswarm", "blackjack", "daily_word"];
      await serveCatalog(
        Object.fromEntries(games.map((g) => [g, { enabled: true, sample_rate: 0 }]))
      );
      for (const game of games) {
        for (let i = 0; i < 200; i += 1) expect(decideReplay(game, `${game}-${i}`)).toBe("local");
      }
    });
  });

  // -------------------------------------------------------------------------
  // 6. An oversized event is chunked or reported, never stubbed
  // -------------------------------------------------------------------------

  describe("oversized events", () => {
    /** A twenty48 recorder (its real config: `moves` is chunkable on `m`) saving through the real client. */
    function wired(reports: RecordingDropReport[]) {
      const gid = p.client.startGame("twenty48");
      p.client.markStarted(gid);
      const recorder = new GameRecorder({
        gameType: "twenty48",
        sink: {
          canAccept: () => true,
          enqueueMany: (events) => {
            p.client.enqueueEvents(gid, events);
            return true;
          },
        },
        schedule: () => undefined,
        report: (r) => reports.push(r),
      });
      return { gid, recorder };
    }

    const swipe = (i: number) => [i % 4, i % 16, 2 ** ((i % 10) + 1), i * 4, i * 40];

    it("a chunkable event is split into parts that each fit, whole and in order; the store never stubs one", async () => {
      // (b) gameRecorder.test.ts: "splits an oversized chunkable event into parts that each fit".
      const reports: RecordingDropReport[] = [];
      const { gid, recorder } = wired(reports);
      const moves = Array.from({ length: 200 }, (_, i) => swipe(i)); // ~4 KB against a 1 KB cap
      recorder.startSession();
      recorder.beginUnit(1);
      recorder.record("moves", { m: moves });
      recorder.endSession();
      await tick(50);

      const rows = (await everyRow()).filter((r) => r.game_id === gid && r.event_type === "moves");
      expect(rows.length).toBeGreaterThan(1);
      const parts = rows
        .map((r) => r.payload as { m: unknown[]; part: number; parts: number })
        .sort((a, b) => a.part - b.part);
      parts.forEach((part, i) => {
        expect(part.part).toBe(i);
        expect(part.parts).toBe(parts.length);
        expect(JSON.stringify(part).length).toBeLessThanOrEqual(logConfig.MAX_EVENT_PAYLOAD_BYTES);
      });
      // Nothing lost, nothing cut: the parts rebuild the recorded event exactly.
      expect(parts.flatMap((part) => part.m)).toEqual(moves);
      for (const row of rows) {
        expect(row.payload).not.toHaveProperty("_truncated");
        expect(row.priority).toBe(Priority.REPLAY);
      }
      expect(reports).toEqual([]);
    });

    it("one that cannot be split is reported with its counts, and is neither queued nor stubbed", async () => {
      // (b) gameRecorder.test.ts: "drops a chunkable event when one item cannot fit a part on its own".
      const reports: RecordingDropReport[] = [];
      const { gid, recorder } = wired(reports);
      recorder.startSession();
      recorder.beginUnit(1);
      recorder.record("moves", { m: [swipe(1), "z".repeat(5000)] }); // one item alone is over the cap
      recorder.record("moves", { m: [swipe(2)] }); // a normal one still saves
      recorder.endSession();
      await tick(50);

      const rows = (await everyRow()).filter((r) => r.game_id === gid && r.event_type === "moves");
      expect(rows).toHaveLength(1);
      expect((rows[0]?.payload as { m: unknown[] }).m).toEqual([swipe(2)]);
      for (const row of await everyRow()) expect(row.payload).not.toHaveProperty("_truncated");
      expect(reports).toHaveLength(1);
      expect(reports[0]).toMatchObject({ game_type: "twenty48", recorded: 2, dropped_oversize: 1 });
      expect(reports[0]?.largest_bytes).toBeGreaterThan(5000);
    });
  });
});
