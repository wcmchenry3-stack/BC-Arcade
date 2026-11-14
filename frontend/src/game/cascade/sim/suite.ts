/**
 * Cascade sim suite (#2893): run many seeded games, aggregate, compare with `baseline.json`,
 * print a table.
 *
 * A suite is bots x {60, 120} Hz x seeds 1..N, plus a direct sampling of the piece queue. Its
 * output is a flat `Record<string, number | null>` per run ("score.mean", "dropShare.t3", ...)
 * so the baseline, the bands and the table all use the same keys. Only deterministic metrics go
 * in the baseline: step cost (wall clock) is reported but never banded here (see `COST_BUDGET`).
 *
 * #3697: the full suite also plays the capstone runs (`capstone`): the skilled bot for up to 10
 * simulated minutes per game, stopping at the win, for the win rate and the time to the win
 * (#3904: two capstones touching).
 * They are slow (a game can run 36,000 fixed steps), so the PR smoke never plays them.
 */
import { BOTS } from "./bots";
import { FRAME_RATES_HZ, resolveConstants, type SimConfig } from "./config";
import { CHAIN_WATCH_MS, runGame, type GameMetrics } from "./runGame";
import { sampleQueue } from "./queueSampler";

export interface SuiteParams {
  seeds: number;
  bots: string[];
  hzs: number[];
  /** Simulated-time cap per game (ms). */
  maxSimMs: number;
  /** Queue sampling: seeds x draws, calm and in danger. */
  queueSeeds: number;
  queueDraws: number;
  /** First seed is seedOffset + 1 (default 0). Used to prove a baseline does not depend on the seed set. */
  seedOffset?: number;
  /**
   * Coarse guard: only robust keys are banded (see ROBUST_KEYS), with tolerances that survive a
   * different seed set. The smoke uses it; per-tier rates, shares and settle live in the full suite.
   */
  coarse?: boolean;
  /** The capstone runs (#3697): bots x frame rates x seeds, each to the win or `maxSimMs`. */
  capstone?: { seeds: number; bots: string[]; hzs: number[]; maxSimMs: number };
}

/** Capstone runs per bot and frame rate in the full suite (each up to 10 simulated minutes). */
export const CAPSTONE_SEEDS = 100;
/** A capstone run's cap: 10 simulated minutes (a session). */
export const CAPSTONE_MAX_SIM_MS = 600_000;

/**
 * The long run (gate workflow): 100 seeded sessions per bot and frame rate (#1605 metric 5).
 * @public Used by tools/sim/simulate-cascade.ts, outside the knip workspace.
 */
export const FULL_PARAMS: SuiteParams = {
  seeds: 100,
  bots: ["heuristic", "random", "spam"],
  hzs: [...FRAME_RATES_HZ],
  maxSimMs: 180_000,
  queueSeeds: 100,
  queueDraws: 1000,
  capstone: {
    seeds: CAPSTONE_SEEDS,
    bots: ["skilled"],
    hzs: [60],
    maxSimMs: CAPSTONE_MAX_SIM_MS,
  },
};

/** The PR smoke (inside the ordinary jest run): a few seeds, well under 30 s. */
export const SMOKE_PARAMS: SuiteParams = {
  seeds: 3,
  bots: ["heuristic", "random", "spam"],
  hzs: [...FRAME_RATES_HZ],
  maxSimMs: 60_000,
  queueSeeds: 20,
  queueDraws: 500,
  coarse: true,
};

/** The spam bot must reach game over inside this much simulated time (#3694). */
export const SPAM_GAME_OVER_BOUND_MS = 120_000;
/**
 * Chain latency gate (#3697): a merge product touching a same-tier piece must merge again within
 * this (p90 over a run's watched products), i.e. the chain reads as one motion.
 */
export const CHAIN_LATENCY_BOUND_MS = 150;
/** Step budget (#1605): mean `engine.step` cost with 20+ pieces on the board, in ms. */
export const COST_BUDGET_MS = 16;
/**
 * Overlap gates (#3904, owner: the overlap between pieces looks bad). Over a run's games, each
 * game's deepest overlap between touching neighbours (drawn radius, calm samples): the median
 * must be at most OVERLAP_MEDIAN_MAX_PX and the p90 at most OVERLAP_P90_MAX_PX; and the mean
 * visible gap at least GAP_MEAN_MIN_PX (negative = the drawn pieces sink into each other).
 */
