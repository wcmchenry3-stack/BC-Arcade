/**
 * Cascade sim harness tests (#2893). The smoke suite at the bottom is the PR gate: it runs in
 * the ordinary jest run in about 8 s (budget 30 s) and compares with baseline.json "smoke".
 * The long run (100 seeds) is `cascade-sim-gate.yml`.
 */
import { CascadeEngine, type EngineEvent, type GameState, type StepResult } from "../../engine";
import { advanceQueue, createPieceQueue } from "../../pieceQueue";
import { DROUGHT_WINDOW } from "../../spawnSelector";
import { BOTS, heuristicBot, randomBot, spamBot } from "../bots";
import { contactPair } from "../contactSpawn";
import { DEFAULT_CONSTANTS, streamRng, type SimConstants, type SimEngine } from "../config";
import { packingDensity, touchingGaps } from "../physicsFeel";
import { sampleQueue } from "../queueSampler";
import { runGame, type GameMetrics } from "../runGame";
import {
  CHAIN_LATENCY_BOUND_MS,
  COST_BUDGET_MS,
  FULL_PARAMS,
  ROBUST_KEYS,
  SMOKE_PARAMS,
  SPAM_GAME_OVER_BOUND_MS,
  checkSuite,
  formatTable,
  makeBaselineSuite,
  runSuite,
  tolerance,
  type Baseline,
  type SuiteResult,
} from "../suite";
import { CAPSTONE_TIER, DROPPABLE_TIERS, TIERS } from "../../tiers";
import baselineJson from "../baseline.json";

const baseline = baselineJson as unknown as Baseline;

/** Drop the wall-clock part so two runs can be compared exactly. */
function deterministic(m: GameMetrics): Omit<GameMetrics, "cost"> {
  const { cost: _cost, ...rest } = m;
  return rest;
}

const emptyState = (): GameState => ({
  pieces: [],
  score: 0,
  gameOver: false,
  dangerRatio: 0,
  canDrop: true,
});

const snap = (id: number, tier: number, x: number, y: number) => ({
  id,
  tier,
  x,
  y,
  vx: 0,
  vy: 0,
  angle: 0,
  shapeKind: "circle" as const,
  isSleeping: true,
  scale: 1,
});

/** A scripted engine: lets a test feed events and see exactly what the sim calls. */
function fakeEngine(script: (frame: number) => EngineEvent[]): SimEngine & {
  calls: string[];
  frames: number;
} {
  const calls: string[] = [];
  const self = {
    calls,
    frames: 0,
    step(): StepResult {
      self.frames++;
      return { events: script(self.frames) };
    },
    drop() {
      calls.push("drop");
    },
    canDrop: () => true,
    getState: (): GameState => ({
      pieces: [],
      score: 0,
      gameOver: false,
      dangerRatio: 0,
      canDrop: true,
    }),
    restore() {
      calls.push("restore");
    },
    destroy() {
      calls.push("destroy");
    },
  };
  return self;
}

