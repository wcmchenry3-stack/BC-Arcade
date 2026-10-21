/**
 * SyncWorker and a storage failure while reading the session id (#3321).
 *
 * The worker resolves the session id once per process (ensureSession), but the
 * real SyncApi reads it again on every request. A transient AsyncStorage error
 * there used to send `X-Session-ID: unknown`; the backend 400s a non-UUID
 * (`backend/session.py`) and the worker dead-letters on a 400, so the queued
 * rows were lost. Now the request is not sent, the worker backs off and the
 * rows stay queued until storage recovers.
 *
 * Runs the real SyncApi against a fetch stub that answers like the backend.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

import { BugReportLimiter } from "../bugReportLimiter";
import { EventStore } from "../eventStore";
import { logConfig, resetLogConfig } from "../eventQueueConfig";
import { GameEventClientImpl } from "../gameEventClient";
import { PendingGamesStore } from "../pendingGamesStore";
import { SyncApi } from "../syncApi";
import { SyncWorker } from "../syncWorker";
import { flushMicro } from "./helpers/syncWorkerFixtures";

const SESSION_KEY = "game_session_id";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function response(status: number, body: unknown): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: () => null },
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

describe("SyncWorker — session id storage failure (#3321)", () => {
  const getItem = AsyncStorage.getItem as jest.Mock;
  const realGetItem = getItem.getMockImplementation()!;
  let store: EventStore;
  let client: GameEventClientImpl;
  let worker: SyncWorker;
  let sentIds: string[];
  let fetchImpl: jest.Mock;
  /** Session-id reads that throw, counted from the next one. */
  let failSessionReads: (n: number, after?: number) => void;

  beforeEach(async () => {
    await AsyncStorage.clear();
    resetLogConfig();
    sentIds = [];
    // Like `get_session_id`: a missing or non-UUID header is a 400.
    fetchImpl = jest.fn(async (_url: string, init?: RequestInit) => {
      const sid = (init?.headers as Record<string, string>)["X-Session-ID"] ?? "";
      sentIds.push(sid);
      if (!UUID_RE.test(sid))
        return response(400, { detail: "X-Session-ID must be a valid UUID." });
      return response(200, { accepted: 1 });
    });
    let skip = 0;
    let failures = 0;
    failSessionReads = (n, after = 0) => {
      failures = n;
      skip = after;
    };
    getItem.mockImplementation((key: string) => {
      if (key === SESSION_KEY) {
        if (skip > 0) skip -= 1;
        else if (failures > 0) {
          failures -= 1;
          return Promise.reject(new Error("storage down"));
        }
      }
      return realGetItem(key);
    });

    store = new EventStore();
    const games = new PendingGamesStore();
    client = new GameEventClientImpl(store, games, new BugReportLimiter());
    worker = new SyncWorker(store, games, new SyncApi(fetchImpl, () => "https://api.test"));
    await client.init();
  });

  afterEach(() => {
    getItem.mockImplementation(realGetItem);
    resetLogConfig();
    worker.stop();
  });

  it("keeps the rows queued and backs off instead of dead-lettering them", async () => {
    client.reportBug("warn", "test", "a bug");
    await flushMicro();
    expect(await store.peek(100)).toHaveLength(1);

    // ensureSession's read succeeds; the request's own read throws.
    failSessionReads(1, 1);
    const now = 1_000_000;
    const result = await worker.flush(now);

    expect(sentIds).toEqual([]); // never `unknown`, never anything
    expect(result.deadLettered).toBe(0);
    expect(worker.getBackoffUntil()).toBeGreaterThan(now);
    expect(await store.peek(100)).toHaveLength(1);

    // Storage recovers: once the row's own retry time passes, it goes out
    // under the stored, valid id.
    const later = await worker.flush(now + logConfig.BACKOFF_MAX_MS + 1);
    expect(later.deadLettered).toBe(0);
    expect(sentIds).toHaveLength(1);
    expect(sentIds[0]).toMatch(UUID_RE);
    expect(sentIds[0]).toBe(await AsyncStorage.getItem(SESSION_KEY));
    expect(await store.peek(100)).toHaveLength(0);
  });
});