export const OVERLAP_MEDIAN_MAX_PX = 3;
export const OVERLAP_P90_MAX_PX = 5;
export const GAP_MEAN_MIN_PX = -0.5;

export type FlatMetrics = Record<string, number | null>;

export interface SuiteResult {
  params: SuiteParams;
  /** Keyed "bot@hz"; the capstone runs "capstone:bot@hz". */
  runs: Record<string, FlatMetrics>;
  /** Wall-clock step cost per run: reported, not baselined. */
  cost: Record<
    string,
    { meanStepMs: number; meanStepMsGe20: number | null; worstGameP95StepMs: number }
  >;
  /** Keyed "calm" / "danger". */
  queue: Record<string, FlatMetrics>;
}

type Num = number | null | undefined;

function avg(xs: Num[]): number | null {
  const v = xs.filter((x): x is number => typeof x === "number");
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}
function maxOf(xs: Num[]): number | null {
  const v = xs.filter((x): x is number => typeof x === "number");
  return v.length ? Math.max(...v) : null;
}
function minOf(xs: Num[]): number | null {
  const v = xs.filter((x): x is number => typeof x === "number");
  return v.length ? Math.min(...v) : null;
}
/** Nearest-rank percentile (p in (0, 1]) of the numbers, null if there are none. */
function pct(xs: Num[], p: number): number | null {
  const v = xs.filter((x): x is number => typeof x === "number").sort((a, b) => a - b);
  if (v.length === 0) return null;
  return v[Math.min(v.length, Math.max(1, Math.ceil(p * v.length))) - 1]!;
}