describe("determinism and the engine seam", () => {
  it("replays the same game from the same seed, at 60 and at 120 Hz", () => {
    for (const hz of [60, 120] as const) {
      const a = runGame({ seed: 7, hz, bot: heuristicBot, maxSimMs: 30_000 });
      const b = runGame({ seed: 7, hz, bot: heuristicBot, maxSimMs: 30_000 });
      expect(deterministic(a)).toEqual(deterministic(b));
      expect(a.drops).toBeGreaterThan(10);
    }
  });

  it("different seeds give different games", () => {
    const a = runGame({ seed: 1, hz: 60, bot: randomBot, maxSimMs: 20_000 });
    const b = runGame({ seed: 2, hz: 60, bot: randomBot, maxSimMs: 20_000 });
    expect(a.dropsByTier).not.toEqual(b.dropsByTier);
  });

  it("runs at 60 and 120 Hz over the same simulated time", () => {
    for (const hz of [60, 120] as const) {
      const m = runGame({ seed: 3, hz, bot: randomBot, maxSimMs: 10_000 });
      expect(m.hz).toBe(hz);
      expect(m.simMs).toBeGreaterThanOrEqual(10_000);
      expect(m.simMs).toBeLessThan(10_000 + 1000 / hz + 1);
    }
  });

  it("uses the real queue and selector: the drops are the queue's sequence for the seed", () => {
    // A fake engine with an empty board keeps isInDanger false, so the sequence is the queue's.
    const m = runGame({
      seed: 5,
      hz: 60,
      bot: spamBot,
      maxSimMs: 6000,
      config: { createEngine: () => fakeEngine(() => []) },
    });
    const rng = streamRng(5, "queue");
    let q = createPieceQueue([], rng);
    let history = [q.current, q.next];
    const expected = new Array<number>(m.dropsByTier.length).fill(0);
    for (let i = 0; i < m.drops; i++) {
      expected[q.current]!++;
      q = advanceQueue(q, history, false, rng);
      history = [...history, q.next].slice(-DROUGHT_WINDOW);
    }
    expect(m.drops).toBeGreaterThan(15);
    expect(m.dropsByTier).toEqual(expected);
  });

  it("calls the injected engine factory and measures that engine", () => {
    const engine = fakeEngine(() => []);
    const create = jest.fn(() => engine);
    const m = runGame({
      seed: 1,
      hz: 60,
      bot: spamBot,
      maxSimMs: 2000,
      config: { createEngine: create },
    });
    expect(create).toHaveBeenCalledTimes(1);
    expect(engine.calls).toContain("drop");
    expect(engine.calls[engine.calls.length - 1]).toBe("destroy");
    expect(m.endedBy).toBe("cap");
  });

  it("a candidate engine's game over ends the run with its reason", () => {
    const engine = fakeEngine((f) => (f === 30 ? [{ type: "gameOver", reason: "hardStop" }] : []));
    const m = runGame({ seed: 1, hz: 60, bot: spamBot, config: { createEngine: () => engine } });
    expect(m.endedBy).toBe("hardStop");
    expect(m.simMs).toBeCloseTo(30 * (1000 / 60), 3);
  });

  it("constants overrides reach the metrics: a drawn radius 2 px bigger shows 4 px less gap", () => {
    const base = runGame({ seed: 2, hz: 60, bot: randomBot, maxSimMs: 20_000 });
    const constants: Partial<SimConstants> = {
      drawnRadius: (t) => DEFAULT_CONSTANTS.drawnRadius(t) + 2,
    };
    const cand = runGame({
      seed: 2,
      hz: 60,
      bot: randomBot,
      maxSimMs: 20_000,
      config: { constants },
    });
    expect(base.feel.gapMeanPx).not.toBeNull();
    // Same physics, same game; only the drawn radius moved.
    expect(cand.score).toBe(base.score);
    expect(cand.feel.gapMeanPx!).toBeCloseTo(base.feel.gapMeanPx! - 4, 6);
  });

  it("the win event plugs in (#3699): an engine event of type win sets won and the time", () => {
    const win: EngineEvent = { type: "win", x: 200, y: 500, id: 1 };
    const engine = fakeEngine((f) => (f === 60 ? [win] : []));
    const m = runGame({
      seed: 1,
      hz: 60,
      bot: spamBot,
      maxSimMs: 3000,
      config: { createEngine: () => engine },
    });
    expect(m.won).toBe(true);
    expect(m.timeToWinMs!).toBeCloseTo(1000, 0);
  });

  it("a short game does not reach the capstone: win reads false / n/a", () => {
    const m = runGame({ seed: 1, hz: 60, bot: randomBot, maxSimMs: 5000 });
    expect(m.won).toBe(false);
    expect(m.timeToWinMs).toBeNull();
  });

  it("a stopOnWin run ends at the engine's win, and records when each tier first existed", () => {
    const win: EngineEvent = { type: "win", x: 200, y: 500, id: 1 };
    const engine = fakeEngine((f) => (f === 90 ? [win] : []));
    const m = runGame({
      seed: 1,
      hz: 60,
      bot: spamBot,
      maxSimMs: 10_000,
      stopOnWin: true,
      config: { createEngine: () => engine },
    });
    expect(m.endedBy).toBe("win");
    expect(m.simMs).toBeCloseTo(1500, 0);
    const first = m.tierFirstMs.findIndex((ms) => ms === 0);
    expect(first).toBeGreaterThanOrEqual(0);
  });

  it("times a chain merge from the merge events' piece ids (#3697)", () => {
    // Two cherries touching on the floor and a tier 1 resting in the valley on top of them: their
    // product (a 1, made at their midpoint) touches it at full size, though it starts smaller.
    const r0 = DEFAULT_CONSTANTS.physicsRadius(0);
    const r1 = DEFAULT_CONSTANTS.physicsRadius(1);
    const floor = DEFAULT_CONSTANTS.worldHeight - DEFAULT_CONSTANTS.floorThickness;
    const half = r0 - 0.5;
    const valleyY = floor - r0 - Math.sqrt((r0 + r1) ** 2 - half ** 2) - 0.5;
    const engine = new CascadeEngine({});
    engine.restore(
      [
        { tier: 0, x: 200 - half, y: floor - r0 },
        { tier: 0, x: 200 + half, y: floor - r0 },
        { tier: 1, x: 200, y: valleyY },
      ],
      0
    );
    const m = runGame({
      seed: 1,
      hz: 60,
      bot: { name: "idle", nextDelayMs: () => 1e9, shouldTap: () => false, chooseX: () => 0 },
      maxSimMs: 2000,
      config: { createEngine: () => engine },
    });
    expect(m.merges).toBe(2);
    expect(m.feel.chainLatencyMs).toHaveLength(1);
    expect(m.feel.chainLatencyMs[0]!).toBeLessThan(150);
    expect(m.feel.chainMisses).toBe(0);
  });

  it("measures wall penetration from the snapshots, at each piece's current size", () => {
    const pieces = [{ ...snap(1, 0, DEFAULT_CONSTANTS.wallThickness + 2, 300), scale: 0.5 }];
    const engine = { ...fakeEngine(() => []), getState: () => ({ ...emptyState(), pieces }) };
    const m = runGame({
      seed: 1,
      hz: 60,
      bot: spamBot,
      maxSimMs: 100,
      config: { createEngine: () => engine },
    });
    // Half of a tier-0 radius is 9 px; its centre 2 px from the wall: 7 px in.
    expect(m.feel.wallDepthMaxPx).toBeCloseTo(DEFAULT_CONSTANTS.physicsRadius(0) / 2 - 2, 9);
    expect(m.feel.wallPenetrationPerMin).toBeGreaterThan(0);
  });

  it("counts guard-rail events and never deletes or moves bodies itself", () => {
    const rail: EngineEvent = { type: "guardRailFired", reason: "outOfBounds", bodyId: 1 };
    const engine = fakeEngine(() => [rail, rail]);
    const m = runGame({
      seed: 1,
      hz: 60,
      bot: spamBot,
      maxSimMs: 1000,
      config: { createEngine: () => engine },
    });
    expect(m.feel.guardRailEvents).toBe(engine.frames * 2);
    expect(m.feel.guardRailPerMin).toBeGreaterThan(0);
    // The only engine calls are drop and destroy: no restore, no removal.
    expect(new Set(engine.calls)).toEqual(new Set(["drop", "destroy"]));
  });

  it("scores by tier add up to the engine's score, and merges match the drop/piece count", () => {
    const m = runGame({ seed: 4, hz: 120, bot: heuristicBot, maxSimMs: 40_000 });
    expect(m.scoreByTier.reduce((a, b) => a + b, 0)).toBe(m.score);
    expect(m.mergesByTier.reduce((a, b) => a + b, 0)).toBe(m.merges);
    expect(m.merges).toBeGreaterThan(0);
    expect(m.topTier).toBeGreaterThan(1);
  });

  it("measures every physics-feel metric on a real game", () => {
    const m = runGame({ seed: 1, hz: 60, bot: heuristicBot, maxSimMs: 60_000 });
    expect(m.feel.packingDensity!).toBeGreaterThan(0.3);
    expect(m.feel.packingDensity!).toBeLessThan(1);
    expect(m.feel.touchingPairSamples).toBeGreaterThan(0);
    expect(m.feel.gapMeanPx).not.toBeNull();
    expect(m.feel.dropEpisodes).toBeGreaterThan(0);
    expect(m.feel.settleAfterDropMs!).toBeGreaterThan(0);
    expect(m.feel.jitterPxPerS).not.toBeNull();
    expect(m.feel.guardRailEvents).toBeGreaterThanOrEqual(0);
    expect(m.cost.meanStepMs).toBeGreaterThan(0);
  });
});

