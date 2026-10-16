/**
 * #3251: the engine collects a run's closed waves on `state.closedWaves` (wire form), and the
 * paused-run save keeps them, so a resumed run sends them all at its game over.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  CANVAS_H,
  CANVAS_W,
  WAVE_STATS_MAX_BYTES,
  closeWave,
  initStarSwarm,
  tick,
  toWirePayload,
} from "../engine";
import type { WaveStatsSnapshot } from "../engine";
import {
  NO_OVERFLOW,
  WAVE_STATS_RUN_MAX_BYTES,
  collectClosedWave,
  wireBytes,
} from "../engine/closedWaves";
import { GameRecorder, type RecordingDropReport } from "../../_shared/gameRecorder";
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

describe("closedWaves stays bounded", () => {
  /** Wave `n`'s close, padded to about `pad` bytes on the wire. */
  function padded(n: number, pad: number): WaveStatsSnapshot {
    const snap = closeWave({ ...run(), wave: n }, "cleared");
    return { ...snap, score: { ...snap.score, pts: { ["x".repeat(pad)]: 0 } } };
  }

  it("a long run keeps at most the run cap, and counts the rest", () => {
    let s = run();
    const sizes: number[] = [];
    for (let n = 1; n <= 60; n++) {
      const snap = padded(n, 3000);
      sizes.push(wireBytes(toWirePayload(snap)));
      s = collectClosedWave(s, snap);
    }
    const kept = s.closedWaves.reduce((sum, w) => sum + wireBytes(w), 0);
    expect(kept).toBeLessThanOrEqual(WAVE_STATS_RUN_MAX_BYTES);
    // the running total matches the list
    expect(s.closedWavesBytes).toBe(kept);
    // the earliest waves that fit, in order
    expect(s.closedWaves.map((w) => w.wave)).toEqual(
      Array.from({ length: s.closedWaves.length }, (_, i) => i + 1)
    );
    const left = sizes.slice(s.closedWaves.length);
    expect(s.closedWavesOverflow).toEqual({
      waves: 60 - s.closedWaves.length,
      bytes: left.reduce((a, b) => a + b, 0),
      largestBytes: Math.max(...left),
      full: true,
    });
    // the list the engine kept is exactly what the recorder's caps accept (same limits): it
    // saves every kept wave and has nothing to report; the overflow count covers the rest
    const reports: RecordingDropReport[] = [];
    let saved = 0;
    const recorder = new GameRecorder({
      gameType: "starswarm",
      policy: "on_session_end",
      sink: {
        canAccept: () => true,
        enqueueMany: (events) => {
          saved += events.length;
          return true;
        },
      },
      schedule: () => undefined,
      report: (r) => reports.push(r),
    });
    for (const w of s.closedWaves) recorder.record("wave_completed", { ...w });
    recorder.endSession();
    expect(saved).toBe(s.closedWaves.length);
    expect(reports).toEqual([]);
    expect(saved + s.closedWavesOverflow.waves).toBe(60);
  });

  it("once the run cap is hit, no later (smaller) wave is kept", () => {
    let s = run();
    // bounded, so a regression fails fast instead of hanging
    let n = 1;
    for (; n < 300 && s.closedWavesOverflow.waves === 0; n++) {
      s = collectClosedWave(s, padded(n, 3000));
    }
    expect(n).toBeLessThan(300);
    const kept = s.closedWaves.length;
    s = collectClosedWave(s, closeWave({ ...run(), wave: 99 }, "died"));
    expect(s.closedWaves).toHaveLength(kept);
    expect(s.closedWavesOverflow.waves).toBe(2);
  });

  it("a wave over the per-wave cap is never kept, but later waves still are", () => {
    const huge = padded(1, WAVE_STATS_MAX_BYTES);
    const hugeBytes = wireBytes(toWirePayload(huge));
    expect(hugeBytes).toBeGreaterThan(WAVE_STATS_MAX_BYTES);
    let s = collectClosedWave(run(), huge);
    s = collectClosedWave(s, closeWave({ ...run(), wave: 2 }, "cleared"));
    expect(s.closedWaves.map((w) => w.wave)).toEqual([2]);
    expect(s.closedWavesOverflow).toEqual({
      waves: 1,
      bytes: hugeBytes,
      largestBytes: hugeBytes,
      full: false,
    });
  });

  it("a new run starts with no overflow", () => {
    expect(run().closedWavesOverflow).toEqual(NO_OVERFLOW);
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

  it("an older save without them restores [] and no overflow", () => {
    const {
      closedWaves: _c,
      closedWavesOverflow: _o,
      closedWavesBytes: _b,
      ...older
    } = twoCleared();
    const restored = restoreSavedState(older);
    expect(restored.closedWaves).toEqual([]);
    expect(restored.closedWavesOverflow).toEqual(NO_OVERFLOW);
    expect(restored.closedWavesBytes).toBe(0);
  });

  it("recomputes the running byte total on restore, whatever the save holds", () => {
    const s = twoCleared();
    const bytes = s.closedWaves.reduce((sum, w) => sum + wireBytes(w), 0);
    expect(s.closedWavesBytes).toBe(bytes);
    // an earlier build of this branch saved no total; a corrupt one is ignored too
    const { closedWavesBytes: _b, ...noTotal } = s;
    expect(restoreSavedState(noTotal).closedWavesBytes).toBe(bytes);
    expect(restoreSavedState({ ...s, closedWavesBytes: -7 }).closedWavesBytes).toBe(bytes);
    // a dropped list restores with a total of 0
    expect(restoreSavedState({ ...s, closedWaves: "x" }).closedWavesBytes).toBe(0);
  });

  it("keeps a saved overflow count that fits, and drops one that doesn't", () => {
    const s = twoCleared();
    const over = { waves: 2, bytes: 7000, largestBytes: 3600, full: true };
    expect(restoreSavedState({ ...s, closedWavesOverflow: over }).closedWavesOverflow).toEqual(
      over
    );
    for (const bad of [
      null,
      { ...over, waves: -1 },
      { ...over, bytes: 1.5 },
      { ...over, full: "yes" },
      { waves: 2, bytes: 7000, largestBytes: 3600 },
      { ...over, extra: 0 },
    ]) {
      expect(restoreSavedState({ ...s, closedWavesOverflow: bad }).closedWavesOverflow).toEqual(
        NO_OVERFLOW
      );
    }
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
      ["rout.triggered not a boolean", [{ ...w1, rout: { ...(w1.rout as object), triggered: 1 } }]],
      ["rout.atMs a string", [{ ...w1, rout: { ...(w1.rout as object), atMs: "0" } }]],
      ["rout.atMs negative", [{ ...w1, rout: { ...(w1.rout as object), atMs: -5 } }]],
      ["rout.atMs fractional", [{ ...w1, rout: { ...(w1.rout as object), atMs: 1.5 } }]],
      ["a rout count null", [{ ...w1, rout: { ...(w1.rout as object), grunts: null } }]],
      ["a rout count a boolean", [{ ...w1, rout: { ...(w1.rout as object), caught: true } }]],
      ["a rout count fractional", [{ ...w1, rout: { ...(w1.rout as object), escaped: 0.5 } }]],
      ["a rout key missing", [{ ...w1, rout: { triggered: false, atMs: null } }]],
      ["an unknown death cause", [{ ...w1, damage: { deathCause: "laser" } }]],
      ["a missing death cause", [{ ...w1, damage: {} }]],
      ["a damage count null", [{ ...w1, damage: { deathCause: null, hits: { rock: null } } }]],
      ["a damage count a string", [{ ...w1, damage: { deathCause: null, hits: { beam: "x" } } }]],
      [
        "a damage count fractional",
        [{ ...w1, damage: { deathCause: "rock", hits: { rock: { life: 0.5 } } } }],
      ],
    ];
    it.each(cases)("%s", (_name, closedWaves) => {
      expect(restoreSavedState({ ...s, closedWaves }).closedWaves).toEqual([]);
    });

    it("while a valid one is kept, a repeated wave (a dev revert) included", () => {
      const kept = [
        w1,
        {
          ...w2,
          outcome: "died",
          dev: true,
          damage: { deathCause: "beam", hits: { beam: { life: 1 } } },
        },
        {
          ...w2,
          dev: true,
          rout: { triggered: true, atMs: 1200, grunts: 3, caught: 2, escaped: 1 },
        },
      ];
      expect(restoreSavedState({ ...s, closedWaves: kept }).closedWaves).toEqual(kept);
    });
  });
});