/** Aggregate one bot x frame rate over its seeds into flat metrics. */
export function aggregateGames(games: GameMetrics[], maxTier: number): FlatMetrics {
  const n = games.length;
  const out: FlatMetrics = {};
  out["games"] = n;
  const simS = games.map((g) => g.simMs / 1000);
  out["simS.mean"] = avg(simS);
  out["simS.min"] = minOf(simS);
  out["simS.max"] = maxOf(simS);
  const scores = games.map((g) => g.score);
  out["score.mean"] = avg(scores);
  out["score.min"] = minOf(scores);
  out["score.max"] = maxOf(scores);
  out["drops.mean"] = avg(games.map((g) => g.drops));
  out["merges.mean"] = avg(games.map((g) => g.merges));
  out["endedBy.overflowRate"] = avg(games.map((g) => (g.endedBy === "overflow" ? 1 : 0)));
  out["endedBy.hardStopRate"] = avg(games.map((g) => (g.endedBy === "hardStop" ? 1 : 0)));
  out["endedBy.capRate"] = avg(games.map((g) => (g.endedBy === "cap" ? 1 : 0)));
  out["endedBy.winRate"] = avg(games.map((g) => (g.endedBy === "win" ? 1 : 0)));
  out["topTier.mean"] = avg(games.map((g) => g.topTier));
  // Top-tier reached rate: the share of games in which the top tier existed at some point.
  out["topTier.reachedRate"] = avg(games.map((g) => (g.topTier >= maxTier ? 1 : 0)));
  // The win (#3904: the engine emits it when two capstones touch).
  out["win.rate"] = avg(games.map((g) => (g.won ? 1 : 0)));
  const winS = games.map((g) => (g.timeToWinMs === null ? null : g.timeToWinMs / 1000));
  out["win.timeToWinS.mean"] = avg(winS);
  // Over the games that won: the middle half and the median.
  out["win.timeToWinS.p25"] = pct(winS, 0.25);
  out["win.timeToWinS.median"] = pct(winS, 0.5);
  out["win.timeToWinS.p75"] = pct(winS, 0.75);
  const t10 = games.map((g) => {
    const ms = g.tierFirstMs?.[maxTier - 1];
    return ms === null || ms === undefined ? null : ms / 1000;
  });
  out["tier10.timeS.median"] = pct(t10, 0.5);

  const totalDrops = games.reduce((a, g) => a + g.drops, 0);
  for (let t = 0; t <= maxTier; t++) {
    const drops = games.reduce((a, g) => a + g.dropsByTier[t]!, 0);
    out[`dropShare.t${t}`] = totalDrops > 0 ? drops / totalDrops : null;
    out[`scoreByTier.t${t}`] = avg(games.map((g) => g.scoreByTier[t]));
    out[`mergesByTier.t${t}`] = avg(games.map((g) => g.mergesByTier[t]));
    out[`reachedRate.t${t}`] = avg(games.map((g) => (g.topTier >= t ? 1 : 0)));
    out[`drought.max.t${t}`] = maxOf(games.map((g) => g.maxDroughtByTier[t]));
  }

  const f = (pick: (g: GameMetrics) => Num): number | null => avg(games.map(pick));
  out["feel.packingDensity"] = f((g) => g.feel.packingDensity);
  out["feel.gapMeanPx"] = f((g) => g.feel.gapMeanPx);
  out["feel.gapMaxPx"] = maxOf(games.map((g) => g.feel.gapMaxPx));
  out["feel.overlapMaxPx.mean"] = f((g) => g.feel.overlapMaxPx);
  out["feel.overlapMaxPx.median"] = pct(
    games.map((g) => g.feel.overlapMaxPx),
    0.5
  );
  out["feel.overlapMaxPx.p90"] = pct(
    games.map((g) => g.feel.overlapMaxPx),
    0.9
  );
  out["feel.settleAfterDropMs"] = f((g) => g.feel.settleAfterDropMs);
  out["feel.settleAfterChainMs"] = f((g) => g.feel.settleAfterChainMs);
  const sumOf = (pick: (g: GameMetrics) => number): number =>
    games.reduce((a, g) => a + pick(g), 0);
  const finished = sumOf((g) => g.feel.dropEpisodes);
  const cut = sumOf((g) => g.feel.censoredEpisodes);
  // Episodes cut off by the next drop never reach the settle mean, which is then biased low for
  // a bot that drops fast (spam). Read the settle numbers together with this fraction.
  out["feel.settleCensoredFraction"] = finished + cut > 0 ? cut / (finished + cut) : null;
  out["feel.settleEpisodes.total"] = finished;
  out["feel.chainEpisodes.total"] = sumOf((g) => g.feel.chainEpisodes);
  out["feel.dropEpisodes.mean"] = f((g) => g.feel.dropEpisodes);
  out["feel.chainEpisodes.mean"] = f((g) => g.feel.chainEpisodes);
  out["feel.jitterPxPerS"] = f((g) => g.feel.jitterPxPerS);
  out["feel.guardRailEvents.mean"] = f((g) => g.feel.guardRailEvents);
  out["feel.guardRailPerMin"] = f((g) => g.feel.guardRailPerMin);
  out["feel.wallDepthMaxPx"] = maxOf(games.map((g) => g.feel.wallDepthMaxPx));
  out["feel.wallPenetrationPerMin"] = f((g) => g.feel.wallPenetrationPerMin);
  const lat = games.flatMap((g) => g.feel.chainLatencyMs ?? []);
  const misses = sumOf((g) => g.feel.chainMisses ?? 0);
  out["feel.chainLatency.watched"] = lat.length + misses;
  // A watched product that never merged again is a censored late sample: it counts at the watch
  // limit, so stalled chains raise the percentiles instead of dropping out of them (PR #3863).
  const latWithMisses =
    misses > 0 ? lat.concat(new Array<number>(misses).fill(CHAIN_WATCH_MS)) : lat;
  out["feel.chainLatencyMs.median"] = pct(latWithMisses, 0.5);
  out["feel.chainLatencyMs.p90"] = pct(latWithMisses, 0.9);
  // Share of watched merge products that merged again within the bound (misses count as late).
  out["feel.chainUnder150Rate"] =
    lat.length + misses > 0
      ? lat.filter((ms) => ms < CHAIN_LATENCY_BOUND_MS).length / (lat.length + misses)
      : null;
  return out;
}

