/**
 * No gameplay-event uploads while a session is open in the foreground
 * (#3275, epic #3273). Real stores and client over the mocked AsyncStorage,
 * a scripted API: an open session sends only its lifecycle rows; its
 * gameplay rows go out when it completes, when the app goes to the
 * background, or once the oldest of them is GAMEPLAY_HOLD_MAX_MS old — and a
 * killed session's held rows go out after the relaunch.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppState, type AppStateStatus } from "react-native";

import { BugReportLimiter } from "../bugReportLimiter";
import { EventStore, type GameEventRow } from "../eventStore";
import { GAMEPLAY_HOLD_MAX_MS, logConfig, resetLogConfig } from "../eventQueueConfig";
import { GameEventClientImpl } from "../gameEventClient";
import { PendingGamesStore } from "../pendingGamesStore";
import type { SyncResponse } from "../syncApi";
import { SyncWorker } from "../syncWorker";
import { MockSyncApi, asSyncApi, flushMicro, ok } from "./helpers/syncWorkerFixtures";

const addEventListener = AppState.addEventListener as jest.Mock;
const appState = AppState as unknown as { currentState: unknown };

/** The "change" listener the worker registered last. */
function appStateListener(): (s: AppStateStatus) => void {
  const changes = addEventListener.mock.calls.filter((c: unknown[]) => c[0] === "change");
  const last = changes[changes.length - 1];
  if (!last) throw new Error("SyncWorker did not subscribe to AppState");
  return last[1] as (s: AppStateStatus) => void;
}

interface Process {
  store: EventStore;
  games: PendingGamesStore;
  client: GameEventClientImpl;
  worker: SyncWorker;
}

