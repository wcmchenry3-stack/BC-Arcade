/**
 * #3393: the wave timeline across a pause, a process death and a restore
 * (docs/games/starswarm-diagnostics.md, "Pause, resume, abandonment, process death, duplicates").
 *
 *  - A round trip restores every timeline field as saved (lengths and bytes recomputed, never
 *    trusted), and the run carries on: the wave in progress closes with its pre-pause entries,
 *    `t` running on, joined exactly to its `wave_completed`.
 *  - A save without the fields (an older build), or with non-boolean flags, restores with
 *    recording lost: later closes count as `unrecorded`, across a second pause and restore too.
 *  - A live buffer that doesn't fit, or whose wave stats restored fresh, or whose last `t` is past
 *    the restored clock, is dropped for that wave only; the next wave opens a fresh one.
 *  - The closed timelines restore only with the closed waves, and only when every entry fits.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

import { CANVAS_H, CANVAS_W, initStarSwarm, tick } from "../engine";
import {
  EMPTY_TIMELINE,
  NO_TIMELINE_OVERFLOW,
  TIMELINE_RUN_MAX_BYTES,
  TIMELINE_RUN_MAX_WAVES,
  TL,
  timelineT,
  tlHullHit,
  tlLifeLost,
  tlPickup,
  type WaveTimeline,
  type WaveTimelineWire,
} from "../engine/waveTimeline";
import {
  _resetPauseStoreForTests,
  getSavedPausedState,
  hydratePausedState,
  savePausedState,
} from "../pauseStore";
import { fitsSaveShape, restoreSavedState, type SavedStarSwarmState } from "../saveShape";
import type { StarSwarmState } from "../types";
import { NO_INPUT, clearWave, killShip, shotOnShip, untilPlaying } from "./helpers/engineFixtures";

const W = CANVAS_W;

function recording(wave = 1): StarSwarmState {
  return initStarSwarm(CANVAS_W, CANVAS_H, wave, 42, "Commander", undefined, undefined, {
    timelineOn: true,
  });
}

/** One tick in which a shot takes the ship's plate (a HULL_HIT, the wave counted as damaged). */
function hit(s: StarSwarmState): StarSwarmState {
  return tick(
    {
      ...s,
      player: { ...s.player, hull: 1, invincibleTimer: 0 },
      activePowerUp: null,
      enemyBullets: [shotOnShip(s)],
    },
    16,
    NO_INPUT
  );
}

let midRunCache: StarSwarmState | null = null;

/**
 * Wave 1 damaged and cleared (kept), wave 2 under way with a hit in its live buffer. Played once
 * and shared: engine states are never mutated.
 */
function midRun(): StarSwarmState {
  if (midRunCache) return midRunCache;
  const s = hit(untilPlaying(clearWave(hit(untilPlaying(recording())))));
  midRunCache = s;
  expect(s.wave).toBe(2);
  expect(s.closedTimelines).toHaveLength(1);
  expect(s.waveTimeline!.e.some((e) => e[1] === TL.HULL_HIT)).toBe(true);
  return s;
}

/** What a save holds once it is written and read back (pauseStore drops `lastClosedWave`). */
function saved(s: StarSwarmState, patch: Record<string, unknown> = {}): SavedStarSwarmState {
  const { lastClosedWave: _dropped, ...rest } = s;
  const out = JSON.parse(JSON.stringify({ ...rest, ...patch })) as Record<string, unknown>;
  for (const [k, v] of Object.entries(patch)) if (v === undefined) delete out[k];
  expect(fitsSaveShape(out)).toBe(true);
  return out as unknown as SavedStarSwarmState;
}

const len = (v: unknown) => JSON.stringify(v).length;

/** Each kept timeline's length and the total equal the serialized ones. */
function expectBytesExact(s: StarSwarmState): void {
  expect(s.closedTimelinesLens).toEqual(s.closedTimelines.map(len));
  expect(s.closedTimelinesBytes).toBe(s.closedTimelines.reduce((n, tl) => n + len(tl), 0));
}