export function runSuite(params: SuiteParams, config?: SimConfig): SuiteResult {
  const c = resolveConstants(config);
  const runs: SuiteResult["runs"] = {};
  const cost: SuiteResult["cost"] = {};
  for (const botName of params.bots) {
    const bot = BOTS[botName];
    if (!bot) throw new Error(`unknown bot: ${botName}`);
    for (const hz of params.hzs) {
      const games: GameMetrics[] = [];
      for (let i = 1; i <= params.seeds; i++) {
        const seed = (params.seedOffset ?? 0) + i;
        // The spam bot always gets the lid's full bound: the lid gate needs it to lose inside it.
        const maxSimMs = botName === "spam" ? SPAM_GAME_OVER_BOUND_MS : params.maxSimMs;
        games.push(runGame({ seed, hz: hz as 60 | 120, bot, maxSimMs, config }));
      }
      const key = `${botName}@${hz}`;
      runs[key] = aggregateGames(games, c.maxTier);
      cost[key] = {
        meanStepMs: avg(games.map((g) => g.cost.meanStepMs)) ?? 0,
        meanStepMsGe20: avg(games.map((g) => g.cost.meanStepMsGe20)),
        // The worst game's own p95 (not a p95 over all steps).
        worstGameP95StepMs: maxOf(games.map((g) => g.cost.p95StepMs)) ?? 0,
      };
    }
  }
  const cap = params.capstone;
  for (const botName of cap?.bots ?? []) {
    const bot = BOTS[botName];
    if (!bot) throw new Error(`unknown bot: ${botName}`);
    for (const hz of cap!.hzs) {
      const games: GameMetrics[] = [];
      for (let i = 1; i <= cap!.seeds; i++) {
        const seed = (params.seedOffset ?? 0) + i;
        const maxSimMs = cap!.maxSimMs;
        games.push(runGame({ seed, hz: hz as 60 | 120, bot, maxSimMs, config, stopOnWin: true }));
      }
      const key = `capstone:${botName}@${hz}`;
      runs[key] = aggregateGames(games, c.maxTier);
      cost[key] = {
        meanStepMs: avg(games.map((g) => g.cost.meanStepMs)) ?? 0,
        meanStepMsGe20: avg(games.map((g) => g.cost.meanStepMsGe20)),
        worstGameP95StepMs: maxOf(games.map((g) => g.cost.p95StepMs)) ?? 0,
      };
    }
  }
  const queue: SuiteResult["queue"] = {};
  for (const [name, danger] of [
    ["calm", false],
    ["danger", true],
  ] as const) {
    const s = sampleQueue(
      params.queueSeeds,
      params.queueDraws,
      danger,
      c.maxTier + 1,
      c.droppableTiers
    );
    const flat: FlatMetrics = { draws: s.draws };
    for (let t = 0; t <= c.maxTier; t++) {
      flat[`share.t${t}`] = s.share[t]!;
      flat[`drought.max.t${t}`] = s.maxDrought[t]!;
    }
    queue[name] = flat;
  }
  return { params, runs, cost, queue };
}

// ---------------------------------------------------------------------------------------
// Baseline and bands
// ---------------------------------------------------------------------------------------

export interface Band {
  value: number | null;
  min: number | null;
  max: number | null;
}
export type BandSet = Record<string, Band>;
export interface BaselineSuite {
  params: SuiteParams;
  runs: Record<string, BandSet>;
  queue: Record<string, BandSet>;
}
export interface Baseline {
  version: 1;
  note: string;
  suites: Record<string, BaselineSuite>;
}

/** Keys that are informational and never banded (counts of episodes depend on timing noise). */
const NOT_BANDED =
  /^(games|draws|feel\.(dropEpisodes|chainEpisodes)\.mean|feel\.(settle|chain)Episodes\.total|feel\.settleCensoredFraction|feel\.chainLatency\.watched)$/;

/** Settle means are only banded when this many episodes finished (the rest were cut off). */
export const MIN_SETTLE_EPISODES = 20;

/**
 * The keys a coarse (smoke) suite bands: game length, total score and guard-rail count. Per-tier
 * rates, shares, droughts and settle need many seeds and live in the full suite only. The lid
 * and the step budget are hard gates in `checkSuite`, not bands.
 */
export const ROBUST_KEYS = new Set(["simS.mean", "score.mean", "feel.guardRailPerMin"]);
/**
 * Coarse tolerance: wide enough that a different set of a few seeds still passes. #3904: 0.6 to
 * 0.7. On the 5-98 ladder a spam game's score swings with whether it makes a 2048-point capstone:
 * over 3 seeds its mean moved by up to +66 % between the seed sets 1-3, 4-6, 11-13, 51-53, 201-203.
 */
const COARSE_REL = 0.7;

/**
 * Tolerance around a baseline value: the larger of a relative fraction and an absolute floor
 * that fits the metric's unit. They are drift guards, not targets: #3697 re-baselines.
 */
