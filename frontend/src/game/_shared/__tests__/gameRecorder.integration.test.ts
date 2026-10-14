/**
 * GameRecorder → gameEventClient → eventStore → SyncWorker (#3274), against a
 * mocked API: units are saved with one queue write each, take contiguous
 * event_index values, and are delivered in order and complete after an app
 * kill and relaunch (a fresh store re-hydrated from the mocked AsyncStorage).
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

import { EventStore, type GameEventRow } from "../eventStore";
import { GameEventClientImpl } from "../gameEventClient";
import { PendingGamesStore } from "../pendingGamesStore";
import { SyncWorker } from "../syncWorker";
import { BugReportLimiter } from "../bugReportLimiter";
import { resetLogConfig } from "../eventQueueConfig";
import { GameRecorder, type SendPolicy } from "../gameRecorder";
import { MockSyncApi, asSyncApi, flushMicro, ok } from "./helpers/syncWorkerFixtures";

const setItem = AsyncStorage.setItem as jest.Mock;

function queueWrites(): number {
  return setItem.mock.calls.filter((c) => (c[0] as string).startsWith("event_queue_v1/")).length;
}

interface Process {
  store: EventStore;
  games: PendingGamesStore;
  client: GameEventClientImpl;
}

/** One app process: fresh stores over whatever the (mocked) AsyncStorage holds. */
async function launch(): Promise<Process> {
  const store = new EventStore();
  const games = new PendingGamesStore();
  const client = new GameEventClientImpl(store, games, new BugReportLimiter());
  await client.init();
  return { store, games, client };
}

function recorderFor(p: Process, gameId: string, policy: SendPolicy) {
  const tasks: (() => void)[] = [];
  const recorder = new GameRecorder({
    gameType: "hearts",
    policy,
    sink: (events) => {
      p.client.enqueueEvents(gameId, events);
      return true;
    },
    schedule: (task) => tasks.push(task),
    report: () => undefined,
  });
  return {
    recorder,
    runIdle: () => {
      while (tasks.length > 0) tasks.shift()?.();
    },
  };
}

/** The events SyncWorker posted for a game, in the order they were sent. */
function postedEvents(api: MockSyncApi, gameId: string) {
  return api.calls
    .filter((c) => c.method === "POST" && c.path === `/games/${gameId}/events`)
    .flatMap(
      (c) =>
        (
          c.body as {
            events: { event_index: number; event_type: string; data: Record<string, unknown> }[];
          }
        ).events
    );
}

describe("GameRecorder end to end", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    resetLogConfig();
    setItem.mockClear();
  });

  afterEach(() => {
    resetLogConfig();
  });

  it("saves each closed unit with one event-queue write and contiguous event_index", async () => {
    const p = await launch();
    const gid = p.client.startGame("hearts", {});
    p.client.markStarted(gid);
    await flushMicro();
    const { recorder, runIdle } = recorderFor(p, gid, "on_unit_close");
    recorder.startSession();

    for (const hand of [1, 2, 3]) {
      setItem.mockClear();
      recorder.beginUnit(hand);
      for (let i = 0; i < 13; i += 1) recorder.record("card_played", { hand, i });
      recorder.closeUnit();
      await flushMicro();
      expect(queueWrites()).toBe(0); // nothing until idle
      runIdle();
      await flushMicro();
      expect(queueWrites()).toBe(1);
    }

    const rows = (await p.store.peek(1000)).filter(
      (r): r is GameEventRow => r.log_type === "game_event"
    );
    const recorded = rows.filter((r) => r.event_type === "card_played");
    expect(recorded.map((r) => r.event_index)).toEqual(
      Array.from({ length: 39 }, (_, i) => i + 1) // 0 is game_started
    );
  });

  it.each<SendPolicy>(["on_unit_close", "on_session_end"])(
    "%s: delivers every event in order after a kill and relaunch",
    async (policy) => {
      // --- first process: play two hands, then the app is killed --------
      const first = await launch();
      const gid = first.client.startGame("hearts", {});
      first.client.markStarted(gid);
      const { recorder, runIdle } = recorderFor(first, gid, policy);
      recorder.startSession();
      for (const hand of [1, 2]) {
        recorder.beginUnit(hand);
        for (let i = 0; i < 5; i += 1) recorder.record("card_played", { hand, i });
        recorder.closeUnit();
        runIdle();
      }
      // on_session_end saves at the session's end; the app is killed right after
      recorder.endSession();
      await flushMicro();

      // --- relaunch: new stores read the device's queue back -------------
      const second = await launch();
      expect(second.client.resumeGame("hearts")).toBe(gid);
      second.client.completeGame(gid, { outcome: "completed", finalScore: 26 });
      await flushMicro();

      const api = new MockSyncApi();
      api.defaultResponse = ok({ accepted: 12, duplicates: 0 });
      const worker = new SyncWorker(second.store, second.games, asSyncApi(api));
      await worker.flush();
      worker.stop();

      // Complete: every index once. SyncWorker drains lifecycle rows (P1)
      // before granular ones (P3), so game_started / game_ended may travel
      // first; the server keys events on event_index, which is the order.
      const events = postedEvents(api, gid);
      const byIndex = [...events].sort((a, b) => a.event_index - b.event_index);
      expect(byIndex.map((e) => e.event_index)).toEqual(Array.from({ length: 12 }, (_, i) => i));
      expect(byIndex.map((e) => e.event_type)).toEqual([
        "game_started",
        ...Array(10).fill("card_played"),
        "game_ended",
      ]);
      // The recorded events themselves are sent in recording order.
      const played = events.filter((e) => e.event_type === "card_played");
      expect(played.map((e) => e.event_index)).toEqual(Array.from({ length: 10 }, (_, i) => i + 1));
      expect(played.map((e) => [e.data.unit, e.data.i])).toEqual([
        [1, 0],
        [1, 1],
        [1, 2],
        [1, 3],
        [1, 4],
        [2, 0],
        [2, 1],
        [2, 2],
        [2, 3],
        [2, 4],
      ]);
      expect(played.every((e) => e.data.v === 1 && typeof e.data.t_ms === "number")).toBe(true);
      expect(
        api.calls.some((c) => c.method === "PATCH" && c.path === `/games/${gid}/complete`)
      ).toBe(true);
      expect((await second.store.peek(100)).length).toBe(0);
    }
  );

  it("reserves a unit's event_index values in one pending-games batch: one counter write", async () => {
    const p = await launch();
    const gid = p.client.startGame("hearts", {});
    p.client.markStarted(gid);
    await flushMicro();
    setItem.mockClear();
    const batch = jest.spyOn(p.games, "batch");
    p.client.enqueueEvents(
      gid,
      Array.from({ length: 20 }, (_, i) => ({ type: "card_played", data: { i } }))
    );
    expect(batch).toHaveBeenCalledTimes(1);
    await flushMicro();
    const counterWrites = setItem.mock.calls.filter((c) => c[0] === "pending_games_v1");
    expect(counterWrites).toHaveLength(1);
    expect(queueWrites()).toBe(1);
    expect(p.games.get(gid)?.nextEventIndex).toBe(21);
  });

  it("drops a unit saved for a completed game, as enqueueEvent does", async () => {
    const p = await launch();
    const gid = p.client.startGame("hearts", {});
    p.client.markStarted(gid);
    p.client.completeGame(gid, { outcome: "completed" });
    await flushMicro();
    setItem.mockClear();
    p.client.enqueueEvents(gid, [{ type: "card_played" }, { type: "card_played" }]);
    await flushMicro();
    expect(queueWrites()).toBe(0);
  });
});
