import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  CANVAS_H,
  CANVAS_W,
  buildStateShape,
  engineCounters,
  initStarSwarm,
  restoreEngineCounters,
  stateShape,
} from "../engine";
import {
  PAUSED_RUN_STORAGE_KEY,
  _resetPauseStoreForTests,
  clearSavedPausedState,
  getSavedPausedState,
  hydratePausedState,
  isPausedStateHydrated,
  savePausedState,
} from "../pauseStore";
import type { StarSwarmState } from "../types";

// A paused run survives the process (#2645). `_resetPauseStoreForTests` stands in for a
// new process: the in-memory copy is gone, AsyncStorage is not.

const mockInit = jest.fn().mockResolvedValue(undefined);
const mockCompleteGame = jest.fn();
jest.mock("../../_shared/gameEventClient", () => ({
  gameEventClient: {
    init: () => mockInit(),
    completeGame: (...args: unknown[]) => mockCompleteGame(...args),
  },
}));

function run(): StarSwarmState {
  return { ...initStarSwarm(CANVAS_W, CANVAS_H, 4, 7, "Commander"), score: 1234 };
}

async function newProcess() {
  _resetPauseStoreForTests();
  await hydratePausedState();
}

async function persisted(): Promise<Record<string, unknown> | null> {
  const raw = await AsyncStorage.getItem(PAUSED_RUN_STORAGE_KEY);
  return raw == null ? null : (JSON.parse(raw) as Record<string, unknown>);
}

beforeEach(async () => {
  jest.clearAllMocks();
  mockInit.mockResolvedValue(undefined);
  await AsyncStorage.clear();
  _resetPauseStoreForTests();
});

describe("pauseStore — survives the process (#2645)", () => {
  it("restores a saved run after a cold start", async () => {
    const state = run();
    savePausedState({ gameState: state, difficulty: "Commander" });
    await new Promise((r) => setImmediate(r)); // let the write land

    await newProcess();
    const saved = getSavedPausedState();
    expect(saved?.difficulty).toBe("Commander");
    // JSON only loses what doesn't matter (-0 comes back as 0).
    expect(saved?.gameState).toEqual(JSON.parse(JSON.stringify(state)));
  });

  it("continues the engine's id counter and rng seed", async () => {
    const counters = { nextId: 5000, seed: 123456 };
    savePausedState({ gameState: run(), difficulty: "Commander", counters });
    await new Promise((r) => setImmediate(r));

    restoreEngineCounters({ nextId: 1, seed: 42 }); // a new process starts them over
    await newProcess();
    expect(engineCounters().nextId).toBeGreaterThanOrEqual(5000);
    expect(engineCounters().seed).toBe(123456);
  });

  it("abandons the dead process's session, after the event client has loaded", async () => {
    savePausedState({ gameState: run(), difficulty: "Commander", gameId: "old-game" });
    await new Promise((r) => setImmediate(r));

    await newProcess();
    expect(mockInit).toHaveBeenCalled();
    expect(mockCompleteGame).toHaveBeenCalledTimes(1);
    expect(mockCompleteGame).toHaveBeenCalledWith(
      "old-game",
      { outcome: "abandoned" },
      { outcome: "abandoned" }
    );
    // The restored run doesn't carry the dead session on.
    expect(getSavedPausedState()?.gameId).toBeUndefined();
  });

  it("does not abandon anything when the save has no session", async () => {
    savePausedState({ gameState: run(), difficulty: "Commander" });
    await new Promise((r) => setImmediate(r));
    await newProcess();
    expect(mockCompleteGame).not.toHaveBeenCalled();
  });

  it("a navigation restore in the same process never re-reads disk or touches the counters", async () => {
    savePausedState({
      gameState: run(),
      difficulty: "Commander",
      gameId: "g",
      counters: { nextId: 1, seed: 1 },
    });
    const before = engineCounters();
    await hydratePausedState();
    expect(engineCounters()).toEqual(before);
    expect(mockCompleteGame).not.toHaveBeenCalled();
  });

  it("clear removes the save from disk", async () => {
    savePausedState({ gameState: run(), difficulty: "Commander" });
    await new Promise((r) => setImmediate(r));
    clearSavedPausedState();
    await new Promise((r) => setImmediate(r));
    expect(await persisted()).toBeNull();

    await newProcess();
    expect(getSavedPausedState()).toBeNull();
  });

  it("a clear while hydrating wins over the disk read", async () => {
    savePausedState({ gameState: run(), difficulty: "Commander", gameId: "g" });
    await new Promise((r) => setImmediate(r));

    _resetPauseStoreForTests();
    const hydrating = hydratePausedState();
    clearSavedPausedState();
    await hydrating;
    expect(getSavedPausedState()).toBeNull();
    expect(mockCompleteGame).not.toHaveBeenCalled();
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
});

describe("pauseStore — saves it won't restore", () => {
  async function writeRaw(value: unknown) {
    await AsyncStorage.setItem(
      PAUSED_RUN_STORAGE_KEY,
      typeof value === "string" ? value : JSON.stringify(value)
    );
  }
  const good = () => ({ v: 1, gameState: run(), difficulty: "Commander", gameId: "old" });

  it.each([
    [
      "from an engine with another state shape",
      () => {
        const g = good();
        const { missionCompleteTimer: _, ...older } = g.gameState;
        return { ...g, gameState: older };
      },
    ],
    ["from another save version", () => ({ ...good(), v: 999 })],
    ["with an unknown difficulty", () => ({ ...good(), difficulty: "SpaceCadet" })],
    ["of a finished run", () => ({ ...good(), gameState: { ...run(), phase: "GameOver" } })],
    ["that isn't JSON", () => "{not json"],
  ])("drops a save %s", async (_label, make) => {
    await writeRaw(make());
    await newProcess();
    expect(getSavedPausedState()).toBeNull();
    expect(await persisted()).toBeNull();
    expect(mockCompleteGame).not.toHaveBeenCalled();
  });

  it("a restore that can't reach the event client still restores the run", async () => {
    mockInit.mockRejectedValue(new Error("storage down"));
    await writeRaw(good());
    await expect(newProcess()).resolves.toBeUndefined();
    expect(getSavedPausedState()?.difficulty).toBe("Commander");
  });
});

describe("engine — shape and counters", () => {
  it("buildStateShape leaves the counters alone", () => {
    restoreEngineCounters({ nextId: 777, seed: 999 });
    const before = engineCounters();
    buildStateShape();
    expect(engineCounters()).toEqual(before);
  });

  it("a live state has this build's shape", () => {
    expect(stateShape(run())).toBe(buildStateShape());
  });

  it("restoring never moves the id counter backwards", () => {
    restoreEngineCounters({ nextId: 900, seed: 1 });
    restoreEngineCounters({ nextId: 10, seed: 2 });
    expect(engineCounters().nextId).toBeGreaterThanOrEqual(900);
    expect(engineCounters().seed).toBe(2);
  });
});
