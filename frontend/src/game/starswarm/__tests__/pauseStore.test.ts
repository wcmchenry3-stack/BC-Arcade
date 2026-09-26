import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  CANVAS_H,
  CANVAS_W,
  applyPowerUp,
  engineCounters,
  initStarSwarm,
  isEngineCounters,
  restoreEngineCounters,
  throwAsteroid,
  tick,
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
import { SAVE_FINGERPRINT, fitsSaveShape } from "../saveShape";
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