describe("1 px-contact spawn helper (#1302)", () => {
  it.each([60, 120])("a pair spawned 1 px overlapped merges at %i Hz", (hz) => {
    // Every mergeable tier, including the large ones whose polygon facets shave the overlap.
    for (let tier = 0; tier < CAPSTONE_TIER; tier++) {
      const engine = new CascadeEngine({});
      const [a, b] = contactPair(tier, 200);
      const r = DEFAULT_CONSTANTS.physicsRadius(tier);
      expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThanOrEqual(2 * r - 1);
      engine.restore([a, b], 0);
      let merged: EngineEvent | undefined;
      for (let i = 0; i < 20 && !merged; i++) {
        merged = engine.step(1000 / hz).events.find((e) => e.type === "merge");
      }
      expect(merged).toMatchObject({ type: "merge", result: tier + 1 });
      expect(engine.getState().pieces).toHaveLength(1);
      engine.destroy();
    }
  });
});

describe("the 12-tier ladder (#3695)", () => {
  it("takes every per-tier number from the ladder", () => {
    expect(DEFAULT_CONSTANTS.maxTier).toBe(CAPSTONE_TIER);
    expect(DEFAULT_CONSTANTS.droppableTiers).toBe(DROPPABLE_TIERS);
    for (const t of TIERS) {
      expect(DEFAULT_CONSTANTS.physicsRadius(t.tier)).toBe(t.radius);
      expect(DEFAULT_CONSTANTS.drawnRadius(t.tier)).toBe(t.radius);
      expect(DEFAULT_CONSTANTS.scoreValue(t.tier)).toBe(t.score);
    }
  });

  it("a 10 + 10 contact pair makes the capstone, and two capstones never merge", () => {
    const engine = new CascadeEngine({});
    engine.restore(contactPair(CAPSTONE_TIER - 1, 200), 0);
    let merged: EngineEvent | undefined;
    for (let i = 0; i < 20 && !merged; i++) {
      merged = engine.step(1000 / 60).events.find((e) => e.type === "merge");
    }
    expect(merged).toMatchObject({ type: "merge", result: CAPSTONE_TIER });
    engine.destroy();

    const caps = new CascadeEngine({});
    caps.restore(contactPair(CAPSTONE_TIER, 200), 0);
    const events: EngineEvent[] = [];
    for (let i = 0; i < 30; i++) events.push(...caps.step(1000 / 60).events);
    expect(events.some((e) => e.type === "merge")).toBe(false);
    caps.destroy();
  });
});

