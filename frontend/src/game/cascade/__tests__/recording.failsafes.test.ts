/**
 * Cascade's recording fail-safes (#3858; the shared suite is
 * `_shared/__tests__/failsafes.test.ts`, the server's `backend/tests/test_replay_failsafes.py`).
 * Each test fails if its safeguard is removed:
 *
 *  - the kill switch: with the catalog's `cascade.enabled` false, the recorder does no work and
 *    no drop or merge row is queued or uploaded; the lifecycle rows still go;
 *  - the sample rate: at 0 % a session's drop and merge rows never leave the device, at 100 %
 *    they all upload;
 *  - an oversized session: past `CASCADE_SESSION_MAX_BYTES` the rest is dropped as a clean
 *    prefix, reported once (counts only) and counted in the game_ended replay summary (`x`);
 *    past `CASCADE_MAX_UNITS` units the log stops and says so (`rec_cut`). Never silent.
 *
 * The real EventStore, PendingGamesStore, GameEventClient, SyncWorker and GameRecorder run over
 * the mocked AsyncStorage and fake timers; only the network is a double.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Sentry from "@sentry/react-native";
import { AppState } from "react-native";

import { BugReportLimiter } from "../../_shared/bugReportLimiter";
import {
  CASCADE_MAX_UNITS,
  CASCADE_SESSION_MAX_BYTES,
  resetLogConfig,
} from "../../_shared/eventQueueConfig";
import { EventStore } from "../../_shared/eventStore";
import { GameEventClientImpl, type EnqueueEventInput } from "../../_shared/gameEventClient";
import { GameRecorder, type RecordingDropReport } from "../../_shared/gameRecorder";
import { PendingGamesStore } from "../../_shared/pendingGamesStore";
import { decideReplay, isRecordingEnabled } from "../../_shared/replayDial";
import { __resetReplayDialSyncForTests, refresh } from "../../_shared/replayDialSync";
import { resetSentryThrottle } from "../../_shared/sentryThrottle";
import type { SyncResponse } from "../../_shared/syncApi";
import { SyncWorker } from "../../_shared/syncWorker";
import { MockSyncApi, asSyncApi, ok } from "../../_shared/__tests__/helpers/syncWorkerFixtures";
import { createCascadeLog, CASCADE_DROPS_PER_UNIT } from "../replay";
import { skilledBot } from "../sim/bots";
import { playRecordedGame } from "./helpers/recordedGame";

const appState = AppState as unknown as { currentState: unknown };

async function serveCatalog(dial: Record<string, { enabled: boolean; sample_rate: number }>) {
  const reply: SyncResponse = {
    status: 200,
    ok: true,
    retryAfterMs: null,
    body: { items: Object.entries(dial).map(([name, replay]) => ({ name, replay })) },
  };
  __resetReplayDialSyncForTests({ api: { request: async () => reply } });
  expect(await refresh()).toBe(true);
}

/** A short real Cascade game (a careful bot, 60 s), its units as the recorder saved them. */
function shortGame(): EnqueueEventInput[] {
  const saved: EnqueueEventInput[] = [];
  const recorder = new GameRecorder<"cascade">({
    gameType: "cascade",
    enabled: () => true,
    sink: {
      canAccept: () => true,
      enqueueMany: (batch) => {
        saved.push(...batch);
        return true;
      },
    },
    schedule: (task) => task(),
  });
  recorder.startSession();
  playRecordedGame(
    {
      beginUnit: (n) => recorder.beginUnit(n),
      record: (type, data) => recorder.record(type, data),
      closeUnit: () => recorder.closeUnit(),
    },
    { seeds: { queue: 7, engine: 8 }, bot: skilledBot, botSeed: 7, maxSimMs: 60_000 }
  );
  recorder.endSession();
  return saved;
}

