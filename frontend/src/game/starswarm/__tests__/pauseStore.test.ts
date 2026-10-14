import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  CANVAS_H,
  CANVAS_W,
  applyPowerUp,
  bumpWave,
  closeWave,
  emptyWaveStats,
  engineCounters,
  initStarSwarm,
  isEngineCounters,
  restoreEngineCounters,
  throwAsteroid,
  tick,
  waveJustClosed,
} from "../engine";
import {
  HYDRATE_TIMEOUT_MS,
  PAUSED_RUN_STORAGE_KEY,
  _resetPauseStoreForTests,
  clearSavedPausedState,
  getSavedPausedState,
  hydratePausedState,
  isPausedStateHydrated,
  savePausedState,
} from "../pauseStore";
import { SAVE_FINGERPRINT, fitsSaveShape, restoreSavedState } from "../saveShape";
import { loadoutOf } from "../engine/waveStats";
import { countSpawned } from "../engine/waveCounters";
import { tickCollisions } from "../engine/collisions";
import type { StarSwarmState } from "../types";

// A paused run survives the process (#2645). `_resetPauseStoreForTests` stands in for a
// new process: the in-memory copy is gone, AsyncStorage is not. The run's sync session is
// not the store's business (#2654): the screen resumes it, the generic killed-session
// handling closes it otherwise.

const COUNTERS = { nextId: 5000, seed: 123456 };

function run(): StarSwarmState {
  return { ...initStarSwarm(CANVAS_W, CANVAS_H, 4, 7, "Commander"), score: 1234 };
}

const flush = () => new Promise((r) => setImmediate(r));

async function saveAndDie(extra: Record<string, unknown> = {}) {
  savePausedState({ gameState: run(), difficulty: "Commander", counters: COUNTERS, ...extra });
  await flush(); // let the write land
  _resetPauseStoreForTests(); // the OS killed the app
}

async function persisted(): Promise<Record<string, unknown> | null> {
  const raw = await AsyncStorage.getItem(PAUSED_RUN_STORAGE_KEY);
  return raw == null ? null : (JSON.parse(raw) as Record<string, unknown>);
}

async function writeRaw(value: unknown) {
  await AsyncStorage.setItem(
    PAUSED_RUN_STORAGE_KEY,
    typeof value === "string" ? value : JSON.stringify(value)
  );
}

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  _resetPauseStoreForTests();
});