describe("pure physics-feel measures", () => {
  const piece = (id: number, tier: number, x: number, y: number) => ({
    id,
    tier,
    x,
    y,
    vx: 0,
    vy: 0,
    angle: 0,
    shapeKind: "circle" as const,
    isSleeping: true,
  });
  const c = DEFAULT_CONSTANTS;

  it("packing density is piece area over the bin area under the pile top", () => {
    const r = c.drawnRadius(0);
    const floorTop = c.worldHeight - c.floorThickness;
    const p = piece(1, 0, 100, floorTop - r);
    const expected = (Math.PI * r * r) / ((c.worldWidth - 2 * c.wallThickness) * 2 * r);
    expect(packingDensity([p], c)).toBeCloseTo(expected, 9);
    expect(packingDensity([], c)).toBeNull();
  });

  it("visible gap uses the drawn radius; only physically touching pairs count", () => {
    const r = c.physicsRadius(1);
    const touching = [piece(1, 1, 100, 300), piece(2, 1, 100 + 2 * r + 1, 300)];
    expect(touchingGaps(touching, c)).toEqual([expect.closeTo(1, 9)]);
    const bigDrawn = { ...c, drawnRadius: (t: number) => c.physicsRadius(t) + 1 };
    expect(touchingGaps(touching, bigDrawn)).toEqual([expect.closeTo(-1, 9)]);
    const apart = [piece(1, 1, 100, 300), piece(2, 1, 100 + 2 * r + 20, 300)];
    expect(touchingGaps(apart, c)).toEqual([]);
  });
});

