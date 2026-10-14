/**
 * Star Swarm golden seeded replay (#2955).
 *
 * Seeds the engine (`seedRng` via `initStarSwarm(..., seed)`, `_resetIds`) and a stand-in for
 * the engine's two `Math.random` calls (they affect play: the known exception in
 * docs/ARCHITECTURE.md §3.2), then drives the public API (`initStarSwarm`,
 * `tick`, `applyPowerUp`, `throwAsteroid`, `killEscorts`) with a scripted pilot for a fixed
 * number of ticks. Every CHECKPOINT_EVERY ticks it records a short summary plus a SHA-256 of
 * the canonical `JSON.stringify(state)`, and at the end the module counters (`engineCounters()`);
 * the whole record must equal `__fixtures__/golden-replay-seed42.json`.
 *
 * Why the hash rounds: V8's `Math.sin/cos/exp/pow` may differ in the last bits between Node
 * versions (the raw-float hash of one scenario diverged on Node 24 vs 22 with every gameplay
 * field equal). Before hashing, every non-integer number is rounded to 6 decimal places and
 * object keys are sorted (`canonical`), so the hash tracks the game, not the runtime's float
 * noise or a refactor's key order. Integer and gameplay fields — score, lives, counts, phase,
 * wave, carrier stage, ids and the engine counters — are compared exactly in the summaries.
 *
 * Contract:
 * - The Star Swarm engine split (#2988) is a pure move: this fixture must stay byte-identical
 *   across it. A diff here means the split changed behaviour; fix the split, not the fixture.
 * - The one sanctioned re-record is the `rng()` range fix in #2985 (`_shared/seededRng`, divide
 *   by 2^32 instead of 0xffffffff), which changes every draw. Re-record in that PR and say so.
 * - Any other re-record is a deliberate gameplay/balance change and must be called out in the
 *   PR description.
 *
 * Per-wave stats (#3252): each scenario's closed waves (`state.closedWaves`, the `wave_completed`
 * wire form) and its end-of-replay leaderboard result (`final_score`, `wave_reached`,
 * `difficulty_tier`, `score_breakdown`, as the screen builds it at game over) are pinned in the
 * sibling `__fixtures__/golden-replay-seed42.waves.json`. They are observations, kept out of the
 * gameplay hash and out of the main fixture, so a counter change diffs that file only — and a
 * diff there must be an intentional fixture update called out in the PR. The result is also
 * checked against the main fixture's last checkpoint, which predates the per-wave stats (epic
 * #3244): the score, the wave and the gameplay hash are the same as before the epic.
 *
 * Re-record: `UPDATE_GOLDEN=1 npx jest src/game/starswarm/__tests__/goldenReplay.test.ts` (writes
 * both fixtures; the main one must come out unchanged unless play changed).
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
import { summarizeScoreLedger } from "../scoreLedger";
import type { DifficultyTier, StarSwarmState } from "../types";

const FIXTURE = path.join(__dirname, "__fixtures__", "golden-replay-seed42.json");
const WAVES_FIXTURE = path.join(__dirname, "__fixtures__", "golden-replay-seed42.waves.json");
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

/** Independent LCG for the engine's two Math.random calls (power-up type and spawn X). */
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

/** Decimal places kept for non-integer numbers in the hashed state (see the header). */
const HASH_DECIMALS = 1e6;

/**
 * Runtime-independent form of a value: object keys sorted, non-integer finite numbers rounded
 * to 6 decimal places (`-0` folded to `0`), integers and everything else unchanged.
 */
function canonical(v: unknown): unknown {
  if (typeof v === "number") {
    return Number.isFinite(v) && !Number.isInteger(v)
      ? Math.round(v * HASH_DECIMALS) / HASH_DECIMALS + 0
      : v;
  }
  if (Array.isArray(v)) return v.map(canonical);
  if (v !== null && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v).sort()) out[k] = canonical((v as Record<string, unknown>)[k]);
    return out;
  }
  return v;
}

function sha(state: StarSwarmState): string {
  // #3245: the per-wave stats are observations of play, not play state; they stay out of the
  // hash so the recorded gameplay stays comparable (#3252 records them in the fixture).
  // #3251: so does the run's list of closed waves.
  const {
    waveStats: _waveStats,
    lastClosedWave: _lastClosedWave,
    closedWaves: _closedWaves,
    closedWavesOverflow: _closedWavesOverflow,
    closedWavesBytes: _closedWavesBytes,
    ...rest
  } = state;
  // #3246: likewise a pickup's `source` — a label for the stats, never read by play
  const played = { ...rest, powerUps: rest.powerUps.map(({ source: _source, ...p }) => p) };
  return createHash("sha256")
    .update(JSON.stringify(canonical(played)))
    .digest("hex");
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
    return { recorded: { name: sc.name, checkpoints, counters: engineCounters() }, end: s };
  } finally {
    random.mockRestore();
  }
}