describe("pauseStore — survives the process (#2645)", () => {
  it("restores a saved run after a cold start", async () => {
    const state = run();
    savePausedState({ gameState: state, difficulty: "Commander", counters: COUNTERS });
    await flush();
    _resetPauseStoreForTests();

    await hydratePausedState();
    const saved = getSavedPausedState();
    expect(saved?.difficulty).toBe("Commander");
    // JSON only loses what doesn't matter (-0 comes back as 0).
    expect(saved?.gameState).toEqual(JSON.parse(JSON.stringify(state)));
  });

  it("continues the engine's id counter and rng seed", async () => {
    await saveAndDie();
    restoreEngineCounters({ nextId: 1, seed: 42 }); // a new process starts them over
    await hydratePausedState();
    expect(engineCounters().nextId).toBeGreaterThanOrEqual(COUNTERS.nextId);
    expect(engineCounters().seed).toBe(COUNTERS.seed);
  });

  it("saves no sync session with the run", async () => {
    await saveAndDie();
    expect(await persisted()).not.toHaveProperty("gameId");
  });

  it("restores a save from a build that stored the run's session, without it", async () => {
    // #2651 builds saved `gameId`; it is ignored, not restored.
    await saveAndDie({ gameId: "old-game" });
    await hydratePausedState();
    expect(getSavedPausedState()?.difficulty).toBe("Commander");
    expect(getSavedPausedState()).not.toHaveProperty("gameId");
  });

  it("a navigation restore in the same process never re-reads disk or touches the counters", async () => {
    savePausedState({
      gameState: run(),
      difficulty: "Commander",
      counters: { nextId: 1, seed: 1 },
    });
    const before = engineCounters();
    await hydratePausedState();
    await flush();
    expect(engineCounters()).toEqual(before);
  });

  it("clear removes the save from disk", async () => {
    savePausedState({ gameState: run(), difficulty: "Commander", counters: COUNTERS });
    await flush();
    clearSavedPausedState();
    await flush();
    expect(await persisted()).toBeNull();

    _resetPauseStoreForTests();
    await hydratePausedState();
    expect(getSavedPausedState()).toBeNull();
  });

  it("a clear while hydrating wins over the disk read", async () => {
    await saveAndDie();
    const hydrating = hydratePausedState();
    clearSavedPausedState();
    await hydrating;
    await flush();
    expect(getSavedPausedState()).toBeNull();
  });

  it("hydrates once per process", async () => {
    const getItem = AsyncStorage.getItem as jest.Mock; // the AsyncStorage jest mock
    const before = getItem.mock.calls.length;
    expect(isPausedStateHydrated()).toBe(false);
    await Promise.all([hydratePausedState(), hydratePausedState()]);
    await hydratePausedState();
    expect(getItem.mock.calls.length - before).toBe(1);
    expect(isPausedStateHydrated()).toBe(true);
  });

  it("gives up on a disk read that never settles, and restores nothing late", async () => {
    await saveAndDie();
    const raw = await AsyncStorage.getItem(PAUSED_RUN_STORAGE_KEY);
    let settle: (raw: string | null) => void = () => undefined;
    (AsyncStorage.getItem as jest.Mock).mockImplementationOnce(
      () => new Promise((r) => (settle = r))
    );
    jest.useFakeTimers();
    try {
      const hydrating = hydratePausedState();
      jest.advanceTimersByTime(HYDRATE_TIMEOUT_MS);
      await hydrating;
    } finally {
      jest.useRealTimers();
    }
    expect(isPausedStateHydrated()).toBe(true);
    expect(getSavedPausedState()).toBeNull();

    settle(raw); // the read lands late: the run stays out
    await flush();
    await flush();
    expect(getSavedPausedState()).toBeNull();
  });
});

describe("pauseStore — saves it won't restore are dropped", () => {
  const good = () => ({
    v: 1,
    fp: SAVE_FINGERPRINT,
    gameState: run(),
    difficulty: "Commander",
    counters: COUNTERS,
  });
  const withState = (patch: (s: Record<string, unknown>) => Record<string, unknown>) => {
    const g = good();
    return { ...g, gameState: patch(g.gameState as unknown as Record<string, unknown>) };
  };

  it.each([
    ["from another save version", () => ({ ...good(), v: 999 })],
    ["from a build with another shape", () => ({ ...good(), fp: "older" })],
    ["with an unknown difficulty", () => ({ ...good(), difficulty: "SpaceCadet" })],
    ["of a finished run", () => withState((s) => ({ ...s, phase: "GameOver" }))],
    ["with no counters", () => ({ ...good(), counters: undefined })],
    ["with a non-numeric id counter", () => ({ ...good(), counters: { nextId: "5", seed: 1 } })],
    ["with a missing seed", () => ({ ...good(), counters: { nextId: 9 } })],
    [
      "whose top-level state is missing a field",
      () =>
        withState((s) => {
          const { missionCompleteTimer: _, ...rest } = s;
          return rest;
        }),
    ],
    [
      "with an enemy missing a field",
      () =>
        withState((s) => {
          const [first, ...others] = s.enemies as Record<string, unknown>[];
          const { flakCooldown: _, ...older } = first!;
          return { ...s, enemies: [older, ...others] };
        }),
    ],
    [
      "with a field this build doesn't know",
      () => withState((s) => ({ ...s, player: { ...(s.player as object), jetpack: true } })),
    ],
  ])("drops a save %s", async (_label, make) => {
    const save = make(); // building a state draws engine ids
    const before = engineCounters();
    await writeRaw(save);
    await hydratePausedState();
    await flush();
    expect(getSavedPausedState()).toBeNull();
    expect(await persisted()).toBeNull();
    expect(engineCounters()).toEqual(before);
  });

  it("drops a save that isn't JSON", async () => {
    await writeRaw("{not json");
    await hydratePausedState();
    await flush();
    expect(getSavedPausedState()).toBeNull();
    expect(await persisted()).toBeNull();
  });
});