describe("bots", () => {
  it("the heuristic bot merges more than the random bot on the same seeds", () => {
    const seeds = [1, 2, 3];
    const score = (bot: typeof heuristicBot) =>
      seeds.reduce((s, seed) => s + runGame({ seed, hz: 60, bot, maxSimMs: 60_000 }).score, 0);
    expect(score(heuristicBot)).toBeGreaterThan(score(randomBot));
  });

  it("registers heuristic, random, spam and (#3697) skilled", () => {
    expect(Object.keys(BOTS).sort()).toEqual(["heuristic", "random", "skilled", "spam"]);
  });

  it("the skilled bot drops inside the walls and merges", () => {
    const m = runGame({ seed: 2, hz: 60, bot: BOTS.skilled!, maxSimMs: 30_000 });
    expect(m.drops).toBeGreaterThan(15);
    expect(m.merges / m.drops).toBeGreaterThan(0.5);
    expect(m.feel.guardRailEvents).toBe(0);
  });
});

describe("queue sampler", () => {
  it("is deterministic and its shares sum to 1", () => {
    const a = sampleQueue(5, 300, false);
    expect(sampleQueue(5, 300, false)).toEqual(a);
    expect(a.share.reduce((x, y) => x + y, 0)).toBeCloseTo(1, 9);
    // #3697: tiers 0-5 drop; nothing above.
    expect(a.share.slice(6).every((s) => s === 0)).toBe(true);
    expect(a.share[5]!).toBeGreaterThan(0);
  });

  it("danger mode suppresses the large tiers and (#3697) favours the small ones", () => {
    const calm = sampleQueue(10, 500, false);
    const danger = sampleQueue(10, 500, true);
    for (const t of [3, 4, 5]) expect(danger.share[t]!).toBeLessThan(calm.share[t]!);
    for (const t of [0, 1, 2]) expect(danger.share[t]!).toBeGreaterThan(calm.share[t]!);
  });
});

describe("tolerance", () => {
  it("keeps fractions, droughts and guard rails in their own units", () => {
    expect(tolerance("dropShare.t0", 0.3)).toBeCloseTo(0.06, 9);
    expect(tolerance("drought.max.t4", 40)).toBe(10);
    expect(tolerance("feel.guardRailPerMin", 2000)).toBe(600);
  });

  it("never bands a rate tighter than one game of n", () => {
    expect(tolerance("endedBy.capRate", 0, 10)).toBeCloseTo(0.1, 9);
    expect(tolerance("reachedRate.t7", 0, 100)).toBeCloseTo(0.05, 9);
  });
});

