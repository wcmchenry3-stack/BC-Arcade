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

    it("loads an older build's record, which has no `started`, as started", async () => {
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
          },
        })
      );
      const fresh = new PendingGamesStore();
      await fresh.init();
      expect(fresh.get("legacy")?.started).toBe(true);
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
});