describe("saveShape — every state a real run produces fits", () => {
  it("fits through a long run with every kind of object on screen", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H, 3, 7, "Commander");
    const seen = new Set<string>();
    for (let i = 0; i < 3000 && s.phase !== "GameOver"; i++) {
      if (i === 300) s = throwAsteroid(applyPowerUp(s, "shield"));
      if (i === 700) s = applyPowerUp(s, "buddy");
      s = tick(s, 16, { playerX: 60 + ((i * 3) % 240), fire: true });
      if (!fitsSaveShape(JSON.parse(JSON.stringify(s)))) {
        throw new Error(`tick ${i}: the state doesn't fit the save shape`);
      }
      if (s.playerBullets.length) seen.add("playerBullets");
      if (s.enemyBullets.length) seen.add("enemyBullets");
      if (s.explosions.length) seen.add("explosions");
      if (s.powerUps.length) seen.add("powerUps");
      if (s.buddyShips.length) seen.add("buddyShips");
      if (s.asteroids.length) seen.add("asteroids");
      if (s.activePowerUp) seen.add("activePowerUp");
    }
    expect([...seen].sort()).toEqual([
      "activePowerUp",
      "asteroids",
      "buddyShips",
      "enemyBullets",
      "explosions",
      "playerBullets",
      "powerUps",
    ]);
  });
});

describe("engine — counters", () => {
  it("restoring never moves the id counter backwards", () => {
    restoreEngineCounters({ nextId: 900, seed: 1 });
    restoreEngineCounters({ nextId: 10, seed: 2 });
    expect(engineCounters().nextId).toBeGreaterThanOrEqual(900);
    expect(engineCounters().seed).toBe(2);
  });

  it("invalid counters change nothing", () => {
    const before = engineCounters();
    restoreEngineCounters({ nextId: NaN, seed: 1 });
    restoreEngineCounters({ seed: 5 } as unknown as { nextId: number; seed: number });
    expect(engineCounters()).toEqual(before);
    expect(isEngineCounters({ nextId: 1.5, seed: 0 })).toBe(false);
    expect(isEngineCounters({ nextId: 1, seed: -1 })).toBe(false);
    expect(isEngineCounters({ nextId: 1, seed: 0xffffffff })).toBe(true);
  });
});

