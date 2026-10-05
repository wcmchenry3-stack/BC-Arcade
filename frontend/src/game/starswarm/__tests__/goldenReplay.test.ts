/**
 * Star Swarm golden seeded replay (#2955).
 *
 * Seeds the engine (`seedRng` via `initStarSwarm(..., seed)`, `_resetIds`) and a stand-in for
 * the engine's two cosmetic `Math.random` calls, then drives the public API (`initStarSwarm`,
 * `tick`, `applyPowerUp`, `throwAsteroid`, `killEscorts`) with a scripted pilot for a fixed
 * number of ticks. Every CHECKPOINT_EVERY ticks it records a short summary plus a SHA-256 of
 * `JSON.stringify(state)`, and at the end the module counters (`engineCounters()`); the whole
 * record must equal `__fixtures__/golden-replay-seed42.json`.
 *
 * Contract:
 * - The Star Swarm engine split (#2988) is a pure move: this fixture must stay byte-identical
 *   across it. A diff here means the split changed behaviour; fix the split, not the fixture.
 * - The one sanctioned re-record is the `rng()` range fix in #2985 (`_shared/seededRng`, divide
 *   by 2^32 instead of 0xffffffff), which changes every draw. Re-record in that PR and say so.
 * - Any other re-record is a deliberate gameplay/balance change and must be called out in the
 *   PR description.
 *
 * Re-record: `UPDATE_GOLDEN=1 npx jest src/game/starswarm/__tests__/goldenReplay.test.ts`.
 */
import { createHash } from "crypto";
import * as fs from "fs";
import * as path from "path";
import {
  CANVAS_H,
  CANVAS_W,
  _resetIds,
  applyPowerUp,
  engineCounters,
  initStarSwarm,
  killEscorts,
  throwAsteroid,
  tick,
} from "../engine";
import type { DifficultyTier, StarSwarmState } from "../types";

const FIXTURE = path.join(__dirname, "__fixtures__", "golden-replay-seed42.json");
const CHECKPOINT_EVERY = 100;

interface Scenario {
  name: string;
  wave: number;
  difficulty: DifficultyTier;
  ticks: number;
  /** Out-of-tick actions GameCanvas can apply between frames, keyed by tick index. */
  actions?: Record<number, (s: StarSwarmState) => StarSwarmState>;
}

const SCENARIOS: Scenario[] = [
  { name: "wave1-lieutenantJG", wave: 1, difficulty: "LieutenantJG", ticks: 4000 },
  {
    name: "wave3-lieutenant-actions",
    wave: 3,
    difficulty: "Lieutenant",
    ticks: 3000,
    actions: {
      400: (s) => applyPowerUp(s, "buddy"),
      450: (s) => throwAsteroid(s),
      600: (s) => applyPowerUp(s, "salvage"),
      650: (s) => applyPowerUp(s, "hull"),
      800: (s) => applyPowerUp(s, "shield"),
      1000: (s) => throwAsteroid(s),
      1300: (s) => applyPowerUp(s, "lightning"),
      1600: (s) => applyPowerUp(s, "bomb"),
    },
  },
  {
    name: "wave5-boss-carrier",
    wave: 5,
    difficulty: "Commander",
    ticks: 3000,
    actions: { 900: (s) => killEscorts(s) },
  },
];

/**
 * Lives the scripted pilot starts with. It does not dodge, so with the usual 3 it is dead
 * within a wave; a deep reserve lets one replay reach wave clears, extraction and boss waves.
 */
const PILOT_LIVES = 30;

/** Independent LCG for the engine's cosmetic Math.random calls (power-up type and spawn X). */
function stubMathRandom(seed: number): jest.SpyInstance {
  let s = seed >>> 0;
  return jest.spyOn(Math, "random").mockImplementation(() => {
    s = (Math.imul(1103515245, s) + 12345) >>> 0;
    return s / 4294967296;
  });
}

/** Scripted pilot: a triangle-wave sweep across the canvas, firing except for short lulls. */
function pilot(t: number): { playerX: number; fire: boolean } {
  const period = 240;
  const phase = t % period;
  const frac = phase < period / 2 ? phase / (period / 2) : 2 - phase / (period / 2);
  return { playerX: 20 + frac * (CANVAS_W - 40), fire: t % 300 < 270 };
}

/** Frame length: mostly 60 fps, with a dropped frame every 7th tick. */
function dtFor(t: number): number {
  return t % 7 === 6 ? 33 : 16;
}

function sha(state: StarSwarmState): string {
  return createHash("sha256").update(JSON.stringify(state)).digest("hex");
}

function summary(t: number, s: StarSwarmState) {
  return {
    tick: t,
    phase: s.phase,
    wave: s.wave,
    score: s.score,
    lives: s.player.lives,
    enemies: s.enemies.length,
    asteroids: s.asteroids.length,
    buddies: s.buddyShips.length,
    powerUps: s.powerUps.length,
    carrierStage: s.carrierStage,
    sha256: sha(s),
  };
}

function replay(sc: Scenario) {
  _resetIds();
  const random = stubMathRandom(1234);
  try {
    const init = initStarSwarm(CANVAS_W, CANVAS_H, sc.wave, 42, sc.difficulty);
    let s: StarSwarmState = { ...init, player: { ...init.player, lives: PILOT_LIVES } };
    const checkpoints = [summary(0, s)];
    for (let t = 1; t <= sc.ticks; t++) {
      const action = sc.actions?.[t];
      if (action) s = action(s);
      s = tick(s, dtFor(t), pilot(t));
      if (t % CHECKPOINT_EVERY === 0 || t === sc.ticks) checkpoints.push(summary(t, s));
    }
    return { name: sc.name, checkpoints, counters: engineCounters() };
  } finally {
    random.mockRestore();
  }
}

describe("Star Swarm golden seeded replay (seed 42)", () => {
  const recorded = SCENARIOS.map(replay);

  if (process.env.UPDATE_GOLDEN === "1") {
    fs.mkdirSync(path.dirname(FIXTURE), { recursive: true });
    fs.writeFileSync(FIXTURE, JSON.stringify(recorded, null, 2) + "\n");
  }

  const golden = JSON.parse(fs.readFileSync(FIXTURE, "utf8")) as typeof recorded;

  it("covers the same scenarios as the fixture", () => {
    expect(recorded.map((r) => r.name)).toEqual(golden.map((g) => g.name));
  });

  it.each(SCENARIOS.map((sc, i) => [sc.name, i] as const))(
    "%s replays byte-identically",
    (_name, i) => {
      expect(recorded[i]).toEqual(golden[i]);
    }
  );
});
