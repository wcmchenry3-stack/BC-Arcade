/**
 * Cascade sim suite (#2893): run many seeded games, aggregate, compare with `baseline.json`,
 * print a table.
 *
 * A suite is bots x {60, 120} Hz x seeds 1..N, plus a direct sampling of the piece queue. Its
 * output is a flat `Record<string, number | null>` per run ("score.mean", "dropShare.t3", ...)
 * so the baseline, the bands and the table all use the same keys. Only deterministic metrics go
 * in the baseline: step cost (wall clock) is reported but never banded here (see `COST_BUDGET`).
 */
import { BOTS } from "./bots";
import { FRAME_RATES_HZ, resolveConstants, type SimConfig } from "./config";
import { runGame, type GameMetrics } from "./runGame";
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
}

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
};

/** The PR smoke (inside the ordinary jest run): a few seeds, well under 30 s. */
export const SMOKE_PARAMS: SuiteParams = {
  seeds: 3,
  bots: ["heuristic", "random", "spam"],
  hzs: [...FRAME_RATES_HZ],
  maxSimMs: 60_000,
  queueSeeds: 20,
  queueDraws: 500,
};

/** The spam bot must reach game over inside this much simulated time (#3694). */
export const SPAM_GAME_OVER_BOUND_MS = 120_000;
/** Step budget (#1605): mean `engine.step` cost with 20+ pieces on the board, in ms. */
export const COST_BUDGET_MS = 16;

export type FlatMetrics = Record<string, number | null>;

export interface SuiteResult {
  params: SuiteParams;
  /** Keyed "bot@hz". */
  runs: Record<string, FlatMetrics>;
  /** Wall-clock step cost per run: reported, not baselined. */
  cost: Record<string, { meanStepMs: number; meanStepMsGe20: number | null; p95StepMs: number }>;
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
  out["topTier.mean"] = avg(games.map((g) => g.topTier));
  // Top-tier reached rate: the share of games in which the top tier existed at some point.
  out["topTier.reachedRate"] = avg(games.map((g) => (g.topTier >= maxTier ? 1 : 0)));
  // Win (#3699): the engine has no win event yet, so these read 0 / null until it does.
  out["win.rate"] = avg(games.map((g) => (g.won ? 1 : 0)));
  out["win.timeToWinS.mean"] = avg(
    games.map((g) => (g.timeToWinMs === null ? null : g.timeToWinMs / 1000))
  );

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
  out["feel.settleAfterDropMs"] = f((g) => g.feel.settleAfterDropMs);
  out["feel.settleAfterChainMs"] = f((g) => g.feel.settleAfterChainMs);
  out["feel.dropEpisodes.mean"] = f((g) => g.feel.dropEpisodes);
  out["feel.chainEpisodes.mean"] = f((g) => g.feel.chainEpisodes);
  out["feel.jitterPxPerS"] = f((g) => g.feel.jitterPxPerS);
  out["feel.guardRailEvents.mean"] = f((g) => g.feel.guardRailEvents);
  out["feel.guardRailPerMin"] = f((g) => g.feel.guardRailPerMin);
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
      for (let seed = 1; seed <= params.seeds; seed++) {
        const maxSimMs =
          botName === "spam" ? Math.min(params.maxSimMs, SPAM_GAME_OVER_BOUND_MS) : params.maxSimMs;
        games.push(runGame({ seed, hz: hz as 60 | 120, bot, maxSimMs, config }));
      }
      const key = `${botName}@${hz}`;
      runs[key] = aggregateGames(games, c.maxTier);
      cost[key] = {
        meanStepMs: avg(games.map((g) => g.cost.meanStepMs)) ?? 0,
        meanStepMsGe20: avg(games.map((g) => g.cost.meanStepMsGe20)),
        p95StepMs: maxOf(games.map((g) => g.cost.p95StepMs)) ?? 0,
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
const NOT_BANDED = /^(games|draws|feel\.(dropEpisodes|chainEpisodes)\.mean)$/;

/**
 * Tolerance around a baseline value: the larger of a relative fraction and an absolute floor
 * that fits the metric's unit. They are drift guards, not targets: #3697 re-baselines.
 */
export function tolerance(key: string, value: number): number {
  const rel = (r: number, floor: number): number => Math.max(Math.abs(value) * r, floor);
  if (/Rate$|^dropShare|^share\.|^reachedRate|packingDensity/.test(key)) return rel(0.2, 0.05);
  if (key.startsWith("drought.") || /drought\.max/.test(key)) return rel(0.25, 6);
  if (/^feel\.(gap|overlap)/.test(key)) return rel(0.3, 1.5);
  if (/^feel\.settle/.test(key)) return rel(0.3, 150);
  if (/^feel\.jitter/.test(key)) return rel(0.3, 3);
  if (/^feel\.guardRail/.test(key)) return rel(0.3, 50);
  return rel(0.25, 1);
}

function toBands(flat: FlatMetrics): BandSet {
  const out: BandSet = {};
  for (const [k, v] of Object.entries(flat)) {
    if (v === null) {
      out[k] = { value: null, min: null, max: null };
      continue;
    }
    const round = (x: number): number => Math.round(x * 1e4) / 1e4;
    const tol = NOT_BANDED.test(k) ? null : tolerance(k, v);
    // Fractions stay inside [0, 1]; the win rate (0 until #3699) stays a vacuous [0, 1].
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
  for (const [k, v] of Object.entries(result.runs)) runs[k] = toBands(v);
  const queue: BaselineSuite["queue"] = {};
  for (const [k, v] of Object.entries(result.queue)) queue[k] = toBands(v);
  return { params: result.params, runs, queue };
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
      // Unbanded: a null baseline stays null (win metrics until #3699).
      if (band.value === null && value !== null) {
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

/** Violations of the banded metrics and of the hard gates (spam loses, step budget). */
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
    if (k.startsWith("spam@")) {
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
    }
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
    ["settle after drop ms", (k) => fmt(result.runs[k]!["feel.settleAfterDropMs"], 0)],
    ["settle after 3+ chain ms", (k) => fmt(result.runs[k]!["feel.settleAfterChainMs"], 0)],
    ["jitter px/s", (k) => fmt(result.runs[k]!["feel.jitterPxPerS"])],
    ["guard rail events / game", (k) => fmt(result.runs[k]!["feel.guardRailEvents.mean"], 0)],
    ["guard rail events / min", (k) => fmt(result.runs[k]!["feel.guardRailPerMin"], 0)],
    ["step ms (20+ pieces, wall clock)", (k) => fmt(result.cost[k]?.meanStepMsGe20, 3)],
    ["step ms p95 (wall clock)", (k) => fmt(result.cost[k]?.p95StepMs, 3)],
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