/** Every kept timeline pairs with a `wave_completed` of the same wave, outcome and clock. */
function expectJoined(s: StarSwarmState): void {
  for (const tl of s.closedTimelines) {
    const terminal = tl.e[tl.e.length - 1]!;
    const row = s.closedWaves.find(
      (w) =>
        w.wave === tl.wave &&
        w.outcome === tl.outcome &&
        timelineT((w.pacing as { durationMs: number }).durationMs) === terminal[0]
    );
    expect({ wave: tl.wave, outcome: tl.outcome, joined: row !== undefined }).toEqual({
      wave: tl.wave,
      outcome: tl.outcome,
      joined: true,
    });
    for (let i = 1; i < tl.e.length; i++)
      expect(tl.e[i]![0]).toBeGreaterThanOrEqual(tl.e[i - 1]![0]!);
  }
}

const flush = () => new Promise((r) => setImmediate(r));

beforeEach(async () => {
  await AsyncStorage.clear();
  _resetPauseStoreForTests();
});

describe("a pause and restore across a process death (#3393)", () => {
  it("restores every timeline field as saved, and the run carries on consistently", async () => {
    const mid = midRun();
    savePausedState({
      gameState: mid,
      difficulty: "Commander",
      counters: { nextId: 9000, seed: 5 },
    });
    await flush();
    _resetPauseStoreForTests(); // the OS killed the app
    await hydratePausedState();
    const restored = getSavedPausedState()!.gameState;

    expect(restored.timelineOn).toBe(true);
    expect(restored.timelineLost).toBe(false);
    expect(restored.waveTimeline).toEqual(mid.waveTimeline);
    expect(restored.closedTimelines).toEqual(mid.closedTimelines);
    expect(restored.closedTimelinesLens).toEqual(mid.closedTimelinesLens);
    expect(restored.closedTimelinesBytes).toBe(mid.closedTimelinesBytes);
    expect(restored.closedTimelinesOverflow).toEqual(mid.closedTimelinesOverflow);

    // the wave in progress closes with its pre-pause entries first, and `t` runs on
    const cleared = clearWave(restored);
    expect(cleared.wave).toBe(3);
    const wave2 = cleared.closedTimelines.find((tl) => tl.wave === 2)!;
    expect(wave2.outcome).toBe("cleared");
    expect(wave2.e.slice(0, mid.waveTimeline!.e.length)).toEqual(mid.waveTimeline!.e);
    expect(wave2.e.at(-1)![1]).toBe(TL.WAVE_CLEARED);
    // then the run ends: the died timeline is the last kept one, nothing duplicated or missing
    const over = killShip(untilPlaying(cleared));
    expect(over.phase).toBe("GameOver");
    expect(over.closedTimelines.map((tl) => [tl.wave, tl.outcome])).toEqual([
      [1, "cleared"],
      [2, "cleared"],
      [3, "died"],
    ]);
    expect(over.closedTimelines.at(-1)!.e.at(-1)![1]).toBe(TL.RUN_LOST);
    expect(over.closedTimelinesOverflow.unrecorded).toBe(0);
    expectBytesExact(over);
    expectJoined(over);
  });

  it("recomputes closedTimelinesLens and closedTimelinesBytes, whatever the save holds", () => {
    const mid = midRun();
    const restored = restoreSavedState(
      saved(mid, { closedTimelinesLens: [1, 2, 3], closedTimelinesBytes: 7 })
    );
    expect(restored.closedTimelines).toEqual(mid.closedTimelines);
    expectBytesExact(restored);
    const missing = restoreSavedState(
      saved(mid, { closedTimelinesLens: undefined, closedTimelinesBytes: undefined })
    );
    expectBytesExact(missing);
    expect(missing.closedTimelines).toHaveLength(1);
  });

  it("a dev wave's live buffer — the ordinary slots full and the lethal slot used — round-trips", () => {
    let tl: WaveTimeline = EMPTY_TIMELINE;
    for (let i = 0; i < 30; i++) tl = tlHullHit(tl, 100 + i, "bullet", W / 2, W, 0);
    tl = tlLifeLost(tl, 200, "ram", 0, W, 0); // slot 31
    tl = tlHullHit(tl, 300, "bullet", 0, W, 0); // refused, counted
    expect(tl).toMatchObject({ ord: 30, lethal: true, ovf: [1, 0, 0] });
    const mid = midRun();
    const s = {
      ...mid,
      waveStats: { ...mid.waveStats, pacing: { ...mid.waveStats.pacing, durationMs: 500 } },
    };
    const restored = restoreSavedState(saved({ ...s, waveTimeline: tl }));
    expect(restored.waveTimeline).toEqual(tl);
  });
});