type Recorded = ReturnType<typeof replay>["recorded"];

/** #3252: the replay's per-wave stats and leaderboard result (see the header). */
function wavesOf(name: string, end: StarSwarmState) {
  return {
    name,
    result: {
      final_score: end.score,
      wave_reached: end.wave,
      difficulty_tier: end.difficulty,
      score_breakdown: summarizeScoreLedger(end.scoreLedger, end.score),
    },
    closedWaves: end.closedWaves,
  };
}

type RecordedWaves = ReturnType<typeof wavesOf>;

/** Each scenario replays once per run, however many cases read it. */
const replays = new Map<number, ReturnType<typeof replay>>();
function replayOnce(i: number): ReturnType<typeof replay> {
  let r = replays.get(i);
  if (!r) {
    r = replay(SCENARIOS[i]!);
    replays.set(i, r);
  }
  return r;
}

const UPDATE = process.env.UPDATE_GOLDEN === "1";

describe("Star Swarm golden seeded replay (seed 42)", () => {
  // Read in beforeAll and replay inside each case (not at collection time), so `-t` filtering
  // skips the replays and an engine exception fails that case instead of the whole suite.
  let golden: Recorded[] = [];
  let goldenWaves: RecordedWaves[] = [];
  const recorded = new Map<string, Recorded>();
  const recordedWaves = new Map<string, RecordedWaves>();

  beforeAll(() => {
    if (UPDATE) return;
    golden = JSON.parse(fs.readFileSync(FIXTURE, "utf8")) as Recorded[];
    goldenWaves = JSON.parse(fs.readFileSync(WAVES_FIXTURE, "utf8")) as RecordedWaves[];
  });

  afterAll(() => {
    // Re-record only from a full run, so a filtered run can never write a partial fixture.
    if (!UPDATE || recorded.size !== SCENARIOS.length) return;
    fs.mkdirSync(path.dirname(FIXTURE), { recursive: true });
    const all = SCENARIOS.map((sc) => recorded.get(sc.name));
    fs.writeFileSync(FIXTURE, JSON.stringify(all, null, 2) + "\n");
    if (recordedWaves.size !== SCENARIOS.length) return;
    const waves = SCENARIOS.map((sc) => recordedWaves.get(sc.name));
    fs.writeFileSync(WAVES_FIXTURE, JSON.stringify(waves, null, 2) + "\n");
  });

  it("covers the same scenarios as the fixture", () => {
    if (UPDATE) return;
    expect(SCENARIOS.map((sc) => sc.name)).toEqual(golden.map((g) => g.name));
    expect(SCENARIOS.map((sc) => sc.name)).toEqual(goldenWaves.map((g) => g.name));
  });

  it.each(SCENARIOS.map((sc, i) => [sc.name, i] as const))(
    "%s replays byte-identically",
    (name, i) => {
      const run = replayOnce(i).recorded;
      recorded.set(name, run);
      if (!UPDATE) expect(run).toEqual(golden[i]);
    }
  );

  it.each(SCENARIOS.map((sc, i) => [sc.name, i] as const))(
    "%s: per-wave stats and leaderboard result match the waves fixture (#3252)",
    (name, i) => {
      const waves = wavesOf(name, replayOnce(i).end);
      recordedWaves.set(name, waves);
      if (!UPDATE) expect(waves).toEqual(goldenWaves[i]);
    }
  );

  it.each(SCENARIOS.map((sc, i) => [sc.name, i] as const))(
    "%s: score, wave and gameplay hash are unchanged by the per-wave stats (#3252)",
    (name, i) => {
      if (UPDATE) return;
      const { recorded: run, end } = replayOnce(i);
      // the main fixture's last checkpoint predates epic #3244
      const before = golden[i]!.checkpoints.at(-1)!;
      const after = run.checkpoints.at(-1)!;
      expect(after.sha256).toBe(before.sha256);
      const { result, closedWaves } = wavesOf(name, end);
      expect([result.final_score, result.wave_reached]).toEqual([before.score, before.wave]);
      // the result block reconciles, and agrees wave by wave with the closed waves' scores
      const { score_breakdown: b } = result;
      expect(b.unattributed).toBeUndefined();
      const earlier = b.earlier?.total ?? 0;
      expect(earlier + b.waves.reduce((t, w) => t + w.total, 0)).toBe(result.final_score);
      for (const w of closedWaves) {
        expect(w.score.total).toBe(b.waves.find((x) => x.wave === w.wave)?.total ?? 0);
      }
    }
  );
});
