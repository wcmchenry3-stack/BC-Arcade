/**
 * #3251: seeded multi-wave runs at a fractional dt, played to the death, checked against the save
 * validator. Every `closedWaves` entry real play produces must pass `fitsWire` (one entry restores
 * as itself) and the whole list must come back intact through a JSON round trip and
 * `restoreSavedState` — so when a counter story fills a field the validator is strict about
 * (`rout`, `damage`), a mismatch fails here instead of silently dropping a paused run's waves.
 * Each run forces a rout on its first waves (the leaders killed, the grunts left), so `rout` is
 * really filled.
 */
import { CANVAS_H, CANVAS_W, initStarSwarm, tick } from "../engine";
import { fitsSaveShape, restoreSavedState, type SavedStarSwarmState } from "../saveShape";
import type { StarSwarmState } from "../types";

/** A 60 Hz frame, as a device reports it: never a whole number of ms. */
const DT = 16.6667;
const SEEDS = [1, 42, 2024];
const ROUTED_WAVES = 4;

const killAll = (s: StarSwarmState, pick: (tier: string) => boolean): StarSwarmState => ({
  ...s,
  enemies: s.enemies.map((e) => (pick(e.tier) ? { ...e, isAlive: false, hp: 0 } : e)),
});

/** `n` frames of weaving, firing play (stops at GameOver). */
function play(s0: StarSwarmState, n: number): StarSwarmState {
  let s = s0;
  for (let t = 0; t < n && s.phase !== "GameOver"; t++) {
    const playerX = CANVAS_W / 2 + Math.sin((s.wave * 1000 + t) / 40) * 120;
    s = tick(s, DT, { fire: true, playerX });
  }
  return s;
}

/** A seeded run: a few waves each with a rout and a clear, then played on until it dies. */
function runToDeath(seed: number): StarSwarmState {
  let s = initStarSwarm(CANVAS_W, CANVAS_H, 1, seed, "Ensign");
  for (let w = 0; w < ROUTED_WAVES && s.phase !== "GameOver"; w++) {
    const wave = s.wave;
    s = play(s, 400);
    s = play(
      killAll(s, (tier) => tier !== "Grunt"),
      300
    ); // the rout
    for (let i = 0; i < 3000 && s.wave === wave && s.phase !== "GameOver"; i++) {
      s = tick(
        killAll(s, () => true),
        DT,
        { fire: false, playerX: CANVAS_W / 2 }
      );
    }
  }
  // on to the end: one life left, so the next hit ends it
  return play({ ...s, player: { ...s.player, lives: 1, hull: 0 } }, 20_000);
}

/** Every numeric leaf of `v`. */
function numbers(v: unknown): number[] {
  if (typeof v === "number") return [v];
  if (v === null || typeof v !== "object") return [];
  return Object.values(v).flatMap(numbers);
}

describe.each(SEEDS)("closedWaves from a seeded run to the death (seed %i)", (seed) => {
  const end = runToDeath(seed);

  it("ends on a died wave, with every wave before it collected in order", () => {
    expect(end.phase).toBe("GameOver");
    expect(end.closedWaves.map((w) => w.wave)).toEqual(
      Array.from({ length: end.wave }, (_, i) => i + 1)
    );
    expect(end.closedWaves.at(-1)!.outcome).toBe("died");
    // the probe really exercises rout
    expect(end.closedWaves.some((w) => w.rout.triggered && w.rout.atMs !== null)).toBe(true);
  });

  it("every entry passes the save validator on its own", () => {
    for (const w of end.closedWaves) {
      expect(restoreSavedState({ ...end, closedWaves: [w] }).closedWaves).toEqual([w]);
    }
  });

  it("every number on the wire is a non-negative integer (the backend's StrictInt)", () => {
    for (const n of numbers(end.closedWaves)) {
      expect(Number.isInteger(n) && n >= 0).toBe(true);
    }
  });

  it("the whole list survives a save's JSON round trip and restore intact", () => {
    const saved = JSON.parse(JSON.stringify(end)) as unknown;
    expect(fitsSaveShape(saved)).toBe(true);
    const restored = restoreSavedState(saved as SavedStarSwarmState);
    expect(restored.closedWaves).toEqual(end.closedWaves);
    expect(restored.closedWavesOverflow).toEqual(end.closedWavesOverflow);
    expect(restored.closedWavesBytes).toBe(end.closedWavesBytes);
  });
});