describe("a save from an older build, or with corrupt flags (#3393)", () => {
  const LOST = {
    waveTimeline: null,
    timelineOn: false,
    timelineLost: true,
    closedTimelines: [],
    closedTimelinesLens: [],
    closedTimelinesBytes: 0,
    closedTimelinesOverflow: NO_TIMELINE_OVERFLOW,
  };

  it("without the fields: recording lost, and every later close counts as unrecorded", () => {
    const mid = midRun();
    const older = saved(mid, {
      waveTimeline: undefined,
      timelineOn: undefined,
      timelineLost: undefined,
      closedTimelines: undefined,
      closedTimelinesLens: undefined,
      closedTimelinesBytes: undefined,
      closedTimelinesOverflow: undefined,
    });
    const restored = restoreSavedState(older);
    expect(restored).toMatchObject(LOST);
    const cleared = clearWave(restored);
    expect(cleared.waveTimeline).toBeNull(); // no buffer opens: nothing partial is ever sent
    expect(cleared.closedTimelines).toEqual([]);
    expect(cleared.closedTimelinesOverflow.unrecorded).toBe(1);

    // a second pause and restore keeps counting
    const again = restoreSavedState(saved(untilPlaying(cleared)));
    expect(again).toMatchObject({ timelineOn: false, timelineLost: true });
    expect(again.closedTimelinesOverflow.unrecorded).toBe(1);
    const over = killShip(untilPlaying(again));
    expect(over.closedTimelines).toEqual([]);
    expect(over.closedTimelinesOverflow.unrecorded).toBe(2);
  });

  it.each([
    ["timelineOn a string", { timelineOn: "true" }],
    ["timelineOn a number", { timelineOn: 1 }],
    ["timelineLost null", { timelineLost: null }],
    ["timelineLost missing", { timelineLost: undefined }],
  ])("%s: restores as the older-build case", (_name, patch) => {
    const restored = restoreSavedState(saved(midRun(), patch));
    expect(restored).toMatchObject(LOST);
  });

  it("a run whose dial was off from the start stays off and counts nothing", () => {
    const off = untilPlaying(initStarSwarm(CANVAS_W, CANVAS_H, 1, 42, "Commander"));
    const restored = restoreSavedState(saved(off));
    expect(restored).toMatchObject({ timelineOn: false, timelineLost: false, waveTimeline: null });
    const over = killShip(untilPlaying(clearWave(hit(restored))));
    expect(over.closedTimelines).toEqual([]);
    expect(over.closedTimelinesOverflow).toEqual(NO_TIMELINE_OVERFLOW);
  });
});

