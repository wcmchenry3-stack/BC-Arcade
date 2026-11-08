/**
 * #3632: divers launched in the same scheduler tick split up — own aim point, opposite sweeps on a
 * shared half, an optional stagger — and a lone diver flies exactly the dive it always did.
 */
import { initStarSwarm, tick, seedRng, _resetIds, CANVAS_W, CANVAS_H, diveCap } from "../engine";
import { evalCubic } from "../engine/geometry";
import { DIVE_SPREAD_PX, WIGGLE_DURATION } from "../engine/tuning";
import type { Enemy, StarSwarmState } from "../types";
import { NO_INPUT, advanceMs } from "./helpers/engineFixtures";

beforeEach(() => {
  seedRng(7);
  _resetIds();
});

/** A settled wave `wave` with no rocks, every ship on station, the dive timer about to fire. */
function readyWave(wave: number): StarSwarmState {
  let s = initStarSwarm(CANVAS_W, CANVAS_H);
  s = advanceMs(s, 8000);
  return {
    ...s,
    wave,
    asteroids: [],
    nextDiveTimer: 1,
    enemies: s.enemies.map((e) =>
      e.isAlive && e.phase !== "Formation"
        ? { ...e, phase: "Formation" as const, x: e.formationX, y: e.formationY, path: null }
        : e
    ),
  };
}

const wiggling = (s: StarSwarmState): Enemy[] =>
  s.enemies.filter((e) => e.isAlive && e.phase === "Wiggling");

/** Tick until every ship of the batch has a launched path (Diving), returning them by id. */
function launchBatch(s: StarSwarmState, ids: readonly number[]): Enemy[] {
  let cur = s;
  for (let i = 0; i < 200; i++) {
    const out = cur.enemies.filter((e) => ids.includes(e.id));
    if (out.every((e) => e.phase === "Diving")) return out;
    cur = tick(cur, 16, NO_INPUT);
  }
  throw new Error("batch never launched");
}

