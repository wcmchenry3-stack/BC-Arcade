/**
 * SyncWorker schedule gating on AppState (#2959): the 30 s interval runs only
 * while the app is active, and a return to active flushes once at once.
 */

import { AppState, AppStateStatus } from "react-native";

import { EventStore } from "../eventStore";
import { PendingGamesStore } from "../pendingGamesStore";
import { SyncWorker, FlushResult } from "../syncWorker";
import { logConfig, resetLogConfig } from "../eventQueueConfig";
import { MockSyncApi, asSyncApi } from "./helpers/syncWorkerFixtures";

const EMPTY: FlushResult = {
  attempted: 0,
  accepted: 0,
  duplicates: 0,
  deadLettered: 0,
  parked: 0,
  backoffMs: 0,
};

const addEventListener = AppState.addEventListener as jest.Mock;
const appState = AppState as unknown as { currentState: unknown };

/** The "change" listener the worker registered last. */
function appStateListener(): (s: AppStateStatus) => void {
  const changes = addEventListener.mock.calls.filter((c: unknown[]) => c[0] === "change");
  const last = changes[changes.length - 1];
  if (!last) throw new Error("SyncWorker did not subscribe to AppState");
  return last[1] as (s: AppStateStatus) => void;
}

describe("SyncWorker — AppState gating (#2959)", () => {
  const originalState = appState.currentState;
  let worker: SyncWorker;
  let flushSpy: jest.SpyInstance<Promise<FlushResult>, [number?]>;

  beforeEach(() => {
    jest.useFakeTimers();
    addEventListener.mockClear();
    resetLogConfig();
    worker = new SyncWorker(
      new EventStore(),
      new PendingGamesStore(),
      asSyncApi(new MockSyncApi())
    );
    flushSpy = jest.spyOn(worker, "flush").mockResolvedValue(EMPTY);
  });

  afterEach(() => {
    worker.stop();
    appState.currentState = originalState;
    jest.useRealTimers();
  });

  it("backgrounded: the interval is torn down and no flush runs", () => {
    worker.start();
    jest.advanceTimersByTime(logConfig.SYNC_INTERVAL_MS + 1);
    expect(flushSpy).toHaveBeenCalledTimes(1);

    appStateListener()("background");
    jest.advanceTimersByTime(logConfig.SYNC_INTERVAL_MS * 3);
    expect(flushSpy).toHaveBeenCalledTimes(1);
  });

  it("foregrounded: one immediate flush, then the interval again", () => {
    worker.start();
    const listener = appStateListener();
    listener("background");
    flushSpy.mockClear();

    listener("active");
    expect(flushSpy).toHaveBeenCalledTimes(1); // at once, before any timer

    jest.advanceTimersByTime(logConfig.SYNC_INTERVAL_MS + 1);
    expect(flushSpy).toHaveBeenCalledTimes(2);

    // A repeated "active" while running neither flushes again nor doubles the interval.
    listener("active");
    expect(flushSpy).toHaveBeenCalledTimes(2);
    jest.advanceTimersByTime(logConfig.SYNC_INTERVAL_MS + 1);
    expect(flushSpy).toHaveBeenCalledTimes(3);
  });

  it("`inactive` (an iOS interruption) pauses like `background`", () => {
    worker.start();
    const listener = appStateListener();
    listener("inactive");
    jest.advanceTimersByTime(logConfig.SYNC_INTERVAL_MS * 2);
    expect(flushSpy).not.toHaveBeenCalled();
    listener("active");
    expect(flushSpy).toHaveBeenCalledTimes(1);
  });

  it("started in the background, the interval waits for the first `active`", () => {
    appState.currentState = "background";
    worker.start();
    jest.advanceTimersByTime(logConfig.SYNC_INTERVAL_MS * 2);
    expect(flushSpy).not.toHaveBeenCalled();

    appStateListener()("active");
    expect(flushSpy).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(logConfig.SYNC_INTERVAL_MS + 1);
    expect(flushSpy).toHaveBeenCalledTimes(2);
  });

  it("start() subscribes once; stop() removes the subscription", () => {
    worker.start();
    worker.start();
    expect(addEventListener.mock.calls.filter((c: unknown[]) => c[0] === "change")).toHaveLength(1);
    const subscription = addEventListener.mock.results[addEventListener.mock.results.length - 1]
      ?.value as { remove: jest.Mock };
    const listener = appStateListener();

    worker.stop();
    expect(subscription.remove).toHaveBeenCalledTimes(1);
    // A transition delivered after stop() does nothing.
    listener("background");
    listener("active");
    expect(flushSpy).not.toHaveBeenCalled();
  });

  it("reports a failed foreground flush to Sentry", async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Sentry = require("@sentry/react-native");
    const boom = new Error("boom");
    flushSpy.mockRejectedValue(boom);
    worker.start();
    const listener = appStateListener();
    listener("background");
    listener("active");
    await Promise.resolve();
    await Promise.resolve();
    expect(Sentry.captureException).toHaveBeenCalledWith(
      boom,
      expect.objectContaining({ tags: { subsystem: "syncWorker", op: "appState.flush" } })
    );
  });
});
