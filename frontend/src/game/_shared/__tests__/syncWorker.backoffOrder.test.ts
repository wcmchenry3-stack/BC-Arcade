/**
 * #3433: when storage is permanently broken the per-row backoff write throws.
 * The global backoff must already be set, the pass must not reject, and
 * Sentry hears of it at most once per launch.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

import { BugReportLimiter } from "../bugReportLimiter";
import { EventStore } from "../eventStore";
import { resetLogConfig } from "../eventQueueConfig";
import { GameEventClientImpl } from "../gameEventClient";
import { PendingGamesStore } from "../pendingGamesStore";
import { resetSentryThrottle } from "../sentryThrottle";
import { SyncWorker } from "../syncWorker";
import { MockSyncApi, asSyncApi, err, flushMicro, ok } from "./helpers/syncWorkerFixtures";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const Sentry = require("@sentry/react-native");

describe("SyncWorker — global backoff before per-row backoff (#3433)", () => {
  let api: MockSyncApi;
  let store: EventStore;
  let worker: SyncWorker;
  let gid: string;
  let completeGame: () => void;

  beforeEach(async () => {
    await AsyncStorage.clear();
    resetLogConfig();
    resetSentryThrottle();
    (Sentry.captureException as jest.Mock).mockClear();
    api = new MockSyncApi();
    api.defaultResponse = ok();
    store = new EventStore();
    const games = new PendingGamesStore();
    const client = new GameEventClientImpl(store, games, new BugReportLimiter());
    await client.init();
    worker = new SyncWorker(store, games, asSyncApi(api));
    gid = client.startGame("hearts");
    client.markStarted(gid);
    client.enqueueEvent(gid, { type: "hand_resolved", data: { hand: 1 } });
    completeGame = () => client.completeGame(gid, { outcome: "win", finalScore: 26 });
    await flushMicro();
  });

  afterEach(() => {
    worker.stop();
    jest.restoreAllMocks();
    resetSentryThrottle();
  });

  it("updateRows throws: backoff still set, flush resolves, one Sentry report per launch", async () => {
    jest.spyOn(store, "updateRows").mockRejectedValue(new Error("storage broken"));
    // The game create succeeds; every event batch is refused with a 503.
    const request = api.request.bind(api);
    jest
      .spyOn(api, "request")
      .mockImplementation(async (m, path, body) =>
        path.endsWith("/events") ? err(503) : request(m, path, body)
      );

    const t0 = Date.now();
    const first = await worker.flush(t0);
    expect(first.backoffMs).toBeGreaterThan(0);
    expect(worker.getBackoffUntil()).toBeGreaterThan(t0);

    // Later ticks after the backoff keep failing; Sentry is not hit again.
    for (let i = 1; i <= 3; i += 1) {
      await worker.flush(worker.getBackoffUntil() + 1);
    }
    const reports = (Sentry.captureException as jest.Mock).mock.calls.filter(
      (c) => (c[1] as { tags?: { op?: string } })?.tags?.op === "perRowBackoff"
    );
    expect(reports).toHaveLength(1);
  });

  it("unknown_event_type 400 with a failing updateRows still propagates: no PATCH /complete", async () => {
    completeGame();
    await flushMicro();
    jest.spyOn(store, "updateRows").mockRejectedValue(new Error("storage broken"));
    const request = api.request.bind(api);
    jest.spyOn(api, "request").mockImplementation(async (m, path, body) =>
      path.endsWith("/events")
        ? {
            status: 400,
            ok: false,
            retryAfterMs: null,
            body: { detail: { error: "unknown_event_type", rejected: ["game_ended"] } },
          }
        : request(m, path, body)
    );

    await expect(worker.flush()).rejects.toThrow("storage broken");
    expect(api.calls.some((c) => c.method === "PATCH" && c.path === `/games/${gid}/complete`)).toBe(
      false
    );
  });
});
