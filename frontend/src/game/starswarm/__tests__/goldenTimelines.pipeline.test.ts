/**
 * #3396: a seeded run's real wave timelines through the real send path (the
 * `timelineRecorder.dial.test.ts` harness: GameRecorder → GameEventClient → EventStore →
 * SyncWorker against a mock API), in each replay-dial mode. The payloads are the engine's own
 * (an Ensign run with 6 lives, the golden pilot, played until the run ends), not stand-ins.
 * `send` restates what the screen's `sendClosedWaves` records; the real `sendClosedWaves` path,
 * through the screen, is covered by `screens/__tests__/StarSwarmScreen.timelineRun.test.tsx`.
 * By mode:
 *  - `full`: every timeline uploads byte for byte, after every wave, the death's first;
 *  - `local` (sampled out): the waves upload, the timelines are saved then deleted unsent, and a
 *    bug report's upgrade uploads them;
 *  - `off` (the kill switch): the run starts with the timeline off, so the engine keeps none and
 *    nothing is recorded;
 *  - a recorder that throws on a timeline, or a queue save that throws: the waves already
 *    recorded and the run's completion are not affected.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppState } from "react-native";

import { BugReportLimiter } from "../../_shared/bugReportLimiter";
import { EventStore } from "../../_shared/eventStore";
import { LATE_UPGRADE_GRACE_MS, resetLogConfig } from "../../_shared/eventQueueConfig";
import { GameEventClientImpl, type ReplayHooks } from "../../_shared/gameEventClient";
import { GameRecorder } from "../../_shared/gameRecorder";
import { PendingGamesStore } from "../../_shared/pendingGamesStore";
import type { ReplayMode } from "../../_shared/replayDial";
import { SyncWorker } from "../../_shared/syncWorker";
import {
  MockSyncApi,
  asSyncApi,
  flushMicro,
  ok,
} from "../../_shared/__tests__/helpers/syncWorkerFixtures";
import type { StarSwarmState } from "../types";
import { WAVE_COMPLETED_EVENT, WAVE_TIMELINE_EVENT, timelinesInSendOrder } from "../waveEvents";
import { playRun } from "./helpers/timelineGoldenRuns";

const appState = AppState as unknown as { currentState: unknown };

let runCache: Record<string, StarSwarmState> = {};
/** The Ensign golden run, with the timeline on or (as the dial off starts it) off. */
function ensign(timelineOn: boolean): StarSwarmState {
  const key = String(timelineOn);
  return (runCache[key] ??= playRun({
    difficulty: "Ensign",
    ticks: 12_000,
    lives: 6,
    timelineOn,
  }).end);
}