describe("the live buffer on restore (#3393)", () => {
  /** The wave's buffer after restore, then what its close and the next wave look like. */
  function restoreWithLive(live: unknown, patch: Record<string, unknown> = {}) {
    const mid = midRun();
    const restored = restoreSavedState(saved(mid, { waveTimeline: live, ...patch }));
    return { mid, restored };
  }

  function expectDroppedForThisWave(restored: StarSwarmState): void {
    expect(restored.timelineOn).toBe(true);
    expect(restored.waveTimeline).toBeNull();
    const cleared = clearWave(restored);
    // the wave closes unrecorded, the next one opens a fresh buffer
    expect(cleared.closedTimelinesOverflow.unrecorded).toBe(1);
    expect(cleared.closedTimelines.map((tl) => tl.wave)).toEqual([1]);
    expect(cleared.waveTimeline).not.toBeNull();
    const over = killShip(untilPlaying(cleared));
    expect(over.closedTimelines.map((tl) => [tl.wave, tl.outcome])).toEqual([
      [1, "cleared"],
      [3, "died"],
    ]);
  }

  const base = (): WaveTimeline => midRun().waveTimeline!;

  it.each<[string, (tl: WaveTimeline) => unknown]>([
    [
      "t decreasing",
      (tl) => ({
        ...tl,
        e: [
          [50, TL.ROUT],
          [10, TL.ROUT],
        ],
        ord: 2,
        c: 2,
        eBytes: len([
          [50, 13],
          [10, 13],
        ]),
      }),
    ],
    [
      "a wrong arity",
      (tl) => ({ ...tl, e: [[5, TL.HULL_HIT, 0, 1]], ord: 1, eBytes: len([[5, 1, 0, 1]]) }),
    ],
    ["a string", (tl) => ({ ...tl, e: [[5, TL.PICKUP, "bomb"]], ord: 1, p: 1 })],
    ["an unknown code", (tl) => ({ ...tl, e: [[5, 7]], ord: 1, eBytes: len([[5, 7]]) })],
    [
      "a value out of range",
      (tl) => ({ ...tl, e: [[5, TL.PHASE, 9]], ord: 1, c: 1, eBytes: len([[5, 10, 9]]) }),
    ],
    ["a terminal entry", (tl) => ({ ...tl, e: [...tl.e, [99, TL.WAVE_CLEARED]], term: true })],
    ["counts that don't match its entries", (tl) => ({ ...tl, ord: tl.ord + 1 })],
    ["a byte count that doesn't match", (tl) => ({ ...tl, eBytes: tl.eBytes + 1 })],
    ["a bad ovf", (tl) => ({ ...tl, ovf: [0, 0] })],
    ["an extra key", (tl) => ({ ...tl, extra: 1 })],
    ["not an object", () => "buffer"],
  ])("%s: dropped for this wave, and the next wave opens a buffer", (_name, corrupt) => {
    const { restored } = restoreWithLive(corrupt(base()));
    expectDroppedForThisWave(restored);
  });

  it("a valid buffer whose wave stats restored fresh is dropped (its t would run backwards)", () => {
    const { mid, restored } = restoreWithLive(undefined, { waveStats: { broken: true } });
    void mid;
    expect(restored.waveStats.pacing.durationMs).toBe(0);
    expectDroppedForThisWave(restored);
  });

  it("a buffer whose last t is past the restored wave clock is dropped", () => {
    const mid = midRun();
    const ahead = tlPickup(mid.waveTimeline!, mid.waveStats.pacing.durationMs + 100, "bomb");
    const restored = restoreSavedState(saved(mid, { waveTimeline: ahead }));
    expectDroppedForThisWave(restored);
    // at the clock exactly, it is kept
    const atClock = tlPickup(mid.waveTimeline!, mid.waveStats.pacing.durationMs, "bomb");
    expect(restoreSavedState(saved(mid, { waveTimeline: atClock })).waveTimeline).toEqual(atClock);
  });

  it("a recording run saved between waves (no buffer) restores with none and counts the wave", () => {
    const { restored } = restoreWithLive(null);
    expectDroppedForThisWave(restored);
  });
});