export function tolerance(key: string, value: number, games = 100): number {
  const rel = (r: number, floor: number): number => Math.max(Math.abs(value) * r, floor);
  // A rate over n games moves in steps of 1/n: never band tighter than one game.
  if (/Rate$|^reachedRate/.test(key)) return rel(0.2, Math.max(0.05, 1 / games));
  if (/^dropShare|^share\.|packingDensity/.test(key)) return rel(0.2, 0.05);
  if (key.startsWith("drought.") || /drought\.max/.test(key)) return rel(0.25, 6);
  if (/^feel\.(gap|overlap)/.test(key)) return rel(0.3, 1.5);
  if (/^feel\.settle/.test(key)) return rel(0.3, 150);
  if (/^feel\.jitter/.test(key)) return rel(0.3, 3);
  // #3697: no guard rail fires in normal play and nothing goes into a wall: these stay near 0.
  if (/^feel\.guardRail/.test(key)) return rel(0.3, 1);
  if (/^feel\.wall/.test(key)) return rel(0.3, 1);
  if (/^feel\.chainLatencyMs/.test(key)) return rel(0.3, 34);
  if (/^win\.timeToWinS|^tier10\.timeS/.test(key)) return rel(0.2, 30);
  return rel(0.25, 1);
}

/** Whether a metric of this run is left unbanded (value kept, no min/max). */
function unbanded(runKey: string, flat: FlatMetrics, k: string, coarse: boolean): boolean {
  if (NOT_BANDED.test(k)) return true;
  if (coarse) return !ROBUST_KEYS.has(k);
  // The spam bot drops before the board calms: its settle numbers are survivor-biased and not
  // comparable (see feel.settleCensoredFraction), so they are never banded.
  if (k === "feel.settleAfterDropMs") {
    return (
      runKey.startsWith("spam@") || (flat["feel.settleEpisodes.total"] ?? 0) < MIN_SETTLE_EPISODES
    );
  }
  if (k === "feel.settleAfterChainMs") {
    return (
      runKey.startsWith("spam@") || (flat["feel.chainEpisodes.total"] ?? 0) < MIN_SETTLE_EPISODES
    );
  }
  return false;
}

function toBands(flat: FlatMetrics, runKey: string, coarse: boolean): BandSet {
  const out: BandSet = {};
  const games = flat["games"] ?? 100;
  for (const [k, v] of Object.entries(flat)) {
    if (coarse && !ROBUST_KEYS.has(k)) continue;
    if (v === null) {
      out[k] = { value: null, min: null, max: null };
      continue;
    }
    const round = (x: number): number => Math.round(x * 1e4) / 1e4;
    const tol = unbanded(runKey, flat, k, coarse)
      ? null
      : coarse
        ? Math.max(Math.abs(v) * COARSE_REL, 1)
        : tolerance(k, v, games);
    // Fractions stay inside [0, 1]; the win rate stays inside [0, 1] too.
    const unit = /Rate$|^dropShare|^share\.|^reachedRate/.test(k);
    const lo = (x: number): number => (unit ? Math.max(0, x) : x);
    const hi = (x: number): number => (unit ? Math.min(1, x) : x);
    out[k] = {
      value: round(v),
      min: tol === null ? null : round(lo(v - tol)),
      max: tol === null ? null : round(hi(v + tol)),
    };
  }
  return out;
}

export function makeBaselineSuite(result: SuiteResult): BaselineSuite {
  const runs: BaselineSuite["runs"] = {};
  const coarse = result.params.coarse === true;
  for (const [k, v] of Object.entries(result.runs)) runs[k] = toBands(v, k, coarse);
  const queue: BaselineSuite["queue"] = {};
  if (!coarse) {
    for (const [k, v] of Object.entries(result.queue)) queue[k] = toBands(v, k, false);
  }
  return { params: result.params, runs, queue };
}

/**
 * The baseline for a run whose capstone runs play `capstoneSeeds` games instead of the baseline's
 * (the PR runs play 50, the nightly 100): the same suite with the capstone runs' bands widened
 * around their value by sqrt(baselineGames / capstoneSeeds), the growth of a mean's sampling
 * error when the games are fewer (50 vs 100: x1.41). The seeds 1..N are a prefix of the baseline's,
 * so the result is the baseline's own games, fewer; the wider band absorbs that subset's
 * drift, while a real physics change (a win rate or time to the capstone moving by tens of
 * percent) still leaves it. Every other run keeps its bands.
 * @public Used by tools/sim/simulate-cascade.ts, outside the knip workspace.
 */