describe("per-wave stats in a save (#3245)", () => {
  /** A run partway through wave 4, with counts on the wave and a closed wave behind it. */
  function counted(): StarSwarmState {
    const s = run();
    let waveStats = bumpWave(s.waveStats, ["combat", "kills", "Elite", "dive"], 3);
    waveStats = bumpWave(waveStats, ["pacing", "durationMs"], 4321);
    return { ...s, waveStats, lastClosedWave: closeWave(run(), "cleared") };
  }

  /** A save as a build before #3245 wrote it: no waveStats, no lastClosedWave. */
  function olderSave(state: StarSwarmState) {
    const {
      waveStats: _w,
      lastClosedWave: _l,
      ...older
    } = JSON.parse(JSON.stringify(state)) as Record<string, unknown>;
    return {
      v: 1,
      fp: SAVE_FINGERPRINT,
      gameState: older,
      difficulty: "Commander",
      counters: COUNTERS,
    };
  }

  it("round-trips the wave's counts; the last closed wave always restores as null", async () => {
    const state = counted();
    expect(state.lastClosedWave).not.toBeNull();
    savePausedState({ gameState: state, difficulty: "Commander", counters: COUNTERS });
    await flush();
    // the snapshot isn't written to disk at all
    const onDisk = (await persisted())?.gameState as Record<string, unknown>;
    expect(onDisk.waveStats).toEqual(state.waveStats);
    expect("lastClosedWave" in onDisk).toBe(false);
    _resetPauseStoreForTests();

    await hydratePausedState();
    const restored = getSavedPausedState()?.gameState;
    expect(restored?.waveStats).toEqual(state.waveStats);
    expect(restored?.waveStats.combat.kills.Elite.dive).toBe(3);
    expect(restored?.waveStats.pacing.durationMs).toBe(4321);
    expect(restored?.lastClosedWave).toBeNull();
    // ... so nothing reads as a fresh close on the first tick after the restore
    expect(
      waveJustClosed(restored!, tick(restored!, 16, { playerX: 100, fire: false }))
    ).toBeNull();
  });

  it("restores an older save without them, with fresh stats from the restored ship", async () => {
    const s = run();
    await writeRaw(olderSave({ ...s, player: { ...s.player, lives: 2, guns: 2, hull: 1 } }));
    await hydratePausedState();

    const restored = getSavedPausedState()?.gameState;
    if (!restored) throw new Error("the older save wasn't restored");
    // #3248: fresh stats are seeded with the saved roster as the wave's spawns
    expect(restored.waveStats).toEqual(
      countSpawned(emptyWaveStats({ lives: 2, guns: 2, hull: 1 }), s.enemies)
    );
    expect(restored.lastClosedWave).toBeNull();
    expect(restored.score).toBe(1234);
    // and it plays on
    expect(tick(restored, 16, { playerX: 100, fire: true }).waveStats.pacing.durationMs).toBe(16);
  });

  it("restores a save whose stats don't fit this build's registries, stats started over", async () => {
    const save = olderSave(counted());
    const stale = counted().waveStats;
    const { hull: _gone, ...collected } = stale.powerUps.collected; // a power-up it didn't know
    const gameState = {
      ...save.gameState,
      waveStats: { ...stale, powerUps: { ...stale.powerUps, collected } },
      lastClosedWave: { not: "a snapshot" },
    };
    await writeRaw({ ...save, gameState });
    await hydratePausedState();

    const restored = getSavedPausedState()?.gameState;
    expect(restored?.waveStats.combat.kills.Elite.dive).toBe(0);
    expect(restored?.waveStats.powerUps.collected.hull).toBe(0);
    expect(restored?.lastClosedWave).toBeNull();
  });

  describe("a saved waveStats with an invalid leaf restores fresh stats", () => {
    const fresh = () => {
      const s = JSON.parse(JSON.stringify(counted())) as StarSwarmState;
      return { s, ws: s.waveStats };
    };
    type WS = StarSwarmState["waveStats"];
    const withStart = (ws: WS, start: Record<string, unknown>) =>
      ({ ...ws, pacing: { ...ws.pacing, start: { ...ws.pacing.start, ...start } } }) as unknown;
    const cases: [string, (ws: WS) => unknown][] = [
      [
        "a stage time that is a string",
        (ws) => ({
          ...ws,
          carrier: {
            ...ws.carrier,
            stageReachedMs: { ...ws.carrier.stageReachedMs, exposed: "1" },
          },
        }),
      ],
      [
        "a negative stage time",
        (ws) => ({
          ...ws,
          carrier: { ...ws.carrier, stageReachedMs: { ...ws.carrier.stageReachedMs, exposed: -5 } },
        }),
      ],
      ["a rout time that is a string", (ws) => ({ ...ws, rout: { ...ws.rout, atMs: "soon" } })],
      ["a negative rout time", (ws) => ({ ...ws, rout: { ...ws.rout, atMs: -1 } })],
      [
        "a death cause outside HIT_CAUSES",
        (ws) => ({
          ...ws,
          damage: { ...ws.damage, deathCause: "laser" },
        }),
      ],
      ["guns 0", (ws) => withStart(ws, { guns: 0 })],
      ["guns 4", (ws) => withStart(ws, { guns: 4 })],
      ["guns 1.5", (ws) => withStart(ws, { guns: 1.5 })],
      ["hull 3", (ws) => withStart(ws, { hull: 3 })],
      ["hull -1", (ws) => withStart(ws, { hull: -1 })],
      ["a negative counter", (ws) => ({ ...ws, combat: { ...ws.combat, shotsFired: -1 } })],
    ];

    it.each(cases)("%s", (_label, spoil) => {
      const { s, ws } = fresh();
      const restored = restoreSavedState({ ...s, waveStats: spoil(ws) });
      // #3248: fresh stats are seeded with the saved roster as the wave's spawns
      expect(restored.waveStats).toEqual(
        countSpawned(emptyWaveStats(loadoutOf(s.player)), s.enemies)
      );
    });

    it("while valid values of those leaves are kept", () => {
      const { s, ws } = fresh();
      const valid = {
        ...ws,
        pacing: { ...ws.pacing, start: { lives: 2, guns: 3, hull: 2 } },
        carrier: {
          ...ws.carrier,
          stageReachedMs: { protected: 0, exposed: 1200.5, finalStand: null },
        },
        rout: { ...ws.rout, triggered: true, atMs: 900 },
        damage: { ...ws.damage, deathCause: "beam" },
      } as WS;
      expect(restoreSavedState({ ...s, waveStats: valid }).waveStats).toEqual(valid);
    });
  });

  describe("combat.spawned after a restore (#3248)", () => {
    const tiers = ["Grunt", "Elite", "Guardian", "Carrier"] as const;
    /** Mid-wave: two ships of the roster already down (they still belong to the wave). */
    const midWave = (): StarSwarmState => {
      const s = run();
      let down = 0;
      const enemies = s.enemies.map((e) =>
        e.tier === "Grunt" && down++ < 2 ? { ...e, isAlive: false, hp: 0 } : e
      );
      return JSON.parse(JSON.stringify({ ...s, enemies })) as StarSwarmState;
    };
    const rosterOf = (s: StarSwarmState) => {
      const out = { Grunt: 0, Elite: 0, Guardian: 0, Carrier: 0 };
      for (const e of s.enemies) out[e.tier]++;
      return out;
    };

    it("fresh stats count the whole saved roster, so later kills have spawns to match", () => {
      const s = midWave();
      const { waveStats: _w, ...older } = s;
      const restored = restoreSavedState(older as unknown as StarSwarmState);
      expect(restored.waveStats.combat.spawned).toEqual(rosterOf(s));
      // shoot down every ship still alive in one collision pass, then close: no tier has more
      // kills than spawns
      const alive = restored.enemies.filter((e) => e.isAlive);
      const shots = alive.map((e, i) => ({
        id: 900_000 + i,
        x: e.x,
        y: e.y,
        vx: 0,
        vy: 0,
        owner: "player" as const,
        width: 2,
        height: 2,
        damage: 99,
        armorPiercing: true, // through an escorted Carrier's field too
      }));
      const after = tickCollisions({ ...restored, playerBullets: shots });
      expect(after.enemies.some((e) => e.isAlive)).toBe(false);
      const snap = closeWave(after, "cleared");
      for (const t of tiers) {
        const kills = Object.values(snap.combat.kills[t]).reduce((a, n) => a + n, 0);
        expect(kills).toBe(alive.filter((e) => e.tier === t).length);
        expect(snap.combat.spawned[t]).toBeGreaterThanOrEqual(kills);
      }
    });

    it("kept stats from a build before #3248 (no spawns) are seeded from the roster", () => {
      const s = midWave();
      const zero = { Grunt: 0, Elite: 0, Guardian: 0, Carrier: 0 };
      const ws = { ...s.waveStats, combat: { ...s.waveStats.combat, spawned: zero } };
      const restored = restoreSavedState({ ...s, waveStats: ws });
      expect(restored.waveStats.combat.spawned).toEqual(rosterOf(s));
      expect(restored.waveStats.combat.kills).toEqual(ws.combat.kills); // the rest is kept
    });

    it("kept stats that already count spawns are left alone", () => {
      const s = midWave();
      const ws = bumpWave(s.waveStats, ["combat", "spawned", "Grunt"], 3);
      expect(restoreSavedState({ ...s, waveStats: ws }).waveStats).toBe(ws);
    });
  });

  it("restoreSavedState keeps stats that fit and drops the closed wave", () => {
    const state = JSON.parse(JSON.stringify(counted())) as StarSwarmState;
    expect(fitsSaveShape(state)).toBe(true);
    expect(restoreSavedState(state)).toEqual({ ...state, lastClosedWave: null });
  });

  it("are outside the save fingerprint, so adding them kept every existing save", () => {
    expect(SAVE_FINGERPRINT).not.toContain("waveStats");
    expect(SAVE_FINGERPRINT).not.toContain("lastClosedWave");
  });

  it("a state with a top-level key this build doesn't know still doesn't fit", () => {
    const s = JSON.parse(JSON.stringify(run())) as Record<string, unknown>;
    expect(fitsSaveShape({ ...s, waveStatz: {} })).toBe(false);
  });
});
