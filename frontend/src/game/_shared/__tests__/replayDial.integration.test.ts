/**
 * The replay dial end to end (#3279): real stores, client and SyncWorker over
 * the mocked AsyncStorage, a scripted API.
 *
 *  - A `local` (sampled-out) session sends its lifecycle rows only — completed,
 *    backgrounded, past the hold fallback, or left by a previous process — its
 *    gameplay rows never hold its PATCH /complete back, and they are deleted
 *    when it completes, is discarded or is abandoned by the startup sweep.
 *  - An `off` session queues lifecycle events only.
 *  - `reportBug`, an error event (Sentry `beforeSend`) and a crash on the last
 *    run upgrade a `local` session to `full`; its held rows then go out.
 *  - The decision is made once per session: a dial change, a kill and a resume
 *    never change it. A record from an older build is `full`.
 *  - game_ended carries the summary; the cost at 10 % is below today's.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Sentry from "@sentry/react-native";
import { AppState } from "react-native";

import { BugReportLimiter } from "../bugReportLimiter";
import { EventStore, eventStore, type GameEventRow } from "../eventStore";
import { GAMEPLAY_HOLD_MAX_MS, Priority, logConfig, resetLogConfig } from "../eventQueueConfig";
import { GameEventClientImpl, gameEventClient, type ReplayHooks } from "../gameEventClient";
import { PendingGamesStore, pendingGamesStore } from "../pendingGamesStore";
import { __resetReplayDialForTests, decideReplay, type ReplayMode } from "../replayDial";
import { __resetReplayDialSyncForTests, refresh } from "../replayDialSync";
import { UPGRADE_IGNORED_SUBSYSTEMS, upgradeReplayOnError } from "../replayErrorUpgrade";
import { SyncWorker } from "../syncWorker";
import { MockSyncApi, asSyncApi, flushMicro, ok } from "./helpers/syncWorkerFixtures";

const appState = AppState as unknown as { currentState: unknown };
const PENDING_KEY = "pending_games_v1";

interface Process {
  store: EventStore;
  games: PendingGamesStore;
  client: GameEventClientImpl;
  worker: SyncWorker;
}

interface Hooks {
  mode: ReplayMode | null; // null: the real dial
  crashed: boolean | null;
  crashChecks: number;
}

describe("replay dial, end to end (#3279)", () => {
  const originalState = appState.currentState;
  let api: MockSyncApi;
  let hooks: Hooks;
  let p: Process;

  async function launch(): Promise<Process> {
    const store = new EventStore();
    const games = new PendingGamesStore();
    const replay: ReplayHooks = {
      decide: (type, id) => hooks.mode ?? decideReplay(type, id),
      crashedLastRun: async () => {
        hooks.crashChecks += 1;
        return hooks.crashed;
      },
    };
    const client = new GameEventClientImpl(store, games, new BugReportLimiter(), replay);
    await client.init();
    return { store, games, client, worker: new SyncWorker(store, games, asSyncApi(api)) };
  }

  function play(gameType = "yacht", gameplay = 5): string {
    const gid = p.client.startGame(gameType);
    p.client.markStarted(gid);
    for (let i = 0; i < gameplay; i += 1) p.client.enqueueEvent(gid, { type: "roll", data: { i } });
    return gid;
  }

  function posted(gameId: string): { event_type: string; data: Record<string, unknown> }[] {
    return api.calls
      .filter((c) => c.method === "POST" && c.path === `/games/${gameId}/events`)
      .flatMap(
        (c) =>
          (c.body as { events: { event_type: string; data: Record<string, unknown> }[] }).events
      );
  }
  const postedTypes = (gameId: string) => posted(gameId).map((e) => e.event_type);
  const patched = (gameId: string) =>
    api.calls.some((c) => c.method === "PATCH" && c.path === `/games/${gameId}/complete`);

  async function rows(store: EventStore = p.store): Promise<GameEventRow[]> {
    return (
      await store.peek(Number.POSITIVE_INFINITY, { includeFuture: true, includeDeadLettered: true })
    ).filter((r): r is GameEventRow => r.log_type === "game_event");
  }

  function endedReplay(gameId: string): unknown {
    return posted(gameId).find((e) => e.event_type === "game_ended")?.data.replay;
  }

  beforeEach(async () => {
    await AsyncStorage.clear();
    resetLogConfig();
    appState.currentState = "active";
    api = new MockSyncApi();
    api.defaultResponse = ok();
    hooks = { mode: "local", crashed: null, crashChecks: 0 };
    p = await launch();
    jest.clearAllMocks();
  });

  afterEach(() => {
    p.worker.stop();
    appState.currentState = originalState;
    resetLogConfig();
  });

  describe("a local (sampled-out) session sends lifecycle rows only", () => {
    it("completed: game_started and game_ended go, the gameplay rows are deleted just before the PATCH, which is not blocked", async () => {
      const gid = play();
      p.client.completeGame(gid, { outcome: "completed", finalScore: 10 });
      await flushMicro();
      // Kept until SyncWorker's last step for the game: a late error may still upgrade it.
      expect((await rows()).filter((r) => r.event_type === "roll")).toHaveLength(5);
      const deletes = jest.spyOn(p.store, "deleteByGameIds");
      await p.worker.flush();
      expect(deletes).toHaveBeenCalledWith([gid], expect.any(Function));
      expect(await rows()).toEqual([]);
      expect(postedTypes(gid)).toEqual(["game_started", "game_ended"]);
      expect(patched(gid)).toBe(true);
      expect(endedReplay(gid)).toEqual({ m: "s" });
      expect(p.games.get(gid)).toBeUndefined(); // fully synced, forgotten
    });

    it("a local Star Swarm session uploads its waves (keep-list, D5) and nothing else non-lifecycle", async () => {
      const gid = p.client.startGame("starswarm");
      p.client.markStarted(gid);
      p.client.enqueueEvents(gid, [
        { type: "wave_completed", data: { w: 1 } },
        { type: "wave_completed", data: { w: 2 } },
      ]);
      // Not keep-list: an unregistered (granular) type stays on the device.
      p.client.enqueueEvent(gid, { type: "diagnostic" as never, data: {} });
      await flushMicro();
      // Open, in the foreground: the waves are held like any gameplay row (#3275).
      await p.worker.flush();
      expect(postedTypes(gid)).toEqual(["game_started"]);
      p.client.enqueueEvents(gid, [{ type: "wave_completed", data: { w: 3 } }]);
      p.client.completeGame(gid, { outcome: "completed" });
      await flushMicro();
      await p.worker.flush();
      // The delete before the PATCH spared the (held, then sent) keep-list rows
      // and took the granular one, which was never sent.
      expect(await rows()).toEqual([]);
      expect(postedTypes(gid)).not.toContain("diagnostic");
      expect(postedTypes(gid).sort()).toEqual([
        "game_ended",
        "game_started",
        "wave_completed",
        "wave_completed",
        "wave_completed",
      ]);
      expect(patched(gid)).toBe(true);
      expect(endedReplay(gid)).toEqual({ m: "s" });
    });

    it("an off Star Swarm session still drops its waves", async () => {
      hooks.mode = "off";
      const gid = p.client.startGame("starswarm");
      p.client.enqueueEvents(gid, [{ type: "wave_completed", data: { w: 1 } }]);
      await flushMicro();
      expect((await rows()).map((r) => r.event_type)).toEqual(["game_started"]);
    });

    it("a failed delete before the PATCH: the PATCH still goes, the rows are left to the TTL", async () => {
      const gid = play();
      await flushMicro();
      jest.spyOn(p.store, "deleteByGameIds").mockRejectedValueOnce(new Error("disk"));
      p.client.completeGame(gid, { outcome: "completed" });
      await flushMicro();
      await p.worker.flush();
      expect((await rows()).filter((r) => r.event_type === "roll")).toHaveLength(5);
      expect(postedTypes(gid)).toEqual(["game_started", "game_ended"]);
      expect(patched(gid)).toBe(true);
    });

    it("open, on every holding pass, and past the hold fallback", async () => {
      const gid = play();
      await flushMicro();
      await p.worker.flush();
      await p.worker.flush(Date.now() + GAMEPLAY_HOLD_MAX_MS + 1);
      expect(postedTypes(gid)).toEqual(["game_started"]);
      // game_started went; the gameplay rows stay on the device until the session ends.
      expect((await rows()).map((r) => r.event_type)).toEqual(Array(5).fill("roll"));
    });

    it("backgrounded: the releasing flush sends no gameplay rows", async () => {
      const gid = play();
      await flushMicro();
      await p.worker.flush(Date.now(), { releaseHeld: true });
      appState.currentState = "background";
      await p.worker.flush();
      expect(postedTypes(gid)).toEqual(["game_started"]);
    });

    it("a previous process's: sent lifecycle only after the relaunch, and its rows go before the sweep-abandon's PATCH", async () => {
      const gid = play();
      await flushMicro();
      await p.worker.flush();
      // Killed; relaunched more than 24 h later, so the sweep abandons it.
      const saved = JSON.parse((await AsyncStorage.getItem(PENDING_KEY)) ?? "{}");
      saved[gid].startedAt -= 25 * 60 * 60 * 1000;
      await AsyncStorage.setItem(PENDING_KEY, JSON.stringify(saved));
      p = await launch();
      await flushMicro();
      expect((await rows()).map((r) => r.event_type).sort()).toEqual([
        "game_ended",
        ...Array(5).fill("roll"),
      ]);
      await p.worker.flush();
      expect(postedTypes(gid)).toEqual(["game_started", "game_ended"]);
      expect(patched(gid)).toBe(true);
      expect(await rows()).toEqual([]);
      expect(hooks.crashChecks).toBe(1); // asked, and no crash: not upgraded
    });

    it("completed by a process killed before its last sync step: the next launch deletes its rows (N1)", async () => {
      const gid = play();
      p.client.completeGame(gid, { outcome: "completed" });
      await flushMicro();
      p = await launch(); // killed before any flush
      expect((await rows()).filter((r) => r.event_type === "roll")).toHaveLength(5);
      await p.worker.flush();
      expect(postedTypes(gid)).toEqual(["game_started", "game_ended"]);
      expect(patched(gid)).toBe(true);
      expect(await rows()).toEqual([]);
    });

    it("a previous process's, still open: lifecycle rows only on the relaunch's passes", async () => {
      const gid = play();
      await flushMicro();
      p = await launch();
      await p.worker.flush();
      expect(postedTypes(gid)).toEqual(["game_started"]);
    });

    it("discarded: every row goes", async () => {
      const gid = p.client.startGame("yacht");
      p.client.enqueueEvent(gid, { type: "roll", data: {} });
      p.client.discardGame(gid);
      await flushMicro();
      expect(await rows()).toEqual([]);
    });

    it("eviction of the replay tier (#3276) still takes a local game's rows, a whole game at a time", async () => {
      const a = play("yacht", 10);
      const b = play("yacht", 10);
      await flushMicro();
      logConfig.MAX_ROWS = 15;
      await p.store.evictToCapacity();
      const left = await rows();
      const replayOf = (g: string) =>
        left.filter((r) => r.game_id === g && r.priority === Priority.REPLAY).length;
      expect([replayOf(a), replayOf(b)].sort()).toEqual([0, 10]);
      expect(left.filter((r) => r.priority === Priority.LIFECYCLE)).toHaveLength(2);
    });
  });

  describe("an off session", () => {
    it("queues lifecycle events only, one at a time or in a batch", async () => {
      hooks.mode = "off";
      const gid = play("yacht", 3);
      p.client.enqueueEvents(gid, [
        { type: "roll", data: {} },
        { type: "score", data: {} },
      ]);
      p.client.enqueueEvent(gid, { type: "hand_resolved", data: {} });
      p.client.completeGame(gid, { outcome: "completed" });
      await flushMicro();
      expect((await rows()).map((r) => [r.event_index, r.event_type])).toEqual([
        [0, "game_started"],
        [1, "hand_resolved"],
        [2, "game_ended"],
      ]);
      await p.worker.flush();
      expect(endedReplay(gid)).toBeUndefined(); // nothing recorded, no summary
      expect(patched(gid)).toBe(true);
    });
  });

  describe("upload on error", () => {
    it("reportBug upgrades the open session: its held rows go out, and the summary names it", async () => {
      const gid = play();
      p.client.reportBug("warn", "test", "something odd");
      expect(p.games.get(gid)?.replay).toBe("full");
      p.client.completeGame(gid, { outcome: "completed" });
      await flushMicro();
      await p.worker.flush();
      expect(postedTypes(gid).filter((t) => t === "roll")).toHaveLength(5);
      expect(endedReplay(gid)).toEqual({ m: "f", up: "bug" });
      // An upgrade is a flag, never a Sentry event.
      expect(Sentry.captureException).not.toHaveBeenCalled();
      expect(Sentry.captureMessage).not.toHaveBeenCalled();
    });

    it("an upgrade survives a kill", async () => {
      const gid = play();
      p.client.upgradeReplay(gid, "error");
      await flushMicro();
      p = await launch();
      expect(p.games.get(gid)?.replay).toBe("full");
      expect(p.games.get(gid)?.replayUpgrade).toBe("error");
    });

    describe("beforeSend (App.tsx): the event's own game.id decides (B1)", () => {
      /** The app's own client and stores: what App.tsx's beforeSend reaches. */
      async function appClient(): Promise<SyncWorker> {
        // Rate 0 while starting: every session local. Each test raises the rate
        // before it upgrades, since at rate 0 nothing upgrades.
        __resetReplayDialForTests({ fallback: { enabled: true, rate: 0 } });
        await gameEventClient.clearAll();
        await gameEventClient.init();
        return new SyncWorker(eventStore, pendingGamesStore, asSyncApi(api));
      }
      const tagged = (gid: string, extra: Record<string, unknown> = {}) => ({
        level: "error",
        tags: { "game.id": gid, ...extra },
      });

      afterEach(async () => {
        await gameEventClient.clearAll();
      });

      it("an error captured in game A, sent only after A completed and B started, upgrades A — never B", async () => {
        const worker = await appClient();
        const a = gameEventClient.startGame("yacht");
        gameEventClient.markStarted(a);
        for (let i = 0; i < 4; i += 1)
          gameEventClient.enqueueEvent(a, { type: "roll", data: { i } });
        // Captured now: the event carries A's tag (the scope's tags at capture time).
        const event = tagged(a);
        // The native SDK's beforeSend runs later: A completes and B starts first.
        gameEventClient.completeGame(a, { outcome: "completed" });
        const b = gameEventClient.startGame("yacht");
        gameEventClient.markStarted(b);
        gameEventClient.enqueueEvent(b, { type: "roll", data: {} });
        // Upgrades are allowed for yacht; rate 0 would refuse them (tested below).
        __resetReplayDialForTests({ fallback: { enabled: true, rate: 0.5 } });
        upgradeReplayOnError(event);
        expect(pendingGamesStore.get(a)?.replay).toBe("full");
        expect(pendingGamesStore.get(a)?.replayUpgrade).toBe("error");
        expect(pendingGamesStore.get(b)?.replay).toBe("local");
        await flushMicro();
        await worker.flush();
        const sentA = api.calls
          .filter((c) => c.path === `/games/${a}/events`)
          .flatMap((c) => (c.body as { events: { event_type: string }[] }).events)
          .map((e) => e.event_type);
        expect(sentA.filter((t) => t === "roll")).toHaveLength(4);
        expect(api.calls.some((c) => c.path === `/games/${a}/complete`)).toBe(true);
        expect(
          api.calls.some(
            (c) => c.path === `/games/${b}/events` && JSON.stringify(c.body).includes('"roll"')
          )
        ).toBe(false);
      });

      it("levels: error, fatal, and an exception with no level count; warning and info do not", async () => {
        await appClient();
        __resetReplayDialForTests({ fallback: { enabled: true, rate: 0.5 } });
        const cases: [Record<string, unknown>, boolean][] = [
          [{ level: "warning" }, false],
          [{ level: "info", exception: {} }, false],
          [{ exception: { values: [] } }, true],
          [{ level: "fatal" }, true],
        ];
        for (const [fields, upgraded] of cases) {
          __resetReplayDialForTests({ fallback: { enabled: true, rate: 0 } });
          const gid = gameEventClient.startGame("yacht");
          __resetReplayDialForTests({ fallback: { enabled: true, rate: 0.5 } });
          upgradeReplayOnError({ ...fields, tags: { "game.id": gid } });
          expect([fields, pendingGamesStore.get(gid)?.replay]).toEqual([
            fields,
            upgraded ? "full" : "local",
          ]);
        }
      });

      it("fail-safes (S1): no game id, console.error, API events and plumbing subsystems upgrade nothing", async () => {
        await appClient();
        const gid = gameEventClient.startGame("yacht");
        __resetReplayDialForTests({ fallback: { enabled: true, rate: 0.5 } });
        const ignored: Record<string, unknown>[] = [
          { level: "error" }, // no tags: no game, whatever is open
          { level: "error", tags: { "game.id": "none" } },
          { level: "error", tags: { "game.id": "" } },
          tagged(gid, { source: "console.error" }),
          tagged(gid, { api: "yacht", errorType: "network" }),
          ...[...UPGRADE_IGNORED_SUBSYSTEMS].map((s) => tagged(gid, { subsystem: s })),
        ];
        for (const event of ignored) upgradeReplayOnError(event);
        expect(pendingGamesStore.get(gid)?.replay).toBe("local");
        // A game's own subsystem does count.
        upgradeReplayOnError(tagged(gid, { subsystem: "yacht.ai" }));
        expect(pendingGamesStore.get(gid)?.replay).toBe("full");
        expect(() =>
          upgradeReplayOnError({ level: "error", tags: { "game.id": "nope" } })
        ).not.toThrow();
      });
    });

    it("does nothing for a full, off, synced or unknown session; a completed, unsynced one is upgraded", async () => {
      hooks.mode = "full";
      const full = play();
      hooks.mode = "off";
      const off = play();
      hooks.mode = "local";
      const done = play();
      p.client.completeGame(done, { outcome: "completed" });
      for (const id of [full, off, "nope", null, undefined]) p.client.upgradeReplay(id, "error");
      expect(p.games.get(full)?.replayUpgrade).toBeUndefined();
      expect(p.games.get(off)?.replay).toBe("off");
      // Completed but not synced: still upgraded, and its rows then go out.
      p.client.upgradeReplay(done, "error");
      expect(p.games.get(done)?.replay).toBe("full");
      await flushMicro();
      await p.worker.flush();
      expect(postedTypes(done).filter((t) => t === "roll")).toHaveLength(5);
      // Synced and forgotten: nothing to upgrade.
      hooks.mode = "local";
      const synced = play();
      p.client.completeGame(synced, { outcome: "completed" });
      await flushMicro();
      await p.worker.flush();
      expect(p.games.get(synced)).toBeUndefined();
      expect(() => p.client.upgradeReplay(synced, "error")).not.toThrow();
    });

    it("an upgrade between steps 2 and 3 of a pass completes the game on the next pass, after its rows", async () => {
      const gid = play();
      p.client.completeGame(gid, { outcome: "completed" });
      await flushMicro();
      // Upgrade right after step 2's last event POST for the game.
      const realRequest = api.request.bind(api);
      let upgraded = false;
      jest.spyOn(api, "request").mockImplementation(async (method, path, body) => {
        const res = await realRequest(method, path, body);
        if (!upgraded && path === `/games/${gid}/events`) {
          upgraded = true;
          p.client.upgradeReplay(gid, "error");
        }
        return res;
      });
      await p.worker.flush();
      expect(patched(gid)).toBe(false); // not this pass: its rolls were not sent yet
      await p.worker.flush();
      expect(postedTypes(gid).filter((t) => t === "roll")).toHaveLength(5);
      expect(patched(gid)).toBe(true);
    });

    describe("at a sample rate of 0 (the budget turn-down) nothing upgrades (S1)", () => {
      beforeEach(() => {
        hooks.mode = "local";
        __resetReplayDialForTests({ fallback: { enabled: true, rate: 0 } });
      });

      it("no error or bug upgrade", async () => {
        const gid = play();
        p.client.upgradeReplay(gid, "error");
        p.client.reportBug("error", "test", "boom");
        expect(p.games.get(gid)?.replay).toBe("local");
        p.client.completeGame(gid, { outcome: "completed" });
        await flushMicro();
        await p.worker.flush();
        expect(postedTypes(gid)).toEqual(["game_started", "game_ended"]);
      });

      it("no crash upgrade", async () => {
        const gid = play();
        await flushMicro();
        hooks.crashed = true;
        p = await launch();
        expect(p.games.get(gid)?.replay).toBe("local");
      });

      it("a game whose own rate is above 0 still upgrades", async () => {
        __resetReplayDialForTests({ fallback: { enabled: true, rate: 0.2 } });
        const gid = play();
        p.client.upgradeReplay(gid, "error");
        expect(p.games.get(gid)?.replay).toBe("full");
      });
    });

    it("a crash on the last run upgrades the most recently active local orphan only (D2-A)", async () => {
      const older = play();
      await flushMicro();
      const newer = play();
      p.client.enqueueEvent(newer, { type: "roll", data: { last: true } });
      await flushMicro();
      hooks.crashed = true;
      p = await launch();
      expect(p.games.get(newer)?.replay).toBe("full");
      expect(p.games.get(newer)?.replayUpgrade).toBe("crash");
      expect(p.games.get(older)?.replay).toBe("local");
    });

    it("a crash check that never answers does not hold the launch: no upgrade after 2 s", async () => {
      const gid = play();
      await flushMicro();
      jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate", "queueMicrotask"] });
      try {
        const store = new EventStore();
        const games = new PendingGamesStore();
        const hung: ReplayHooks = {
          decide: () => "local",
          crashedLastRun: () => new Promise<boolean | null>(() => undefined),
        };
        const client = new GameEventClientImpl(store, games, new BugReportLimiter(), hung);
        let ready = false;
        void client.init().then(() => {
          ready = true;
        });
        await jest.advanceTimersByTimeAsync(1_900);
        expect(ready).toBe(false);
        await jest.advanceTimersByTimeAsync(200);
        expect(ready).toBe(true);
        expect(games.get(gid)?.replay).toBe("local");
      } finally {
        jest.useRealTimers();
      }
    });

    it("no crash, or an unknown crash state: no upgrade; no local orphan: not even asked", async () => {
      const gid = play();
      await flushMicro();
      for (const crashed of [false, null]) {
        hooks.crashed = crashed;
        p = await launch();
        expect(p.games.get(gid)?.replay).toBe("local");
      }
      expect(hooks.crashChecks).toBe(2);
      await p.client.clearAll();
      hooks.crashChecks = 0;
      hooks.mode = "full";
      play();
      await flushMicro();
      p = await launch();
      expect(hooks.crashChecks).toBe(0);
    });
  });

  describe("one decision per session", () => {
    it("a dial change after the start does not change a running session; refresh() moves new sessions", async () => {
      hooks.mode = null; // the real dial
      __resetReplayDialForTests({ fallback: { enabled: true, rate: 1 } });
      __resetReplayDialSyncForTests({
        api: {
          request: async () =>
            ok({ items: [{ name: "yacht", replay: { enabled: true, sample_rate: 0 } }] }),
        },
      });
      const before = p.client.startGame("yacht");
      expect(p.games.get(before)?.replay).toBe("full");
      expect(await refresh()).toBe(true);
      const after = p.client.startGame("yacht");
      expect(p.games.get(after)?.replay).toBe("local");
      expect(p.games.get(before)?.replay).toBe("full");
    });

    it("a kill and a resume keep the decision, whatever the dial says now", async () => {
      const gid = play("yacht", 2);
      await flushMicro();
      hooks.mode = "full";
      p = await launch();
      expect(p.client.resumeGame("yacht")).toBe(gid);
      expect(p.games.get(gid)?.replay).toBe("local");
      p.client.enqueueEvent(gid, { type: "roll", data: {} });
      p.client.completeGame(gid, { outcome: "completed" });
      await flushMicro();
      await p.worker.flush();
      expect(postedTypes(gid)).toEqual(["game_started", "game_ended"]);
    });

    it("a pending game from an older build (no replay field) is full", async () => {
      const gid = play("yacht", 3);
      await flushMicro();
      const saved = JSON.parse((await AsyncStorage.getItem(PENDING_KEY)) ?? "{}");
      delete saved[gid].replay;
      await AsyncStorage.setItem(PENDING_KEY, JSON.stringify(saved));
      p = await launch();
      expect(p.client.resumeGame("yacht")).toBe(gid);
      p.client.completeGame(gid, { outcome: "completed" });
      await flushMicro();
      await p.worker.flush();
      expect(postedTypes(gid).filter((t) => t === "roll")).toHaveLength(3);
      expect(endedReplay(gid)).toEqual({ m: "f" });
    });
  });

  describe("the game_ended summary", () => {
    it("merges the recorder's counts under the mode, ~60–90 B", async () => {
      const gid = play("yacht", 0);
      p.client.completeGame(
        gid,
        { outcome: "completed" },
        { final_score: 3, replay: { u: 13, n: 26, b: 15872, x: 2 } }
      );
      await flushMicro();
      await p.worker.flush();
      const ended = posted(gid).find((e) => e.event_type === "game_ended")?.data;
      expect(ended).toEqual({
        final_score: 3,
        replay: { u: 13, n: 26, b: 15872, x: 2, m: "s" },
      });
      const bytes = JSON.stringify({
        replay: { u: 13, n: 26, b: 15872, x: 2, m: "s", up: "error" },
      }).length;
      expect(bytes).toBeLessThanOrEqual(90);
    });
  });

  describe("cost (CLAUDE.md, #3294)", () => {
    async function heavyDay(rate: number): Promise<{ requests: number; bytes: number }> {
      await AsyncStorage.clear();
      api = new MockSyncApi();
      api.defaultResponse = ok();
      hooks.mode = null;
      __resetReplayDialForTests({ fallback: { enabled: true, rate } });
      p = await launch();
      for (let s = 0; s < 100; s += 1) {
        const gid = play("yacht", 30);
        p.client.completeGame(gid, { outcome: "completed" });
      }
      await flushMicro();
      await p.worker.flush();
      const events = api.calls.filter((c) => c.path.endsWith("/events"));
      return {
        requests: api.calls.length,
        bytes: events.reduce((n, c) => n + JSON.stringify(c.body).length, 0),
      };
    }

    it("at 10 % a heavy day costs fewer requests and bytes than every session in full (today)", async () => {
      const today = await heavyDay(1);
      const sampled = await heavyDay(0.1);
      expect(sampled.requests).toBeLessThanOrEqual(today.requests);
      expect(sampled.bytes).toBeLessThan(today.bytes * 0.3);
    });

    it("a local session makes no gameplay POST at all", async () => {
      const gid = play("yacht", 50);
      p.client.completeGame(gid, { outcome: "completed" });
      await flushMicro();
      await p.worker.flush();
      expect(posted(gid).some((e) => e.event_type === "roll")).toBe(false);
    });
  });
});
