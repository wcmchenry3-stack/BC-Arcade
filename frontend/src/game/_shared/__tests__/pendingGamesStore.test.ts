import AsyncStorage from "@react-native-async-storage/async-storage";

import { PendingGamesStore } from "../pendingGamesStore";

describe("PendingGamesStore", () => {
  let store: PendingGamesStore;

  beforeEach(async () => {
    await AsyncStorage.clear();
    store = new PendingGamesStore();
    await store.init();
  });

  it("creates a pending game with zero nextEventIndex", async () => {
    await store.create("g1", "yacht", { seat: 1 });
    const g = store.get("g1");
    expect(g).toBeDefined();
    expect(g?.gameType).toBe("yacht");
    expect(g?.metadata).toEqual({ seat: 1 });
    expect(g?.nextEventIndex).toBe(0);
    expect(g?.startedSynced).toBe(false);
    expect(g?.completed).toBe(false);
  });

  it("nextEventIndex returns sequential values", async () => {
    await store.create("g1", "yacht", {});
    expect(store.nextEventIndex("g1")).toBe(0);
    expect(store.nextEventIndex("g1")).toBe(1);
    expect(store.nextEventIndex("g1")).toBe(2);
  });

  it("nextEventIndex returns null for an unknown game", () => {
    expect(store.nextEventIndex("nope")).toBeNull();
  });

  it("nextEventIndex returns null for a completed game", async () => {
    await store.create("g1", "yacht", {});
    await store.complete("g1", { finalScore: 100 });
    expect(store.nextEventIndex("g1")).toBeNull();
  });

  it("complete is idempotent", async () => {
    await store.create("g1", "yacht", {});
    await store.complete("g1", { finalScore: 100 });
    await store.complete("g1", { finalScore: 999 });
    expect(store.get("g1")?.completeSummary?.finalScore).toBe(100);
  });

  it("rehydrates state on init after a fresh instance", async () => {
    await store.create("g1", "yacht", { k: "v" });
    store.nextEventIndex("g1");
    store.nextEventIndex("g1");
    await store.complete("g1", { finalScore: 500, outcome: "win" });
    // Wait a tick for the fire-and-forget persist() from nextEventIndex.
    await new Promise((r) => setTimeout(r, 10));

    const fresh = new PendingGamesStore();
    await fresh.init();
    const g = fresh.get("g1");
    expect(g?.gameType).toBe("yacht");
    expect(g?.nextEventIndex).toBe(2);
    expect(g?.completed).toBe(true);
    expect(g?.completeSummary).toEqual({ finalScore: 500, outcome: "win" });
  });

  it("forget drops the game", async () => {
    await store.create("g1", "yacht", {});
    await store.forget("g1");
    expect(store.get("g1")).toBeUndefined();
    expect(store.all()).toEqual([]);
  });

  describe("setProgressOutcome (#2682)", () => {
    it("sets and persists the override", async () => {
      await store.create("g1", "yacht", {});
      await store.setProgressOutcome("g1", "win");
      expect(store.get("g1")?.progressOutcome).toBe("win");

      const fresh = new PendingGamesStore();
      await fresh.init();
      expect(fresh.get("g1")?.progressOutcome).toBe("win");
    });

    it("persists a win's result block and replaces it when it changes (#2745)", async () => {
      await store.create("g1", "blackjack", {});
      await store.setProgressOutcome("g1", "win", { final_chips: 240 });
      await store.setProgressOutcome("g1", "win", { final_chips: 265 });
      expect(store.get("g1")?.progressResult).toEqual({ final_chips: 265 });

      const fresh = new PendingGamesStore();
      await fresh.init();
      expect(fresh.get("g1")?.progressResult).toEqual({ final_chips: 265 });
    });

    it("keeps no result without one, and clears it with the override", async () => {
      await store.create("g1", "blackjack", {});
      await store.setProgressOutcome("g1", "win");
      expect(store.get("g1")?.progressResult).toBeUndefined();
      await store.setProgressOutcome("g1", "win", { final_chips: 240 });
      await store.setProgressOutcome("g1", null, { final_chips: 240 });
      expect(store.get("g1")?.progressOutcome).toBeNull();
      expect(store.get("g1")?.progressResult).toBeUndefined();
    });

    it("clears the override when set to null", async () => {
      await store.create("g1", "yacht", {});
      await store.setProgressOutcome("g1", "win");
      await store.setProgressOutcome("g1", null);
      expect(store.get("g1")?.progressOutcome).toBeNull();
    });

    it("no-ops on a completed game", async () => {
      await store.create("g1", "yacht", {});
      await store.complete("g1", { outcome: "abandoned" });
      await store.setProgressOutcome("g1", "win");
      expect(store.get("g1")?.progressOutcome).toBeUndefined();
    });

    it("no-ops on an unknown game", async () => {
      await expect(store.setProgressOutcome("nope", "win")).resolves.toBeUndefined();
    });
  });

  it("markStartedSynced / markCompleteSynced flip the flags", async () => {
    await store.create("g1", "yacht", {});
    await store.markStartedSynced("g1");
    expect(store.get("g1")?.startedSynced).toBe(true);
    await store.markCompleteSynced("g1");
    expect(store.get("g1")?.completeSynced).toBe(true);
  });

  it("clearAll empties the map and disk", async () => {
    await store.create("g1", "yacht", {});
    await store.clearAll();
    expect(store.all()).toEqual([]);
    const fresh = new PendingGamesStore();
    await fresh.init();
    expect(fresh.all()).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // #2654 — deferred create + previous-process sweep support
  // -------------------------------------------------------------------------

  describe("started flag (#2654)", () => {
    it("a new game is not started; markStarted flips it and persists", async () => {
      await store.create("g1", "yacht", {});
      expect(store.get("g1")?.started).toBe(false);
      await store.markStarted("g1");
      expect(store.get("g1")?.started).toBe(true);

      const fresh = new PendingGamesStore();
      await fresh.init();
      expect(fresh.get("g1")?.started).toBe(true);
    });

    it("complete marks an unstarted game started (finishing is real activity)", async () => {
      await store.create("g1", "yacht", {});
      await store.complete("g1", { outcome: "completed" });
      expect(store.get("g1")?.started).toBe(true);
    });

    it("complete takes an explicit completedAt", async () => {
      await store.create("g1", "yacht", {});
      await store.complete("g1", { outcome: "abandoned" }, 1_234);
      expect(store.get("g1")?.completedAt).toBe(1_234);
    });

    it("nextEventIndex records when the last event was enqueued", async () => {
      const now = jest.spyOn(Date, "now").mockReturnValue(5_000);
      try {
        await store.create("g1", "yacht", {});
        store.nextEventIndex("g1");
        now.mockReturnValue(9_000);
        store.nextEventIndex("g1");
        expect(store.get("g1")?.lastEventAt).toBe(9_000);
      } finally {
        now.mockRestore();
      }
    });

    describe("an older build's record, which has no `started`", () => {
      async function loadLegacy(extra: Record<string, unknown>) {
        await AsyncStorage.setItem(
          "pending_games_v1",
          JSON.stringify({
            legacy: {
              gameType: "yacht",
              metadata: {},
              startedAt: 1_000,
              startedSynced: false,
              nextEventIndex: 1,
              completed: false,
              completedAt: null,
              completeSummary: null,
              completeSynced: false,
              ...extra,
            },
          })
        );
        const fresh = new PendingGamesStore();
        await fresh.init();
        return fresh.get("legacy")?.started;
      }

      it("is started once its create was sent", async () => {
        expect(await loadLegacy({ startedSynced: true })).toBe(true);
      });

      it("is started with an event beyond game_started", async () => {
        expect(await loadLegacy({ nextEventIndex: 2 })).toBe(true);
      });

      it("is started once finished", async () => {
        expect(await loadLegacy({ nextEventIndex: 2, completed: true, completedAt: 2_000 })).toBe(
          true
        );
      });

      it("is unstarted when it was never sent and has only game_started", async () => {
        expect(await loadLegacy({ nextEventIndex: 1 })).toBe(false);
      });
    });
  });

  describe("batch (#2654)", () => {
    it("persists every change made inside it with one write", async () => {
      await store.create("a", "yacht", {});
      await store.create("b", "yacht", {});
      const setItem = AsyncStorage.setItem as jest.Mock;
      setItem.mockClear();
      await store.batch(() => {
        void store.markStarted("a");
        store.nextEventIndex("a");
        void store.complete("a", { outcome: "abandoned" });
        void store.forget("b");
      });
      expect(setItem).toHaveBeenCalledTimes(1);
      const saved = JSON.parse(setItem.mock.calls[0]?.[1] as string);
      expect(Object.keys(saved)).toEqual(["a"]);
      expect(saved.a.completed).toBe(true);
    });

    it("writes nothing when nothing changed", async () => {
      const setItem = AsyncStorage.setItem as jest.Mock;
      setItem.mockClear();
      await store.batch(() => undefined);
      expect(setItem).not.toHaveBeenCalled();
    });
  });

  describe("previous process (#2654)", () => {
    /** Let the earlier process's writes land, then return a new process's store. */
    async function relaunch(): Promise<PendingGamesStore> {
      await new Promise((r) => setTimeout(r, 10));
      return new PendingGamesStore();
    }

    it("lists only the open games read from disk", async () => {
      await store.create("open", "yacht", {});
      await store.create("done", "yacht", {});
      await store.complete("done", { outcome: "completed" });

      const next = await relaunch();
      await next.init();
      await next.create("mine", "yacht", {});

      expect(next.previousProcessOpenGames().map(([id]) => id)).toEqual(["open"]);
    });

    it("is empty before init() resolves", async () => {
      await store.create("open", "yacht", {});
      const next = await relaunch();
      expect(next.previousProcessOpenGames()).toEqual([]);
    });

    it("a game created before init() resolves is kept, saved, and not from a previous process", async () => {
      await store.create("saved", "yacht", {});
      const next = await relaunch();

      const initDone = next.init();
      await next.create("mine", "twenty48", {}); // this write races the load
      await initDone;

      // The load merged under the new game instead of replacing the map...
      expect(next.get("mine")?.gameType).toBe("twenty48");
      expect(next.get("saved")?.gameType).toBe("yacht");
      // ...and only the saved game belongs to the earlier process.
      expect(next.previousProcessOpenGames().map(([id]) => id)).toEqual(["saved"]);

      // The write did not replace the saved games on disk.
      const after = await relaunch();
      await after.init();
      expect(
        after
          .all()
          .map(([id]) => id)
          .sort()
      ).toEqual(["mine", "saved"]);
    });

    it("a game created on a store nobody has init()-ed still loads the saved games first", async () => {
      await store.create("saved", "yacht", {});
      const next = await relaunch();
      await next.create("mine", "yacht", {});
      expect(next.get("saved")).toBeDefined();

      const after = await relaunch();
      await after.init();
      expect(after.get("saved")).toBeDefined();
      expect(after.get("mine")).toBeDefined();
    });

    it("adoptOrphan hands over a started, resumable orphan once and lists it no more", async () => {
      await store.create("a", "yacht", { puzzle: 1 });
      await store.markStarted("a");
      const next = await relaunch();
      expect(next.adoptOrphan("yacht", Date.now())).toBeNull(); // not loaded yet
      await next.init();
      expect(next.adoptOrphan("yacht", Date.now(), { puzzle: 2 })).toBeNull();
      expect(next.adoptOrphan("yacht", Date.now(), { puzzle: 1 })).toBe("a");
      expect(next.previousProcessOpenGames()).toEqual([]);
      expect(next.adoptOrphan("yacht", Date.now())).toBeNull();
    });

    it("drops a forgotten or completed game from the list", async () => {
      await store.create("a", "yacht", {});
      await store.create("b", "yacht", {});
      const next = await relaunch();
      await next.init();
      await next.forget("a");
      await next.complete("b", { outcome: "abandoned" });
      expect(next.previousProcessOpenGames()).toEqual([]);
    });
  });

  describe("update (#2959)", () => {
    it("applies a partial change and persists it", async () => {
      await store.create("g1", "yacht", {});
      await store.markStartedSynced("g1");
      await store.update("g1", { startedSynced: false });
      expect(store.get("g1")?.startedSynced).toBe(false);

      const fresh = new PendingGamesStore();
      await fresh.init();
      expect(fresh.get("g1")?.startedSynced).toBe(false);
    });

    it("is a no-op on an unknown game", async () => {
      const setItem = AsyncStorage.setItem as jest.Mock;
      setItem.mockClear();
      await expect(store.update("nope", { startedSynced: false })).resolves.toBeUndefined();
      expect(setItem).not.toHaveBeenCalled();
    });
  });

  describe("coalesced counter writes (#2959)", () => {
    const pendingWrites = () =>
      (AsyncStorage.setItem as jest.Mock).mock.calls.filter(([k]) => k === "pending_games_v1");

    it("a burst of nextEventIndex calls in one tick lands in one write, with the final counter", async () => {
      await store.create("g1", "yacht", {});
      (AsyncStorage.setItem as jest.Mock).mockClear();
      for (let i = 0; i < 5; i += 1) store.nextEventIndex("g1");
      await new Promise((r) => setTimeout(r, 10));

      expect(pendingWrites()).toHaveLength(1);
      expect(JSON.parse(pendingWrites()[0]?.[1] as string).g1.nextEventIndex).toBe(5);
    });

    it("bumps during an in-flight write fold into one trailing write that carries them all", async () => {
      await store.create("g1", "yacht", {});
      const setItem = AsyncStorage.setItem as jest.Mock;
      const original = setItem.getMockImplementation()!;
      let release: () => void = () => undefined;
      const stalled = new Promise<void>((r) => (release = r));
      let stallNext = true;
      setItem.mockImplementation(async (key: string, value: string) => {
        if (key === "pending_games_v1" && stallNext) {
          stallNext = false;
          await stalled;
        }
        return original(key, value);
      });
      try {
        setItem.mockClear();
        store.nextEventIndex("g1");
        await new Promise((r) => setTimeout(r, 0)); // the first write is in flight, stalled
        store.nextEventIndex("g1");
        store.nextEventIndex("g1");
        store.nextEventIndex("g1");
        release();
        await new Promise((r) => setTimeout(r, 10));

        expect(pendingWrites()).toHaveLength(2);
        expect(JSON.parse(pendingWrites()[1]?.[1] as string).g1.nextEventIndex).toBe(4);
      } finally {
        setItem.mockImplementation(original);
      }
    });

    it("the counter is on disk once the burst settles, and a later bump writes again", async () => {
      await store.create("g1", "yacht", {});
      store.nextEventIndex("g1");
      await new Promise((r) => setTimeout(r, 10));
      store.nextEventIndex("g1");
      await new Promise((r) => setTimeout(r, 10));

      const fresh = new PendingGamesStore();
      await fresh.init();
      expect(fresh.get("g1")?.nextEventIndex).toBe(2);
    });

    it("a failed counter write is not counted as landed: it is retried and the counter reaches disk", async () => {
      await store.create("g1", "yacht", {});
      const setItem = AsyncStorage.setItem as jest.Mock;
      const original = setItem.getMockImplementation()!;
      let failOnce = true;
      setItem.mockImplementation(async (key: string, value: string) => {
        if (key === "pending_games_v1" && failOnce) {
          failOnce = false;
          throw new Error("disk full");
        }
        return original(key, value);
      });
      try {
        setItem.mockClear();
        store.nextEventIndex("g1");
        await new Promise((r) => setTimeout(r, 10));
        expect(pendingWrites()).toHaveLength(2); // the failure, then the retry
      } finally {
        setItem.mockImplementation(original);
      }
      const fresh = new PendingGamesStore();
      await fresh.init();
      expect(fresh.get("g1")?.nextEventIndex).toBe(1);
    });

    it("gives up after repeated failures and lets the next bump carry the counter", async () => {
      await store.create("g1", "yacht", {});
      const setItem = AsyncStorage.setItem as jest.Mock;
      const original = setItem.getMockImplementation()!;
      let failing = true;
      setItem.mockImplementation(async (key: string, value: string) => {
        if (key === "pending_games_v1" && failing) throw new Error("disk full");
        return original(key, value);
      });
      try {
        setItem.mockClear();
        store.nextEventIndex("g1");
        await new Promise((r) => setTimeout(r, 10));
        expect(pendingWrites()).toHaveLength(3); // bounded retries, no spin
        failing = false;
        store.nextEventIndex("g1");
        await new Promise((r) => setTimeout(r, 10));
        expect(pendingWrites()).toHaveLength(4);
      } finally {
        setItem.mockImplementation(original);
      }
      const fresh = new PendingGamesStore();
      await fresh.init();
      expect(fresh.get("g1")?.nextEventIndex).toBe(2);
    });
  });
});