describe("SyncWorker — holding an open session's gameplay events (#3275)", () => {
  const originalState = appState.currentState;
  let api: MockSyncApi;
  let p: Process;

  /** One app process: fresh stores over whatever the (mocked) AsyncStorage holds. */
  async function launch(): Promise<Process> {
    const store = new EventStore();
    const games = new PendingGamesStore();
    const client = new GameEventClientImpl(store, games, new BugReportLimiter());
    await client.init();
    return { store, games, client, worker: new SyncWorker(store, games, asSyncApi(api)) };
  }

  function startPlayed(gameType = "hearts"): string {
    const gameId = p.client.startGame(gameType);
    p.client.markStarted(gameId);
    return gameId;
  }

  /**
   * Every event type posted for `gameId`, in event_index order (a batch lists
   * lifecycle rows first, by tier; the server keeps each row's index).
   */
  function postedTypes(gameId: string): string[] {
    return api.calls
      .filter((c) => c.method === "POST" && c.path === `/games/${gameId}/events`)
      .flatMap((c) => (c.body as { events: { event_index: number; event_type: string }[] }).events)
      .sort((a, b) => a.event_index - b.event_index)
      .map((e) => e.event_type);
  }

  const paths = () => api.calls.map((c) => `${c.method} ${c.path}`);

  async function liveRows(store: EventStore = p.store): Promise<GameEventRow[]> {
    return (await store.peek(Number.POSITIVE_INFINITY, { includeFuture: true })).filter(
      (r): r is GameEventRow => r.log_type === "game_event"
    );
  }

  /** Created time of the oldest queued row of a gameplay type. */
  async function oldestGameplayAt(): Promise<number> {
    const rows = (await liveRows()).filter((r) => r.event_type === "card_played");
    return Math.min(...rows.map((r) => r.created_at));
  }

  beforeEach(async () => {
    await AsyncStorage.clear();
    resetLogConfig();
    addEventListener.mockClear();
    appState.currentState = "active";
    api = new MockSyncApi();
    api.defaultResponse = ok();
    p = await launch();
  });

  afterEach(() => {
    p.worker.stop();
    appState.currentState = originalState;
    resetLogConfig();
  });

  it("an open foreground session: no gameplay-event POST on any pass, lifecycle rows on time", async () => {
    const gid = startPlayed();
    for (let i = 0; i < 20; i += 1)
      p.client.enqueueEvent(gid, { type: "card_played", data: { i } });
    p.client.enqueueEvent(gid, { type: "hand_resolved", data: { hand: 1 } });
    await flushMicro();

    // Ten 30 s ticks' worth of passes, all inside the hold.
    for (let i = 0; i < 10; i += 1) await p.worker.flush();

    expect(paths()).toEqual(["POST /games", `POST /games/${gid}/events`]);
    expect(postedTypes(gid)).toEqual(["game_started", "hand_resolved"]);
    // The held rows are live and untouched: no retry count, no backoff.
    const held = await liveRows();
    expect(held).toHaveLength(20);
    expect(held.every((r) => r.retry_count === 0 && r.next_retry_at === null)).toBe(true);
  });

  it("the 30 s interval itself posts no gameplay events while the session is open", async () => {
    jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate", "queueMicrotask"] });
    try {
      const gid = startPlayed();
      p.client.enqueueEvent(gid, { type: "card_played", data: { c: "2C" } });
      await jest.advanceTimersByTimeAsync(20);
      p.worker.start();
      for (let i = 0; i < 4; i += 1) {
        await jest.advanceTimersByTimeAsync(logConfig.SYNC_INTERVAL_MS);
      }
      expect(postedTypes(gid)).toEqual(["game_started"]);
      expect(await liveRows()).toHaveLength(1);
    } finally {
      p.worker.stop();
      jest.useRealTimers();
    }
  });

  it("on complete: the held rows go out with game_ended, ahead of the PATCH", async () => {
    const gid = startPlayed();
    for (let i = 0; i < 5; i += 1) p.client.enqueueEvent(gid, { type: "card_played", data: { i } });
    await flushMicro();
    await p.worker.flush();
    expect(postedTypes(gid)).toEqual(["game_started"]);

    p.client.completeGame(gid, { outcome: "win", finalScore: 26 });
    await flushMicro();
    await p.worker.flush();

    expect(postedTypes(gid)).toEqual([
      "game_started",
      "card_played",
      "card_played",
      "card_played",
      "card_played",
      "card_played",
      "game_ended",
    ]);
    expect(paths()[paths().length - 1]).toBe(`PATCH /games/${gid}/complete`);
    expect(await liveRows()).toEqual([]);
  });

  it("a game completed while a pass holds its rows: the next pass sends them, then completes", async () => {
    const gid = startPlayed();
    p.client.enqueueEvent(gid, { type: "card_played" });
    await flushMicro();
    const request = jest.spyOn(api, "request");
    request.mockImplementation(async (method, path, body) => {
      const res: SyncResponse = await MockSyncApi.prototype.request.call(api, method, path, body);
      if (path.endsWith("/events") && !p.games.get(gid)?.completed) {
        p.client.completeGame(gid, { outcome: "loss" });
      }
      return res;
    });

    await p.worker.flush();
    expect(postedTypes(gid)).toEqual(["game_started"]);
    expect(paths()).not.toContain(`PATCH /games/${gid}/complete`);

    await flushMicro();
    await p.worker.flush();
    expect(postedTypes(gid)).toEqual(["game_started", "card_played", "game_ended"]);
    expect(paths()[paths().length - 1]).toBe(`PATCH /games/${gid}/complete`);
  });

  it("on background: the AppState listener flushes the held rows at once", async () => {
    const gid = startPlayed();
    for (let i = 0; i < 3; i += 1) p.client.enqueueEvent(gid, { type: "card_played", data: { i } });
    await flushMicro();
    p.worker.start();
    await p.worker.flush();
    expect(postedTypes(gid)).toEqual(["game_started"]);

    appState.currentState = "background";
    appStateListener()("background");
    await flushMicro();
    await flushMicro();

    expect(postedTypes(gid)).toEqual(["game_started", "card_played", "card_played", "card_played"]);
    expect(await liveRows()).toEqual([]);
    // The game is still open: no completion is sent.
    expect(paths()).not.toContain(`PATCH /games/${gid}/complete`);
  });

  it("`inactive` alone (a notification-shade pull) releases nothing", async () => {
    const gid = startPlayed();
    p.client.enqueueEvent(gid, { type: "card_played" });
    await flushMicro();
    p.worker.start();
    await p.worker.flush();
    appState.currentState = "inactive";
    appStateListener()("inactive");
    await flushMicro();
    appState.currentState = "active";
    appStateListener()("active");
    await flushMicro();
    await flushMicro();
    expect(postedTypes(gid)).toEqual(["game_started"]);
  });

  it("a background arriving mid-flush still releases: one more pass runs after it", async () => {
    const gid = startPlayed();
    p.client.enqueueEvent(gid, { type: "card_played" });
    await flushMicro();
    p.worker.start();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let gated = false;
    const request = jest.spyOn(api, "request");
    request.mockImplementation(async (method, path, body) => {
      // The first events POST — after this pass decided to hold — is in
      // flight when the app is backgrounded.
      if (!gated && path.endsWith("/events")) {
        gated = true;
        await gate;
      }
      return MockSyncApi.prototype.request.call(api, method, path, body);
    });

    const running = p.worker.flush();
    for (let i = 0; i < 3 && !gated; i += 1) await flushMicro();
    expect(gated).toBe(true);
    appState.currentState = "background";
    appStateListener()("background"); // refused: a flush is running
    release();
    await running;
    // The running pass held the row (it sent game_started only)...
    expect(postedTypes(gid)).toEqual(["game_started"]);
    // ...and the releasing pass queued behind it sends it.
    for (let i = 0; i < 3; i += 1) await flushMicro();
    expect(postedTypes(gid)).toEqual(["game_started", "card_played"]);
  });

  it("a background release during a global backoff sends nothing; the fallback bounds the delay", async () => {
    const gid = startPlayed();
    p.client.enqueueEvent(gid, { type: "card_played" });
    await flushMicro();
    const oldest = await oldestGameplayAt();
    api.onNext((path) => path === "/games", {
      status: 503,
      ok: false,
      retryAfterMs: null,
      body: {},
    });
    await p.worker.flush(oldest); // 503 → global backoff
    expect(p.worker.getBackoffUntil()).toBeGreaterThan(oldest);

    p.worker.start();
    appStateListener()("background"); // the releasing flush lands in the backoff
    await flushMicro();
    expect(postedTypes(gid)).toEqual([]);

    // Back in the foreground after the backoff: held, until the fallback.
    appState.currentState = "active";
    const afterBackoff = p.worker.getBackoffUntil();
    await p.worker.flush(Math.max(afterBackoff, oldest + 1));
    expect(postedTypes(gid)).toEqual(["game_started"]);
    await p.worker.flush(Math.max(afterBackoff, oldest + GAMEPLAY_HOLD_MAX_MS));
    expect(postedTypes(gid)).toEqual(["game_started", "card_played"]);
  });

  it("a pass that resolves the session after its first snapshot holds in the second one too", async () => {
    const gid = startPlayed();
    await p.worker.flush(); // created on the server
    p.client.enqueueEvent(gid, { type: "card_played" });
    await flushMicro();
    // A new worker has not resolved the session id yet; with no pending game
    // seen at the start of the pass, it does so after the first snapshot and
    // takes a second one (#3325).
    const worker = new SyncWorker(p.store, p.games, asSyncApi(api));
    jest.spyOn(p.games, "all").mockReturnValueOnce([]);
    const snapshot = jest.spyOn(
      worker as unknown as { snapshot: (now: number, holding: boolean) => Promise<unknown> },
      "snapshot"
    );
    await worker.flush();
    expect(snapshot).toHaveBeenCalledTimes(2);
    expect(snapshot.mock.calls.map((c) => c[1])).toEqual([true, true]);
    expect(postedTypes(gid)).toEqual(["game_started"]);
    worker.stop();
  });

  it("a flush that runs in the background (a reconnect) does not hold", async () => {
    const gid = startPlayed();
    p.client.enqueueEvent(gid, { type: "card_played" });
    await flushMicro();
    appState.currentState = "background";
    await p.worker.flush();
    expect(postedTypes(gid)).toEqual(["game_started", "card_played"]);
  });

  it("the fallback: everything goes once the oldest held row is GAMEPLAY_HOLD_MAX_MS old", async () => {
    const gid = startPlayed();
    p.client.enqueueEvent(gid, { type: "card_played", data: { i: 0 } });
    await flushMicro();
    const oldest = await oldestGameplayAt();

    await p.worker.flush(oldest + GAMEPLAY_HOLD_MAX_MS - 1);
    expect(postedTypes(gid)).toEqual(["game_started"]);

    // A newer row joins the hold; the clock is the oldest row's, not the newest's.
    p.client.enqueueEvent(gid, { type: "card_played", data: { i: 1 } });
    await flushMicro();
    await p.worker.flush(oldest + GAMEPLAY_HOLD_MAX_MS);
    expect(postedTypes(gid)).toEqual(["game_started", "card_played", "card_played"]);
    expect(await liveRows()).toEqual([]);

    // A long session keeps uploading: the next rows start a new hold.
    p.client.enqueueEvent(gid, { type: "card_played", data: { i: 2 } });
    await flushMicro();
    const next = await oldestGameplayAt();
    await p.worker.flush(next + 1);
    expect(postedTypes(gid)).toHaveLength(3);
    await p.worker.flush(next + GAMEPLAY_HOLD_MAX_MS);
    expect(postedTypes(gid)).toHaveLength(4);
  });

  it("the fallback is far inside the queue's TTL, so a held row never ages out", () => {
    expect(GAMEPLAY_HOLD_MAX_MS).toBeGreaterThan(logConfig.SYNC_INTERVAL_MS);
    expect(GAMEPLAY_HOLD_MAX_MS * 100).toBeLessThan(logConfig.TTL_MS);
  });

  it("holds only open sessions: a completed game's rows and another open game's are independent", async () => {
    const open = startPlayed();
    const done = startPlayed("yacht");
    p.client.enqueueEvent(open, { type: "card_played" });
    p.client.enqueueEvent(done, { type: "roll" });
    p.client.completeGame(done, { outcome: "completed", finalScore: 120 });
    await flushMicro();
    await p.worker.flush();
    expect(postedTypes(done)).toEqual(["game_started", "roll", "game_ended"]);
    expect(postedTypes(open)).toEqual(["game_started"]);
  });

  describe("after a kill and relaunch", () => {
    it("a killed session's held rows upload at the next launch when it is not resumed", async () => {
      const gid = startPlayed("twenty48");
      for (let i = 0; i < 4; i += 1) p.client.enqueueEvent(gid, { type: "move", data: { i } });
      await flushMicro();
      await p.worker.flush();
      expect(postedTypes(gid)).toEqual(["game_started"]);
      // ...the OS kills the app: no background event, no completion.

      p = await launch();
      expect(p.games.isFromPreviousProcess(gid)).toBe(true);
      await p.worker.flush(); // foreground, but nobody is playing that session here
      expect(postedTypes(gid)).toEqual(["game_started", "move", "move", "move", "move"]);
      expect(await liveRows()).toEqual([]);
    });

    it("resumed: the session is open again and holds, with the fallback from its oldest row", async () => {
      const gid = startPlayed("twenty48");
      p.client.enqueueEvent(gid, { type: "move", data: { i: 0 } });
      await flushMicro();
      await p.worker.flush();
      const oldest = Math.min(
        ...(await liveRows()).filter((r) => r.event_type === "move").map((r) => r.created_at)
      );

      p = await launch();
      expect(p.client.resumeGame("twenty48")).toBe(gid);
      await p.worker.flush(oldest + 1);
      expect(postedTypes(gid)).toEqual(["game_started"]);
      await p.worker.flush(oldest + GAMEPLAY_HOLD_MAX_MS);
      expect(postedTypes(gid)).toEqual(["game_started", "move"]);
    });

    it("the startup sweep's abandon sends the old session's rows with its game_ended", async () => {
      const now = jest.spyOn(Date, "now").mockReturnValue(1_000_000);
      try {
        const gid = startPlayed("twenty48");
        p.client.enqueueEvent(gid, { type: "move" });
        await flushMicro();
        await p.worker.flush(1_000_000);
        expect(postedTypes(gid)).toEqual(["game_started"]);

        // A day later, the session is too old to resume: the sweep abandons it.
        now.mockReturnValue(1_000_000 + 24 * 60 * 60 * 1000);
        p = await launch();
        await p.worker.flush(1_000_000 + 24 * 60 * 60 * 1000);
        expect(postedTypes(gid)).toEqual(["game_started", "move", "game_ended"]);
        expect(paths()[paths().length - 1]).toBe(`PATCH /games/${gid}/complete`);
      } finally {
        now.mockRestore();
      }
    });
  });
});
