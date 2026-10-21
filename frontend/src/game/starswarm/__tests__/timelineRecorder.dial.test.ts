/**
 * #3393: `wave_timeline` and the replay dial, through the real client, stores and SyncWorker
 * (the waveRecorder.dial.test.ts pattern). `wave_timeline` is REPLAY tier and not on the
 * keep-list (D5), so:
 *  - `full`: the timelines upload with the run, after every wave and ahead of `game_ended`;
 *  - `local` (sampled out): saved on the device, then deleted at the session's end while the
 *    waves (keep-list) still upload; an upgrade (a bug report, an error) uploads them;
 *  - `off` (the kill switch): nothing is recorded at all.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppState } from "react-native";

import { BugReportLimiter } from "../../_shared/bugReportLimiter";
import { EventStore, type GameEventRow } from "../../_shared/eventStore";
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
import { WAVE_COMPLETED_EVENT, WAVE_TIMELINE_EVENT } from "../waveEvents";

const appState = AppState as unknown as { currentState: unknown };

describe("Star Swarm wave timelines and the replay dial (#3393)", () => {
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

  /** A run as the screen ends it: two waves, then two timelines (the death's first). */
  function run(client: GameEventClientImpl, records: boolean): string {
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
    recorder.record(WAVE_COMPLETED_EVENT, { wave: 1, outcome: "cleared" });
    recorder.record(WAVE_COMPLETED_EVENT, { wave: 2, outcome: "died" });
    recorder.record(WAVE_TIMELINE_EVENT, { wave: 2, outcome: "died" });
    recorder.record(WAVE_TIMELINE_EVENT, { wave: 1, outcome: "cleared" });
    recorder.endSession();
    return gid;
  }

  const posted = (gid: string) =>
    api.calls
      .filter((c) => c.method === "POST" && c.path === `/games/${gid}/events`)
      .flatMap((c) => (c.body as { events: { event_type: string }[] }).events)
      .map((e) => e.event_type);

  const byIndex = (gid: string) =>
    api.calls
      .filter((c) => c.method === "POST" && c.path === `/games/${gid}/events`)
      .flatMap((c) => (c.body as { events: { event_type: string; event_index: number }[] }).events)
      .sort((a, b) => a.event_index - b.event_index)
      .map((e) => e.event_type);

  async function queued(): Promise<string[]> {
    return (await store.peek(Number.POSITIVE_INFINITY, { includeFuture: true }))
      .filter((r): r is GameEventRow => r.log_type === "game_event")
      .map((r) => r.event_type);
  }

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

  it("full: the timelines upload after every wave, ahead of game_ended", async () => {
    const client = await clientWith("full");
    const gid = run(client, true);
    client.completeGame(gid, { outcome: "completed" });
    await flushMicro();
    await worker.flush();
    // event_index is the session's order (the server's prefix rule cuts from its end)
    expect(byIndex(gid)).toEqual([
      "game_started",
      WAVE_COMPLETED_EVENT,
      WAVE_COMPLETED_EVENT,
      WAVE_TIMELINE_EVENT,
      WAVE_TIMELINE_EVENT,
      "game_ended",
    ]);
  });

  it("local: the waves upload, the timelines never do and are deleted on the device", async () => {
    const client = await clientWith("local");
    const gid = run(client, true);
    expect(games.get(gid)?.replay).toBe("local");
    expect((await queued()).filter((t) => t === WAVE_TIMELINE_EVENT)).toHaveLength(2); // saved
    client.completeGame(gid, { outcome: "completed" });
    await flushMicro();
    await worker.flush();
    expect(posted(gid)).not.toContain(WAVE_TIMELINE_EVENT);
    expect(posted(gid).filter((t) => t === WAVE_COMPLETED_EVENT)).toHaveLength(2);
    // past the late-upgrade grace they are deleted, unsent
    const completedAt = games.get(gid)?.completedAt ?? Date.now();
    await worker.flush(completedAt + LATE_UPGRADE_GRACE_MS + 1);
    expect(await queued()).not.toContain(WAVE_TIMELINE_EVENT);
    expect(posted(gid)).not.toContain(WAVE_TIMELINE_EVENT);
  });

  it("local, upgraded by a bug report: the timelines upload too", async () => {
    const client = await clientWith("local");
    const gid = run(client, true);
    client.upgradeReplay(gid, "bug");
    client.completeGame(gid, { outcome: "completed" });
    await flushMicro();
    await worker.flush();
    expect(posted(gid).filter((t) => t === WAVE_TIMELINE_EVENT)).toHaveLength(2);
  });

  it("off (the kill switch): nothing is recorded", async () => {
    const client = await clientWith("off");
    const gid = run(client, false);
    client.completeGame(gid, { outcome: "completed" });
    await flushMicro();
    await worker.flush();
    expect(posted(gid)).toEqual(["game_started", "game_ended"]);
  });
});