describe("a seeded run's timelines through the send path, by dial mode (#3396)", () => {
  const originalState = appState.currentState;
  let api: MockSyncApi;
  let store: EventStore;
  let games: PendingGamesStore;
  let worker: SyncWorker;

  async function clientWith(mode: ReplayMode): Promise<GameEventClientImpl> {
    const hooks: ReplayHooks = {
      decide: () => mode,
      crashedLastRun: async () => null,
      upgradesAllowed: () => true,
      dialLoaded: async () => undefined,
    };
    const client = new GameEventClientImpl(store, games, new BugReportLimiter(), hooks);
    await client.init();
    return client;
  }

  /** The run's end as `sendClosedWaves` makes it: every wave, then the timelines in send order. */
  function send(client: GameEventClientImpl, end: StarSwarmState, records: boolean): string {
    const gid = client.startGame("starswarm");
    client.markStarted(gid);
    const recorder = new GameRecorder({
      gameType: "starswarm",
      policy: "on_session_end",
      enabled: () => records,
      sink: {
        canAccept: () => true,
        enqueueMany: (events) => {
          client.enqueueEvents(gid, events);
          return true;
        },
      },
      schedule: () => undefined,
      report: () => undefined,
    });
    recorder.startSession();
    try {
      for (const w of end.closedWaves) recorder.record(WAVE_COMPLETED_EVENT, { ...w });
      for (const tl of timelinesInSendOrder(end.closedTimelines))
        recorder.record(WAVE_TIMELINE_EVENT, { ...tl });
    } catch {
      // the screen isolates a recorder failure the same way (sendClosedWaves' catch)
    }
    recorder.endSession();
    return gid;
  }

  const posted = (gid: string) =>
    api.calls
      .filter((c) => c.method === "POST" && c.path === `/games/${gid}/events`)
      .flatMap(
        (c) =>
          (c.body as { events: { event_type: string; event_index: number; data: unknown }[] })
            .events
      )
      .sort((a, b) => a.event_index - b.event_index);
  const types = (gid: string) => posted(gid).map((e) => e.event_type);
  const timelinesPosted = (gid: string) =>
    posted(gid)
      .filter((e) => e.event_type === WAVE_TIMELINE_EVENT)
      .map((e) => e.data);

  beforeEach(async () => {
    await AsyncStorage.clear();
    resetLogConfig();
    appState.currentState = "active";
    api = new MockSyncApi();
    api.defaultResponse = ok();
    store = new EventStore();
    games = new PendingGamesStore();
    worker = new SyncWorker(store, games, asSyncApi(api));
  });

  afterEach(() => {
    worker.stop();
    appState.currentState = originalState;
  });

  it("full: every timeline uploads exactly as the engine built it, after every wave", async () => {
    const end = ensign(true);
    expect(end.closedTimelines.length).toBeGreaterThan(1);
    const client = await clientWith("full");
    const gid = send(client, end, true);
    client.completeGame(gid, { outcome: "completed" });
    await flushMicro();
    await worker.flush();
    const waves = end.closedWaves.length;
    const tls = end.closedTimelines.length;
    expect(types(gid)).toEqual([
      "game_started",
      ...Array(waves).fill(WAVE_COMPLETED_EVENT),
      ...Array(tls).fill(WAVE_TIMELINE_EVENT),
      "game_ended",
    ]);
    expect(timelinesPosted(gid)).toEqual(timelinesInSendOrder(end.closedTimelines));
    expect((timelinesPosted(gid)[0] as { outcome: string }).outcome).toBe("died");
  }, 60_000);

  it("local (sampled out): the waves upload; the timelines are saved, then deleted unsent", async () => {
    const end = ensign(true);
    const client = await clientWith("local");
    const gid = send(client, end, true);
    client.completeGame(gid, { outcome: "completed" });
    await flushMicro();
    await worker.flush();
    expect(types(gid)).not.toContain(WAVE_TIMELINE_EVENT);
    expect(types(gid).filter((t) => t === WAVE_COMPLETED_EVENT)).toHaveLength(
      end.closedWaves.length
    );
    const completedAt = games.get(gid)?.completedAt ?? Date.now();
    await worker.flush(completedAt + LATE_UPGRADE_GRACE_MS + 1);
    const left = await store.peek(Number.POSITIVE_INFINITY, { includeFuture: true });
    expect(left.filter((r) => "event_type" in r && r.event_type === WAVE_TIMELINE_EVENT)).toEqual(
      []
    );
    expect(types(gid)).not.toContain(WAVE_TIMELINE_EVENT);
  }, 60_000);

  it("local, upgraded by a bug report: the timelines upload after all", async () => {
    const end = ensign(true);
    const client = await clientWith("local");
    const gid = send(client, end, true);
    client.upgradeReplay(gid, "bug");
    client.completeGame(gid, { outcome: "completed" });
    await flushMicro();
    await worker.flush();
    expect(timelinesPosted(gid)).toEqual(timelinesInSendOrder(end.closedTimelines));
  }, 60_000);

  it("off (the kill switch): the run keeps no timeline and nothing is recorded", async () => {
    const end = ensign(false);
    expect(end.closedTimelines).toEqual([]);
    expect(end.waveTimeline).toBeNull();
    const client = await clientWith("off");
    const gid = send(client, end, false);
    client.completeGame(gid, { outcome: "completed" });
    await flushMicro();
    await worker.flush();
    expect(types(gid)).toEqual(["game_started", "game_ended"]);
  }, 60_000);

  it("a recorder that throws on a timeline: the waves already recorded still upload, the run completes", async () => {
    const end = ensign(true);
    const real = GameRecorder.prototype.record;
    const spy = jest.spyOn(GameRecorder.prototype, "record").mockImplementation(function (
      this: GameRecorder,
      type,
      data
    ) {
      if (type === WAVE_TIMELINE_EVENT) throw new Error("recorder broke");
      return real.call(this, type, data);
    });
    try {
      const client = await clientWith("full");
      const gid = send(client, end, true);
      client.completeGame(gid, { outcome: "completed" });
      await flushMicro();
      await worker.flush();
      expect(types(gid)).toEqual([
        "game_started",
        ...Array(end.closedWaves.length).fill(WAVE_COMPLETED_EVENT),
        "game_ended",
      ]);
    } finally {
      spy.mockRestore();
    }
  }, 60_000);

  it("a queue save that throws: the run's completion still goes out", async () => {
    const end = ensign(true);
    const client = await clientWith("full");
    const save = jest
      .spyOn(GameEventClientImpl.prototype, "enqueueEvents")
      .mockImplementation(() => {
        throw new Error("store broke");
      });
    try {
      const gid = client.startGame("starswarm");
      client.markStarted(gid);
      const recorder = new GameRecorder({
        gameType: "starswarm",
        policy: "on_session_end",
        sink: {
          canAccept: () => true,
          enqueueMany: (events) => {
            client.enqueueEvents(gid, events);
            return true;
          },
        },
        schedule: () => undefined,
        report: () => undefined,
      });
      recorder.startSession();
      for (const tl of end.closedTimelines) recorder.record(WAVE_TIMELINE_EVENT, { ...tl });
      expect(() => recorder.endSession()).not.toThrow();
      save.mockRestore();
      client.completeGame(gid, { outcome: "completed" });
      await flushMicro();
      await worker.flush();
      expect(types(gid)).toEqual(["game_started", "game_ended"]);
    } finally {
      save.mockRestore();
    }
  }, 60_000);
});

afterAll(() => {
  runCache = {};
});