export function baselineForCapstoneSeeds(
  baseline: BaselineSuite,
  capstoneSeeds: number
): BaselineSuite {
  const base = baseline.params.capstone;
  if (!base || base.seeds === capstoneSeeds) return baseline;
  const factor = Math.sqrt(base.seeds / capstoneSeeds);
  const runs: BaselineSuite["runs"] = {};
  for (const [k, bands] of Object.entries(baseline.runs)) {
    if (!k.startsWith("capstone:")) {
      runs[k] = bands;
      continue;
    }
    const wide: BandSet = {};
    for (const [key, b] of Object.entries(bands)) {
      wide[key] =
        b.value === null || b.min === null || b.max === null
          ? b
          : {
              value: b.value,
              min: b.value - (b.value - b.min) * factor,
              max: b.value + (b.max - b.value) * factor,
            };
    }
    runs[k] = wide;
  }
  return {
    ...baseline,
    params: { ...baseline.params, capstone: { ...base, seeds: capstoneSeeds } },
    runs,
  };
}

export interface Violation {
  where: string;
  key: string;
  value: number | null;
  min: number | null;
  max: number | null;
  message: string;
}

function checkSet(where: string, flat: FlatMetrics | undefined, bands: BandSet): Violation[] {
  const out: Violation[] = [];
  if (!flat) {
    return [{ where, key: "*", value: null, min: null, max: null, message: "run missing" }];
  }
  for (const [key, band] of Object.entries(bands)) {
    const value = flat[key] ?? null;
    if (band.min === null || band.max === null) {
      // Unbanded: a null baseline stays null (a win time where the baseline had no win).
      if (band.value === null && value !== null && key.startsWith("win.")) {
        out.push({ where, key, value, min: null, max: null, message: "expected n/a" });
      }
      continue;
    }
    if (value === null || value < band.min || value > band.max) {
      out.push({
        where,
        key,
        value,
        min: band.min,
        max: band.max,
        message: `${key}=${value} outside [${band.min}, ${band.max}]`,
      });
    }
  }
  return out;
}

/**
 * Violations of the banded metrics and of the hard gates: the spam bot loses inside the lid's
 * bound and never wins, no guard rail fires (#3697: nothing is ever teleported), chain merges are
 * prompt (p90 under `CHAIN_LATENCY_BOUND_MS`), the overlap gates (#3904: deepest overlap median
 * and p90, mean visible gap), and the step budget.
 */
export function checkSuite(result: SuiteResult, baseline: BaselineSuite | undefined): Violation[] {
  const out: Violation[] = [];
  if (baseline) {
    for (const [k, bands] of Object.entries(baseline.runs)) {
      out.push(...checkSet(k, result.runs[k], bands));
    }
    for (const [k, bands] of Object.entries(baseline.queue)) {
      out.push(...checkSet(`queue:${k}`, result.queue[k], bands));
    }
  }
  for (const [k, run] of Object.entries(result.runs)) {
    if (k.startsWith("spam@")) out.push(...spamViolations(k, run));
  }
  for (const [k, run] of Object.entries(result.runs)) {
    const rails = run["feel.guardRailEvents.mean"];
    if (rails !== null && rails !== undefined && rails > 0) {
      out.push({
        where: k,
        key: "guardRail",
        value: rails,
        min: null,
        max: 0,
        message: `guard rail fired (${rails} per game): a piece escaped the bin`,
      });
    }
    const p90 = run["feel.chainLatencyMs.p90"];
    if (p90 !== null && p90 !== undefined && p90 >= CHAIN_LATENCY_BOUND_MS) {
      out.push({
        where: k,
        key: "chainLatency",
        value: p90,
        min: null,
        max: CHAIN_LATENCY_BOUND_MS,
        message: `chain merge latency p90 ${p90.toFixed(0)} ms is not under ${CHAIN_LATENCY_BOUND_MS} ms`,
      });
    }
    out.push(...overlapViolations(k, run));
  }
  for (const [k, c] of Object.entries(result.cost)) {
    if (c.meanStepMsGe20 !== null && c.meanStepMsGe20 > COST_BUDGET_MS) {
      out.push({
        where: k,
        key: "stepCost",
        value: c.meanStepMsGe20,
        min: null,
        max: COST_BUDGET_MS,
        message: `mean step cost ${c.meanStepMsGe20.toFixed(2)} ms with 20+ pieces exceeds ${COST_BUDGET_MS} ms`,
      });
    }
  }
  return out;
}