describe("settle bands (survivor bias)", () => {
  const flat = (settleTotal: number, chainTotal: number) => ({
    games: 100,
    "simS.mean": 100,
    "feel.settleAfterDropMs": 500,
    "feel.settleAfterChainMs": 300,
    "feel.settleCensoredFraction": 0.5,
    "feel.settleEpisodes.total": settleTotal,
    "feel.chainEpisodes.total": chainTotal,
  });
  const fullParams = { ...SMOKE_PARAMS, coarse: false };
  const bandsFor = (key: string, f: ReturnType<typeof flat>) =>
    makeBaselineSuite({
      params: fullParams,
      runs: { [key]: f },
      cost: {},
      queue: {},
    }).runs[key]!;

  it("bands settle for a bot with 20+ finished episodes and not for the spam bot", () => {
    const heuristic = bandsFor("heuristic@60", flat(400, 50));
    expect(heuristic["feel.settleAfterDropMs"]!.min).not.toBeNull();
    expect(heuristic["feel.settleAfterChainMs"]!.min).not.toBeNull();
    const spam = bandsFor("spam@60", flat(400, 50));
    expect(spam["feel.settleAfterDropMs"]).toMatchObject({ value: 500, min: null, max: null });
    expect(spam["feel.settleAfterChainMs"]!.min).toBeNull();
  });

  it("leaves settle unbanded when fewer than 20 episodes finished; the cut-off fraction is never banded", () => {
    const few = bandsFor("random@60", flat(19, 19));
    expect(few["feel.settleAfterDropMs"]!.min).toBeNull();
    expect(few["feel.settleAfterChainMs"]!.min).toBeNull();
    expect(few["feel.settleCensoredFraction"]!.min).toBeNull();
  });

  it("reports the cut-off fraction: spam cuts off nearly every episode", () => {
    const r = runSuite({ ...SMOKE_PARAMS, bots: ["spam"], hzs: [60], seeds: 2, queueSeeds: 1 });
    expect(r.runs["spam@60"]!["feel.settleCensoredFraction"]!).toBeGreaterThan(0.9);
  });
});

describe("coarse smoke baseline", () => {
  it("bands only the robust keys, with no queue bands", () => {
    const smoke = baseline.suites["smoke"]!;
    expect(smoke.params.coarse).toBe(true);
    expect(Object.keys(smoke.queue)).toEqual([]);
    for (const bands of Object.values(smoke.runs)) {
      expect(Object.keys(bands).sort()).toEqual([...ROBUST_KEYS].sort());
    }
  });

  it.each([10])("passes with the seed set shifted by %i (CLI: +3, +50, +200 too)", (offset) => {
    const shifted = runSuite({ ...SMOKE_PARAMS, seedOffset: offset });
    expect(checkSuite(shifted, baseline.suites["smoke"])).toEqual([]);
  });
});

