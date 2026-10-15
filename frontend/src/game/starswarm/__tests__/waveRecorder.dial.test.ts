/**
 * Star Swarm's recorder path and the replay dial (#3279 after #3280).
 *
 * The screen records `wave_completed` through `useGameRecorder("starswarm",
 * { policy: "on_session_end" })`; here the same recorder saves into the real
 * client, stores and SyncWorker, with the real dial:
 *  - kill switch off: the recorder records nothing (no sink call) and the
 *    session is `off`;
 *  - a `local` (sampled-out) session still uploads its waves (keep-list, D5),
 *    held like any gameplay row while it is open in the foreground (#3275) and
 *    released on completion, on going to the background, or after
 *    GAMEPLAY_HOLD_MAX_MS; they survive the delete at the end.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppState } from "react-native";

import { BugReportLimiter } from "../../_shared/bugReportLimiter";
import { EventStore, type GameEventRow } from "../../_shared/eventStore";
import { GAMEPLAY_HOLD_MAX_MS, resetLogConfig } from "../../_shared/eventQueueConfig";
import { GameEventClientImpl } from "../../_shared/gameEventClient";
import { GameRecorder } from "../../_shared/gameRecorder";
import { PendingGamesStore } from "../../_shared/pendingGamesStore";
import { __resetReplayDialForTests } from "../../_shared/replayDial";
import { SyncWorker } from "../../_shared/syncWorker";
import {
  MockSyncApi,
  asSyncApi,
  flushMicro,
  ok,
} from "../../_shared/__tests__/helpers/syncWorkerFixtures";
import { WAVE_COMPLETED_EVENT } from "../waveEvents";

const appState = AppState as unknown as { currentState: unknown };

describe("Star Swarm waves and the replay dial (#3279)", () => {
  const originalState = appState.currentState;
  let api: MockSyncApi;
  let store: EventStore;
  let games: PendingGamesStore;
  let client: GameEventClientImpl;
  let worker: SyncWorker;
  let sinkCalls: number;

  /** A run as the screen drives it: start, record waves at game over, end the recorder session. */
  function run(waves: number): { gid: string; recorder: GameRecorder } {
    const gid = client.startGame("starswarm");
    client.markStarted(gid);
    const recorder = new GameRecorder({
      gameType: "starswarm",
      policy: "on_session_end",
      sink: {
        canAccept: () => true,
        enqueueMany: (events) => {
          sinkCalls += 1;
          client.enqueueEvents(gid, events);
          return true;
        },
      },
      schedule: () => undefined,
      report: () => undefined,
    });
    recorder.startSession();
    for (let w = 1; w <= waves; w += 1) recorder.record(WAVE_COMPLETED_EVENT, { w });
    recorder.endSession();
    return { gid, recorder };
  }

  const posted = (gid: string) =>
    api.calls
      .filter((c) => c.method === "POST" && c.path === `/games/${gid}/events`)
      .flatMap((c) => (c.body as { events: { event_type: string }[] }).events)
      .map((e) => e.event_type);
  const waves = (gid: string) => posted(gid).filter((t) => t === WAVE_COMPLETED_EVENT).length;

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
    client = new GameEventClientImpl(store, games, new BugReportLimiter());
    await client.init();
    worker = new SyncWorker(store, games, asSyncApi(api));
    sinkCalls = 0;
  });

  afterEach(() => {
    worker.stop();
    appState.currentState = originalState;
  });

  it("kill switch off: the recorder records nothing and the session is off", async () => {
    __resetReplayDialForTests({ fallback: { enabled: false, rate: 1 } });
    const { gid, recorder } = run(4);
    expect(sinkCalls).toBe(0);
    expect(recorder.stats()).toEqual({ u: 0, n: 0, b: 0 });
    expect(games.get(gid)?.replay).toBe("off");
    client.completeGame(gid, { outcome: "completed" });
    await flushMicro();
    await worker.flush();
    expect(posted(gid)).toEqual(["game_started", "game_ended"]);
  });

  describe("a local (sampled-out) session", () => {
    beforeEach(() => {
      __resetReplayDialForTests({ fallback: { enabled: true, rate: 0 } });
    });

    it("holds its waves while open, then uploads them all at completion", async () => {
      const { gid } = run(3);
      expect(games.get(gid)?.replay).toBe("local");
      await flushMicro();
      await worker.flush();
      expect(posted(gid)).toEqual(["game_started"]); // open in the foreground: held
      client.completeGame(gid, { outcome: "completed" });
      await flushMicro();
      expect((await queued()).sort()).toEqual([
        "game_ended",
        WAVE_COMPLETED_EVENT,
        WAVE_COMPLETED_EVENT,
        WAVE_COMPLETED_EVENT,
      ]); // the end-of-session delete spared them
      await worker.flush();
      expect(waves(gid)).toBe(3);
      expect(api.calls.some((c) => c.path === `/games/${gid}/complete`)).toBe(true);
    });

    it("releases its waves when the app goes to the background", async () => {
      const { gid } = run(2);
      await flushMicro();
      await worker.flush();
      expect(waves(gid)).toBe(0);
      await worker.flush(Date.now(), { releaseHeld: true });
      expect(waves(gid)).toBe(2);
    });

    it("releases its waves after the hold fallback", async () => {
      const { gid } = run(2);
      await flushMicro();
      await worker.flush();
      expect(waves(gid)).toBe(0);
      await worker.flush(Date.now() + GAMEPLAY_HOLD_MAX_MS + 1);
      expect(waves(gid)).toBe(2);
    });
  });
});