describe("Cascade recording fail-safes (#3858)", () => {
  const originalState = appState.currentState;
  let api: MockSyncApi;
  let client: GameEventClientImpl;
  let store: EventStore;
  let worker: SyncWorker;
  let game: EnqueueEventInput[];

  beforeAll(() => {
    game = shortGame();
  });

  beforeEach(async () => {
    jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate", "queueMicrotask"] });
    await AsyncStorage.clear();
    resetLogConfig();
    resetSentryThrottle();
    appState.currentState = "active";
    store = new EventStore();
    const games = new PendingGamesStore();
    client = new GameEventClientImpl(store, games, new BugReportLimiter(), {
      decide: decideReplay, // the real dial
      crashedLastRun: async () => null,
    });
    await client.init();
    api = new MockSyncApi();
    api.defaultResponse = ok();
    worker = new SyncWorker(store, games, asSyncApi(api));
    jest.clearAllMocks();
  });

  afterEach(() => {
    worker.stop();
    appState.currentState = originalState;
    resetLogConfig();
    jest.useRealTimers();
  });

  /** One finished Cascade game through the real client; the event types the API was sent. */
  async function playThroughClient(): Promise<string[]> {
    const gid = client.startGame("cascade");
    client.markStarted(gid);
    client.enqueueEvents(gid, game);
    client.completeGame(gid, { outcome: "loss", finalScore: 10 });
    await jest.advanceTimersByTimeAsync(50);
    await worker.flush();
    return api.calls
      .filter((c) => /\/events$/.test(c.path))
      .flatMap((c) => (c.body as { events: { event_type: string }[] }).events)
      .map((e) => e.event_type);
  }

  it("the game is a few units of drop and merge rows", () => {
    expect(game.length).toBeGreaterThanOrEqual(4);
    expect(new Set(game.map((e) => e.type))).toEqual(new Set(["drop", "merge"]));
  });

  it("kill switch: the recorder does no work, and only the lifecycle rows upload", async () => {
    await serveCatalog({ cascade: { enabled: false, sample_rate: 1 } });
    expect(isRecordingEnabled("cascade")).toBe(false);
    const calls = { sink: 0, schedule: 0, report: 0 };
    const recorder = new GameRecorder<"cascade">({
      gameType: "cascade",
      sink: {
        canAccept: () => true,
        enqueueMany: () => {
          calls.sink += 1;
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
    recorder.startSession();
    expect(recorder.recording).toBe(false);
    const log = createCascadeLog({
      beginUnit: (n) => recorder.beginUnit(n),
      record: (type, data) => recorder.record(type, data),
      closeUnit: () => recorder.closeUnit(),
    });
    log.start();
    for (let i = 0; i < 3 * CASCADE_DROPS_PER_UNIT; i += 1) {
      log.drop(i * 60, 200, 1);
      log.merge(i * 60 + 30, 1);
    }
    log.close();
    recorder.endSession();
    expect(recorder.held).toBe(0);
    expect(calls).toEqual({ sink: 0, schedule: 0, report: 0 });

    expect(await playThroughClient()).toEqual(["game_started", "game_ended"]);
  });

  it("sample rate 0 %: the drop and merge rows never leave the device", async () => {
    await serveCatalog({ cascade: { enabled: true, sample_rate: 0 } });
    const types = await playThroughClient();
    expect(types).toEqual(["game_started", "game_ended"]);
    const left = await store.peek(Number.POSITIVE_INFINITY, {
      includeFuture: true,
      includeDeadLettered: true,
    });
    expect(left).toEqual([]); // deleted at the completion, never piled up
  });

  it("sample rate 100 %: the whole replay uploads", async () => {
    await serveCatalog({ cascade: { enabled: true, sample_rate: 1 } });
    const types = await playThroughClient();
    expect(types.filter((t) => t === "drop" || t === "merge")).toHaveLength(game.length);
    expect(types).toContain("game_started");
    expect(types).toContain("game_ended");
  });

  it("an oversized session is cut at its cap as a clean prefix, reported and counted, never silently", () => {
    const reports: RecordingDropReport[] = [];
    const saved: EnqueueEventInput[] = [];
    const recorder = new GameRecorder<"cascade">({
      gameType: "cascade",
      enabled: () => true,
      sink: {
        canAccept: () => true,
        enqueueMany: (batch) => {
          saved.push(...batch);
          return true;
        },
      },
      schedule: (task) => task(),
      report: (r) => reports.push(r),
    });
    recorder.startSession();
    const log = createCascadeLog({
      beginUnit: (n) => recorder.beginUnit(n),
      record: (type, data) => recorder.record(type, data),
      closeUnit: () => recorder.closeUnit(),
    });
    log.start();
    // A runaway: every drop a 30-merge chain (an honest unit is ~620 B, this one ~4x that).
    for (let i = 0; i < 50 * CASCADE_DROPS_PER_UNIT; i += 1) {
      log.drop(100_000 + i * 60, 3999, 5);
      for (let k = 0; k < 30; k += 1) log.merge(100_000 + i * 60 + k, 8);
    }
    log.close();
    recorder.endSession();

    const bytes = saved.reduce((n, e) => n + JSON.stringify(e.data).length, 0);
    expect(bytes).toBeLessThanOrEqual(CASCADE_SESSION_MAX_BYTES);
    // A clean prefix: the units saved are 1..k, nothing after a hole.
    const units = [...new Set(saved.map((e) => e.data!.unit as number))];
    expect(units).toEqual(Array.from({ length: units.length }, (_, i) => i + 1));
    expect(units.length).toBeLessThan(CASCADE_MAX_UNITS);
    // Flagged: one report with the counts, and the game_ended replay summary's `x`.
    expect(reports).toHaveLength(1);
    expect(reports[0]!.dropped_session_cap).toBeGreaterThan(0);
    expect(recorder.stats()!.x).toBeGreaterThan(0);
    // Past the unit cap the log stops too, and game_ended says how many units it left out.
    expect(log.endData(1)).toEqual({
      end_step: 1,
      rec_cut: 50 - CASCADE_MAX_UNITS + 1 /* the last drop's merges close one more */,
    });
  });

  it("the default drop report reaches Sentry once, by counts only", () => {
    const recorder = new GameRecorder<"cascade">({
      gameType: "cascade",
      enabled: () => true,
      sink: { canAccept: () => true, enqueueMany: () => true },
      schedule: (task) => task(),
    });
    for (let s = 0; s < 3; s += 1) {
      recorder.startSession();
      for (let i = 0; i < 200; i += 1) {
        recorder.beginUnit(i + 1);
        recorder.record("merge", { m: Array.from({ length: 70 }, () => [999_999, 8, 99]) });
        recorder.closeUnit();
      }
      recorder.endSession();
    }
    const capture = Sentry.captureMessage as jest.Mock;
    const drops = capture.mock.calls.filter(([m]) => String(m).startsWith("gameRecorder"));
    expect(drops).toHaveLength(1);
    expect(JSON.stringify(drops[0])).not.toContain("999999");
  });
});