describe("smoke suite against baseline.json (PR gate)", () => {
  let result: SuiteResult;
  beforeAll(() => {
    result = runSuite(SMOKE_PARAMS);
  });

  it("stays inside every banded metric, the lid bound and the step budget", () => {
    expect(checkSuite(result, baseline.suites["smoke"])).toEqual([]);
  });

  it("the spam bot reaches game over inside the bound at 60 and 120 Hz (lid, #3694)", () => {
    for (const hz of [60, 120]) {
      const run = result.runs[`spam@${hz}`]!;
      expect(run["endedBy.capRate"]).toBe(0);
      expect(run["simS.max"]! * 1000).toBeLessThanOrEqual(SPAM_GAME_OVER_BOUND_MS);
    }
  });

  it("step cost with 20+ pieces is inside the 16 ms budget (measured, not baselined)", () => {
    for (const c of Object.values(result.cost)) {
      expect(c.meanStepMsGe20 ?? 0).toBeLessThan(COST_BUDGET_MS);
    }
    expect(JSON.stringify(baseline)).not.toMatch(/meanStepMs|P95StepMs|p95StepMs/);
  });

  it("flags a band violation, a lid failure and a blown step budget", () => {
    const bad: SuiteResult = JSON.parse(JSON.stringify(result));
    bad.runs["heuristic@60"]!["score.mean"] = 1;
    bad.runs["spam@60"]!["endedBy.capRate"] = 1;
    bad.cost["random@60"] = { meanStepMs: 30, meanStepMsGe20: 30, worstGameP95StepMs: 40 };
    const keys = checkSuite(bad, baseline.suites["smoke"]).map((v) => `${v.where}:${v.key}`);
    expect(keys).toEqual(expect.arrayContaining(["heuristic@60:score.mean", "spam@60:lid"]));
    expect(keys).toContain("random@60:stepCost");
  });

  it("flags a guard rail and a slow chain merge as hard gates (#3697)", () => {
    const bad: SuiteResult = JSON.parse(JSON.stringify(result));
    bad.runs["random@120"]!["feel.guardRailEvents.mean"] = 0.01;
    bad.runs["heuristic@120"]!["feel.chainLatencyMs.p90"] = CHAIN_LATENCY_BOUND_MS;
    const keys = checkSuite(bad, undefined).map((v) => `${v.where}:${v.key}`);
    expect(keys.sort()).toEqual(["heuristic@120:chainLatency", "random@120:guardRail"]);
  });

  it("no guard rail fires, nothing goes into a wall, and chains merge in under 150 ms", () => {
    for (const run of Object.values(result.runs)) {
      expect(run["feel.guardRailEvents.mean"]).toBe(0);
      expect(run["feel.wallDepthMaxPx"]!).toBeLessThan(1);
      const p90 = run["feel.chainLatencyMs.p90"];
      if (p90 !== null && p90 !== undefined) expect(p90).toBeLessThan(CHAIN_LATENCY_BOUND_MS);
    }
  });

  it("a run missing from the result is a violation", () => {
    const partial: SuiteResult = { ...result, runs: {} };
    expect(checkSuite(partial, baseline.suites["smoke"]).length).toBeGreaterThan(0);
  });

  it("no smoke game (60 s) reaches the capstone: win metrics read 0 / n/a", () => {
    for (const run of Object.values(result.runs)) {
      expect(run["win.rate"]).toBe(0);
      expect(run["win.timeToWinS.mean"]).toBeNull();
    }
  });

  it("round-trips: a baseline made from the result passes its own check", () => {
    const own = makeBaselineSuite(result);
    expect(checkSuite(result, own)).toEqual([]);
  });

  it("prints a table with every bot at both frame rates", () => {
    const table = formatTable(result);
    for (const k of ["heuristic@60", "heuristic@120", "spam@120", "random@60"]) {
      expect(table).toContain(k);
    }
    expect(table).toContain("packing density");
    expect(table).toContain("settle after 3+ chain ms");
  });
});

describe("baseline.json", () => {
  it("has the full (100 seeds) and smoke suites for both frame rates", () => {
    expect(baseline.suites["full"]!.params.seeds).toBe(100);
    const both = ["heuristic", "random", "spam"].flatMap((b) => [`${b}@120`, `${b}@60`]);
    expect(Object.keys(baseline.suites["smoke"]!.runs).sort()).toEqual(both.sort());
    // #3697: the full suite also has the capstone runs (never in the smoke).
    expect(Object.keys(baseline.suites["full"]!.runs).sort()).toEqual(
      [...both, "capstone:skilled@60"].sort()
    );
    expect(baseline.suites["full"]!.params.capstone).toEqual(FULL_PARAMS.capstone);
    expect(baseline.suites["smoke"]!.params.capstone).toBeUndefined();
  });

  it("bands the capstone runs' win rate and time to the capstone (#3697)", () => {
    for (const bot of ["skilled"]) {
      const bands = baseline.suites["full"]!.runs[`capstone:${bot}@60`]!;
      expect(bands["win.rate"]!.value!).toBeGreaterThan(0);
      expect(bands["win.rate"]!.min).not.toBeNull();
      expect(bands["win.timeToWinS.median"]!.min).not.toBeNull();
    }
  });
});