describe("the closed timelines on restore (#3393)", () => {
  it("a closedWaves that falls back to [] clears the closed timelines with it", () => {
    const mid = midRun();
    const restored = restoreSavedState(saved(mid, { closedWaves: [{ not: "a wave" }] }));
    expect(restored.closedWaves).toEqual([]);
    expect(restored.closedTimelines).toEqual([]);
    expect(restored.closedTimelinesLens).toEqual([]);
    expect(restored.closedTimelinesBytes).toBe(0);
    // the overflow counts restore as saved, like closedWavesOverflow
    expect(restored.closedTimelinesOverflow).toEqual(mid.closedTimelinesOverflow);
    // the live buffer is the wave's own and still carries on
    expect(restored.waveTimeline).toEqual(mid.waveTimeline);
  });

  const kept = (): WaveTimelineWire => midRun().closedTimelines[0]!;
  const died = (wave: number): WaveTimelineWire => ({
    ...kept(),
    wave,
    outcome: "died",
    e: [[5, TL.RUN_LOST, 0]],
  });

  it.each<[string, () => unknown[]]>([
    ["an entry not in wire form", () => [{ ...kept(), extra: 1 }]],
    ["a wrong schema version", () => [{ ...kept(), v: 2 }]],
    ["no terminal entry", () => [{ ...kept(), e: kept().e.slice(0, -1) }]],
    ["the wrong terminal for its outcome", () => [{ ...kept(), outcome: "died" }]],
    ["an empty entry list", () => [{ ...kept(), e: [] }]],
    ["waves out of order", () => [{ ...kept(), wave: 2 }, kept()]],
    ["two died timelines of one wave", () => [died(1), died(1)]],
    [
      "more than 64 timelines",
      () => Array.from({ length: TIMELINE_RUN_MAX_WAVES + 1 }, (_, i) => died(i + 1)),
    ],
    [
      "more than 16 KB in all",
      () => {
        const one = len(died(1000));
        return Array.from({ length: Math.floor(TIMELINE_RUN_MAX_BYTES / one) + 1 }, (_, i) =>
          died(1000 + i)
        );
      },
    ],
    // the backend drops a wave past 65535 (MAX_WAVE); a restore never queues one
    ["a wave past 65535", () => [died(65536)]],
    ["an ev of 0", () => [{ ...died(1), ev: 0 }]],
  ])("%s: the list restores as [], and the closed waves are kept", (_name, list) => {
    const mid = midRun();
    const restored = restoreSavedState(saved(mid, { closedTimelines: list() }));
    expect(restored.closedWaves).toEqual(mid.closedWaves);
    expect(restored.closedTimelines).toEqual([]);
    expect(restored.closedTimelinesLens).toEqual([]);
    expect(restored.closedTimelinesBytes).toBe(0);
  });

  it("a list at the hard caps still restores", () => {
    const mid = midRun();
    const list = Array.from({ length: TIMELINE_RUN_MAX_WAVES }, (_, i) => died(i + 1));
    expect(list.reduce((n, tl) => n + len(tl), 0)).toBeLessThanOrEqual(TIMELINE_RUN_MAX_BYTES);
    const restored = restoreSavedState(saved(mid, { closedTimelines: list }));
    expect(restored.closedTimelines).toEqual(list);
    expectBytesExact(restored);
  });

  it.each([
    ["missing a count", { waves: 0, bytes: 0, clean: 0, devRepeats: 0, full: false }],
    ["a negative count", { ...NO_TIMELINE_OVERFLOW, waves: -1 }],
    ["a fractional count", { ...NO_TIMELINE_OVERFLOW, clean: 0.5 }],
    ["full not a boolean", { ...NO_TIMELINE_OVERFLOW, full: 1 }],
    ["an extra key", { ...NO_TIMELINE_OVERFLOW, other: 0 }],
    ["not an object", [0, 0, 0]],
  ])("a corrupt overflow object (%s) restores as zeros", (_name, overflow) => {
    const restored = restoreSavedState(saved(midRun(), { closedTimelinesOverflow: overflow }));
    expect(restored.closedTimelinesOverflow).toEqual(NO_TIMELINE_OVERFLOW);
  });

  it("an overflow that fits restores as saved", () => {
    const over = { waves: 2, bytes: 1500, clean: 3, devRepeats: 1, unrecorded: 4, full: true };
    const restored = restoreSavedState(saved(midRun(), { closedTimelinesOverflow: over }));
    expect(restored.closedTimelinesOverflow).toEqual(over);
  });
});
