/**
 * #3251: the engine collects a run's closed waves on `state.closedWaves` (wire form), and the
 * paused-run save keeps them, so a resumed run sends them all at its game over.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { CANVAS_H, CANVAS_W, initStarSwarm, tick, toWirePayload } from "../engine";
import {
  _resetPauseStoreForTests,
  getSavedPausedState,
  hydratePausedState,
  savePausedState,
} from "../pauseStore";
import { restoreSavedState } from "../saveShape";
import type { StarSwarmState } from "../types";
import { clearWave, killShip, untilPlaying } from "./helpers/engineFixtures";

const COUNTERS = { nextId: 5000, seed: 123456 };
const flush = () => new Promise((r) => setImmediate(r));

function run(wave = 1): StarSwarmState {
  return initStarSwarm(CANVAS_W, CANVAS_H, wave, 42, "Commander");
}

/** A run that has cleared waves 1 and 2 and is on wave 3. */
function twoCleared(): StarSwarmState {
  return clearWave(untilPlaying(clearWave(untilPlaying(run()))));
}

beforeEach(async () => {
  await AsyncStorage.clear();
  _resetPauseStoreForTests();
});

describe("closedWaves in the engine", () => {
  it("a new run has none", () => {
    expect(run().closedWaves).toEqual([]);
    expect(run(4).closedWaves).toEqual([]);
  });

  it("collects each cleared wave, oldest first, as its wire payload", () => {
    const s = twoCleared();
    expect(s.wave).toBe(3);
    expect(s.closedWaves.map((w) => [w.wave, w.outcome])).toEqual([
      [1, "cleared"],
      [2, "cleared"],
    ]);
    // the newest entry is exactly the close waveJustClosed reports, on the wire
    expect(s.closedWaves[1]).toEqual(toWirePayload(s.lastClosedWave!));
  });

  it("adds the wave the run ends on as died, on the GameOver tick, once", () => {
    const over = killShip(untilPlaying(twoCleared()));
    expect(over.phase).toBe("GameOver");
    expect(over.closedWaves.map((w) => [w.wave, w.outcome])).toEqual([
      [1, "cleared"],
      [2, "cleared"],
      [3, "died"],
    ]);
    expect(over.closedWaves[2]).toEqual(toWirePayload(over.lastClosedWave!));
    // GameOver is terminal: no later tick adds it again
    expect(tick(over, 16, { playerX: 100, fire: false }).closedWaves).toBe(over.closedWaves);
  });
});

describe("closedWaves in the paused-run save", () => {
  it("survives pause → app kill → restore", async () => {
    const state = twoCleared();
    savePausedState({ gameState: state, difficulty: "Commander", counters: COUNTERS });
    await flush();
    _resetPauseStoreForTests(); // the OS killed the app

    await hydratePausedState();
    const restored = getSavedPausedState()?.gameState;
    expect(restored?.closedWaves).toEqual(JSON.parse(JSON.stringify(state.closedWaves)));
    // ... and the run's later closes go on from there
    const over = killShip(untilPlaying(restored!));
    expect(over.closedWaves.map((w) => w.wave)).toEqual([1, 2, 3]);
  });

  it("an older save without them restores []", () => {
    const { closedWaves: _c, ...older } = twoCleared();
    expect(restoreSavedState(older).closedWaves).toEqual([]);
  });

  describe("an invalid saved closedWaves restores []", () => {
    const s = twoCleared();
    const [w1, w2] = s.closedWaves as [Record<string, unknown>, Record<string, unknown>];
    const cases: [string, unknown][] = [
      ["not an array", { 0: w1 }],
      ["an entry that isn't an object", [w1, 7]],
      ["another schema version", [w1, { ...w2, v: 2 }]],
      ["a wave below 1", [{ ...w1, wave: 0 }]],
      ["an unknown outcome", [{ ...w1, outcome: "quit" }]],
      ["an unknown difficulty", [{ ...w1, difficulty: "GrandAdmiral" }]],
      ["a missing section", [(({ combat: _x, ...rest }) => rest)(w1)]],
      ["an extra top-level key", [{ ...w1, extra: 1 }]],
      ["a negative count", [{ ...w1, combat: { shotsFired: -1 } }]],
      ["a string count", [{ ...w1, powerUps: { collected: { shield: "3" } } }]],
      ["waves out of order", [w2, w1]],
    ];
    it.each(cases)("%s", (_name, closedWaves) => {
      expect(restoreSavedState({ ...s, closedWaves }).closedWaves).toEqual([]);
    });

    it("while a valid one is kept, a repeated wave (a dev revert) included", () => {
      const kept = [w1, { ...w2, outcome: "died", dev: true }, { ...w2, dev: true }];
      expect(restoreSavedState({ ...s, closedWaves: kept }).closedWaves).toEqual(kept);
    });
  });
});