/** The lid gate (#3694) and, since #3904, the no-win gate for one spam run. */
function spamViolations(k: string, run: FlatMetrics): Violation[] {
  const out: Violation[] = [];
  const cap = run["endedBy.capRate"];
  const longest = run["simS.max"] ?? null;
  if (cap !== 0 || longest === null || longest * 1000 > SPAM_GAME_OVER_BOUND_MS) {
    out.push({
      where: k,
      key: "lid",
      value: longest,
      min: null,
      max: SPAM_GAME_OVER_BOUND_MS / 1000,
      message: `spam bot did not always reach game over within ${SPAM_GAME_OVER_BOUND_MS / 1000} s`,
    });
  }
  const wins = run["win.rate"];
  if (wins !== null && wins !== undefined && wins > 0) {
    out.push({
      where: k,
      key: "spamWin",
      value: wins,
      min: null,
      max: 0,
      message: `spam bot won ${(wins * 100).toFixed(0)} % of games: mindless play must never win`,
    });
  }
  return out;
}

/** The overlap gates (#3904) for one run: see OVERLAP_MEDIAN_MAX_PX. */
function overlapViolations(where: string, run: FlatMetrics): Violation[] {
  const out: Violation[] = [];
  const gate = (key: string, value: number | null | undefined, max: number, what: string) => {
    if (value !== null && value !== undefined && value > max) {
      out.push({
        where,
        key,
        value,
        min: null,
        max,
        message: `${what} ${value.toFixed(2)} px is over ${max} px`,
      });
    }
  };
  gate(
    "overlapMedian",
    run["feel.overlapMaxPx.median"],
    OVERLAP_MEDIAN_MAX_PX,
    "deepest overlap median"
  );
  gate("overlapP90", run["feel.overlapMaxPx.p90"], OVERLAP_P90_MAX_PX, "deepest overlap p90");
  const gap = run["feel.gapMeanPx"];
  if (gap !== null && gap !== undefined && gap < GAP_MEAN_MIN_PX) {
    out.push({
      where,
      key: "gapMean",
      value: gap,
      min: GAP_MEAN_MIN_PX,
      max: null,
      message: `mean visible gap ${gap.toFixed(2)} px is under ${GAP_MEAN_MIN_PX} px`,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------------------------

const fmt = (v: number | null | undefined, d = 2): string =>
  v === null || v === undefined ? "n/a" : v.toFixed(d);

/** Markdown tables of the headline metrics, for PR descriptions and the job summary. */
export function formatTable(result: SuiteResult): string {
  const keys = Object.keys(result.runs);
  const tiers = Object.keys(result.runs[keys[0] ?? ""] ?? {})
    .filter((k) => k.startsWith("dropShare.t"))
    .map((k) => Number(k.slice("dropShare.t".length)));
  const rows: [string, (k: string) => string][] = [
    ["games", (k) => fmt(result.runs[k]!["games"], 0)],
    ["game length s (mean)", (k) => fmt(result.runs[k]!["simS.mean"], 1)],
    ["score (mean)", (k) => fmt(result.runs[k]!["score.mean"], 0)],
    [
      "score (min..max)",
      (k) => `${fmt(result.runs[k]!["score.min"], 0)}..${fmt(result.runs[k]!["score.max"], 0)}`,
    ],
    ["ended by overflow", (k) => fmt(result.runs[k]!["endedBy.overflowRate"])],
    ["ended by hard stop", (k) => fmt(result.runs[k]!["endedBy.hardStopRate"])],
    ["hit time cap", (k) => fmt(result.runs[k]!["endedBy.capRate"])],
    ["top tier reached rate", (k) => fmt(result.runs[k]!["topTier.reachedRate"])],
    ["top tier (mean)", (k) => fmt(result.runs[k]!["topTier.mean"], 1)],
    [
      "win rate / time (s)",
      (k) =>
        `${fmt(result.runs[k]!["win.rate"])} / ${fmt(result.runs[k]!["win.timeToWinS.mean"], 1)}`,
    ],
    ["packing density", (k) => fmt(result.runs[k]!["feel.packingDensity"], 3)],
    ["visible gap mean px", (k) => fmt(result.runs[k]!["feel.gapMeanPx"])],
    ["visible gap max px", (k) => fmt(result.runs[k]!["feel.gapMaxPx"])],
    ["deepest overlap px (mean of games)", (k) => fmt(result.runs[k]!["feel.overlapMaxPx.mean"])],
    [
      "deepest overlap px, median / p90 of games (gate 3 / 5)",
      (k) =>
        `${fmt(result.runs[k]!["feel.overlapMaxPx.median"])} / ${fmt(result.runs[k]!["feel.overlapMaxPx.p90"])}`,
    ],
    ["settle after drop ms", (k) => fmt(result.runs[k]!["feel.settleAfterDropMs"], 0)],
    ["settle after 3+ chain ms", (k) => fmt(result.runs[k]!["feel.settleAfterChainMs"], 0)],
    [
      "settle episodes cut off by the next drop (read settle with this)",
      (k) => fmt(result.runs[k]!["feel.settleCensoredFraction"]),
    ],
    ["jitter px/s", (k) => fmt(result.runs[k]!["feel.jitterPxPerS"])],
    ["guard rail events / game", (k) => fmt(result.runs[k]!["feel.guardRailEvents.mean"], 0)],
    ["guard rail events / min", (k) => fmt(result.runs[k]!["feel.guardRailPerMin"], 0)],
    ["deepest wall penetration px", (k) => fmt(result.runs[k]!["feel.wallDepthMaxPx"])],
    ["wall penetration > 1 px / min", (k) => fmt(result.runs[k]!["feel.wallPenetrationPerMin"])],
    [
      "chain latency ms, median / p90",
      (k) =>
        `${fmt(result.runs[k]!["feel.chainLatencyMs.median"], 0)} / ${fmt(result.runs[k]!["feel.chainLatencyMs.p90"], 0)}`,
    ],
    ["chain merges under 150 ms", (k) => fmt(result.runs[k]!["feel.chainUnder150Rate"])],
    [
      "time to win s, p25 / median / p75 (winners)",
      (k) =>
        `${fmt(result.runs[k]!["win.timeToWinS.p25"], 0)} / ${fmt(result.runs[k]!["win.timeToWinS.median"], 0)} / ${fmt(result.runs[k]!["win.timeToWinS.p75"], 0)}`,
    ],
    ["time to tier 10 s, median", (k) => fmt(result.runs[k]!["tier10.timeS.median"], 0)],
    ["step ms (20+ pieces, wall clock)", (k) => fmt(result.cost[k]?.meanStepMsGe20, 3)],
    ["step ms, worst game p95 (wall clock)", (k) => fmt(result.cost[k]?.worstGameP95StepMs, 3)],
  ];
  const lines: string[] = [];
  lines.push(`| metric | ${keys.join(" | ")} |`);
  lines.push(`| --- | ${keys.map(() => "---:").join(" | ")} |`);
  for (const [label, get] of rows) lines.push(`| ${label} | ${keys.map(get).join(" | ")} |`);
  for (const t of tiers) {
    lines.push(
      `| drop share t${t} | ${keys.map((k) => fmt(result.runs[k]![`dropShare.t${t}`], 3)).join(" | ")} |`
    );
  }
  for (const t of tiers) {
    lines.push(
      `| score from t${t} merges | ${keys.map((k) => fmt(result.runs[k]![`scoreByTier.t${t}`], 0)).join(" | ")} |`
    );
  }
  for (const t of tiers.filter(
    (x) => (result.runs[keys[0] ?? ""]?.[`drought.max.t${x}`] ?? 0) > 0
  )) {
    lines.push(
      `| longest drought t${t} (drops) | ${keys.map((k) => fmt(result.runs[k]![`drought.max.t${t}`], 0)).join(" | ")} |`
    );
  }
  const qk = Object.keys(result.queue);
  lines.push("");
  lines.push(`| queue sample | ${qk.join(" | ")} |`);
  lines.push(`| --- | ${qk.map(() => "---:").join(" | ")} |`);
  for (const t of tiers.filter((x) => (result.queue[qk[0] ?? ""]?.[`share.t${x}`] ?? 0) > 0)) {
    lines.push(
      `| share t${t} | ${qk.map((k) => fmt(result.queue[k]![`share.t${t}`], 3)).join(" | ")} |`
    );
    lines.push(
      `| longest drought t${t} | ${qk.map((k) => fmt(result.queue[k]![`drought.max.t${t}`], 0)).join(" | ")} |`
    );
  }
  return lines.join("\n");
}