describe("dive batch split (#3632)", () => {
  it("fans the aim points of a batch DIVE_SPREAD_PX apart around the player", () => {
    const s = tick(readyWave(5), 16, NO_INPUT);
    const batch = wiggling(s);
    expect(batch.length).toBe(diveCap(5));
    const xs = batch.map((e) => e.diveTargetX).sort((a, b) => a - b);
    for (let i = 1; i < xs.length; i++) {
      expect(xs[i]! - xs[i - 1]!).toBeGreaterThanOrEqual(DIVE_SPREAD_PX - 1e-6);
    }
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(mean).toBeCloseTo(s.player.x, 3);
    // the fan keeps its order: nobody crosses
    const byFormation = [...batch].sort((a, b) => a.formationX - b.formationX);
    expect(byFormation.map((e) => e.diveTargetX)).toEqual(xs);
  });

  it("keeps the fan inside the canvas margin when the player hugs an edge", () => {
    const s0 = readyWave(5);
    const s = tick({ ...s0, player: { ...s0.player, x: 2 } }, 16, NO_INPUT);
    const xs = wiggling(s).map((e) => e.diveTargetX);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
    expect(new Set(xs.map((x) => Math.round(x))).size).toBe(xs.length);
  });

  it("keeps the batch's flown paths apart for most of the dive", () => {
    const s = tick(readyWave(5), 16, NO_INPUT);
    const ids = wiggling(s).map((e) => e.id);
    const dive = launchBatch(s, ids);
    expect(dive.length).toBeGreaterThanOrEqual(2);
    const ends = dive.map((e) => e.path!.p3.x).sort((a, b) => a - b);
    for (let i = 1; i < ends.length; i++) {
      expect(ends[i]! - ends[i - 1]!).toBeGreaterThanOrEqual(DIVE_SPREAD_PX - 1e-6);
    }
    let minSep = 1e9;
    for (let t = 0.3; t <= 1.0001; t += 0.05) {
      for (let i = 0; i < dive.length; i++) {
        for (let j = i + 1; j < dive.length; j++) {
          const a = evalCubic(dive[i]!.path!, t);
          const b = evalCubic(dive[j]!.path!, t);
          minSep = Math.min(minSep, Math.hypot(a.x - b.x, a.y - b.y));
        }
      }
    }
    // Opposite sweeps on a shared half make neighbouring arcs pass near each other early on, so
    // the floor is lower than the aim-point spacing; unsplit dives close to ~0 px at the end.
    expect(minSep).toBeGreaterThanOrEqual(12);
  });

  it("sends the second ship on a half out the opposite way", () => {
    const s = tick(readyWave(5), 16, NO_INPUT);
    const batch = [...wiggling(s)].sort((a, b) => a.formationX - b.formationX);
    for (const half of [
      (e: Enemy) => e.formationX < CANVAS_W / 2,
      (e: Enemy) => e.formationX >= CANVAS_W / 2,
    ]) {
      const same = batch.filter(half);
      same.forEach((e, k) => expect(!!e.diveFlip).toBe(k % 2 === 1));
    }
    const dive = launchBatch(
      s,
      batch.map((e) => e.id)
    );
    for (const half of [
      (e: Enemy) => e.formationX < CANVAS_W / 2,
      (e: Enemy) => e.formationX >= CANVAS_W / 2,
    ]) {
      const same = dive.filter(half).sort((a, b) => a.formationX - b.formationX);
      if (same.length >= 2) {
        const dir = (e: Enemy) => Math.sign(e.path!.p1.x - e.formationX);
        expect(dir(same[0]!)).toBe(-dir(same[1]!));
      }
    }
  });

  it("leaves a lone diver's aim, sweep and wait untouched", () => {
    const s0 = readyWave(1); // cap 1
    expect(diveCap(1)).toBe(1);
    const s = tick(s0, 16, NO_INPUT);
    const [e] = wiggling(s);
    expect(wiggling(s)).toHaveLength(1);
    expect(e!.diveTargetX).toBe(s.player.x);
    expect(e!.diveFlip).toBeUndefined();
    expect(e!.wiggleTimer).toBeGreaterThan(0);
    expect(e!.wiggleTimer).toBeLessThanOrEqual(WIGGLE_DURATION);
  });

  it("with no stagger the whole batch launches together", () => {
    const s = tick(readyWave(5), 16, NO_INPUT);
    const timers = wiggling(s).map((e) => e.wiggleTimer);
    expect(new Set(timers).size).toBe(1);
  });

  it("keeps the dive cap and cadence", () => {
    const s = tick(readyWave(5), 16, NO_INPUT);
    expect(wiggling(s).length).toBeLessThanOrEqual(diveCap(5));
    expect(s.nextDiveTimer).toBeGreaterThan(1000);
  });
});

describe("dive stagger (#3632)", () => {
  it("the k-th ship of a batch waits k x DIVE_STAGGER_MS longer", () => {
    jest.resetModules();
    jest.doMock("../engine/tuning", () => ({
      ...jest.requireActual("../engine/tuning"),
      DIVE_STAGGER_MS: 350,
    }));
    const eng = jest.requireActual<typeof import("../engine")>("../engine");
    eng.seedRng(7);
    eng._resetIds();
    let s = eng.initStarSwarm(CANVAS_W, CANVAS_H);
    for (let t = 0; t < 8000; t += 16) s = eng.tick(s, 16, NO_INPUT);
    s = {
      ...s,
      wave: 5,
      asteroids: [],
      nextDiveTimer: 1,
      enemies: s.enemies.map((e) =>
        e.isAlive && e.phase !== "Formation"
          ? { ...e, phase: "Formation" as const, x: e.formationX, y: e.formationY, path: null }
          : e
      ),
    };
    s = eng.tick(s, 16, NO_INPUT);
    const batch = wiggling(s).sort((a, b) => a.formationX - b.formationX);
    const base = batch[0]!.wiggleTimer;
    batch.forEach((e, k) => expect(e.wiggleTimer).toBeCloseTo(base + k * 350, 6));
    jest.dontMock("../engine/tuning");
    jest.resetModules();
  });
});
