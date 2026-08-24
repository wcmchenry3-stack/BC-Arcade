/**
 * Yacht AI regret metric (#2244) — aggregation and reporting over a decision
 * log produced by `regret.ts`'s per-decision EV-loss functions.
 *
 * Pure module: no React, no IO, no Math.random. Consumers (the calibration
 * gate, `scripts/simulate-yacht.ts`-style tools) build a `RegretRecord[]`
 * while playing simulated games and pass it here for summarization.
 */

import type { AiDifficulty } from "../types";
import type {
  CategoryEvLossResult,
  EvLossBand,
  EvLossResult,
  HoldEvLossResult,
  YachtDecisionType,
} from "./regret";

// ---------------------------------------------------------------------------
// Decision log
// ---------------------------------------------------------------------------

/** One logged decision: the EV-loss result plus enough context to report it. */
export interface RegretRecord {
  readonly result: EvLossResult;
  readonly difficulty: AiDifficulty;
  readonly round: number;
  readonly dice: readonly number[];
}

// ---------------------------------------------------------------------------
// Summaries
// ---------------------------------------------------------------------------

export interface DecisionTypeSummary {
  readonly n: number;
  readonly meanEvLoss: number;
  readonly bandCounts: Readonly<Record<EvLossBand, number>>;
}

export interface RegretSummary {
  readonly n: number;
  readonly meanEvLoss: number;
  readonly byType: Readonly<Record<YachtDecisionType, DecisionTypeSummary>>;
}

function emptyBandCounts(): Record<EvLossBand, number> {
  return { optimal: 0, minor: 0, mistake: 0, blunder: 0 };
}

function summarizeResults(results: readonly EvLossResult[]): DecisionTypeSummary {
  const bandCounts = emptyBandCounts();
  let total = 0;
  for (const r of results) {
    total += r.evLoss;
    bandCounts[r.band]++;
  }
  return {
    n: results.length,
    meanEvLoss: results.length > 0 ? total / results.length : 0,
    bandCounts,
  };
}

/** Per-decision-type breakdown (hold vs category) plus an overall mean, from a decision log. */
export function summarizeRegret(records: readonly RegretRecord[]): RegretSummary {
  const all = records.map((r) => r.result);
  const holds = all.filter((r): r is HoldEvLossResult => r.decisionType === "hold");
  const categories = all.filter((r): r is CategoryEvLossResult => r.decisionType === "category");
  return {
    n: all.length,
    meanEvLoss: summarizeResults(all).meanEvLoss,
    byType: {
      hold: summarizeResults(holds),
      category: summarizeResults(categories),
    },
  };
}

// ---------------------------------------------------------------------------
// Worst-decision tail
// ---------------------------------------------------------------------------

/**
 * Top-`k` decisions by EV-loss, for blunder-tail reporting — "does this
 * difficulty ever make a catastrophic move, and what did it look like".
 */
export function worstDecisions(
  records: readonly RegretRecord[],
  k: number
): readonly RegretRecord[] {
  return [...records].sort((a, b) => b.result.evLoss - a.result.evLoss).slice(0, k);
}

/** Human-readable one-line description of a decision's chosen-vs-optimal, for console reporting. */
export function describeRegretRecord(record: RegretRecord): string {
  const { result } = record;
  const evLossStr = result.evLoss.toFixed(2);
  const diceStr = JSON.stringify(record.dice);
  if (result.decisionType === "hold") {
    return (
      `[${record.difficulty}] round ${record.round} hold: dice=${diceStr} ` +
      `chose=${JSON.stringify(result.chosenHold)} optimal=${JSON.stringify(result.optimalHold)} ` +
      `evLoss=${evLossStr} (${result.band})`
    );
  }
  return (
    `[${record.difficulty}] round ${record.round} category: dice=${diceStr} ` +
    `chose=${result.chosenCategory} optimal=${result.optimalCategory} ` +
    `evLoss=${evLossStr} (${result.band})`
  );
}

/** Blunders per 1,000 decisions — a rate, so batches of different sizes are comparable. */
export function blundersPer1000(records: readonly RegretRecord[]): number {
  if (records.length === 0) return 0;
  const blunders = records.filter((r) => r.result.band === "blunder").length;
  return (blunders / records.length) * 1000;
}

// ---------------------------------------------------------------------------
// Significance: Welch's t-test (unequal variance, unequal sample size)
// ---------------------------------------------------------------------------

export interface MeanDiffTest {
  readonly meanA: number;
  readonly meanB: number;
  /** meanA - meanB. */
  readonly meanDiff: number;
  readonly tStat: number;
  /** The two-tailed 95%-confidence critical value `|tStat|` was compared against. */
  readonly tCritical: number;
  /** True when |tStat| exceeds `tCritical`. */
  readonly significant: boolean;
}

/** Two-tailed 95%-confidence normal-approximation quantile (large-df limit of Student's t). */
const Z_95 = 1.959964;

function mean(values: readonly number[]): number {
  // Matches summarizeResults()/blundersPer1000() elsewhere in this file:
  // degrade to 0 on an empty log instead of propagating NaN (0/0).
  return values.length > 0 ? values.reduce((s, v) => s + v, 0) / values.length : 0;
}

function sampleVariance(values: readonly number[], m: number): number {
  if (values.length < 2) return 0;
  const sumSq = values.reduce((s, v) => s + (v - m) ** 2, 0);
  return sumSq / (values.length - 1);
}

/**
 * Welch–Satterthwaite approximate degrees of freedom for two independent
 * samples with unequal variance/size. Falls back to the pooled df when both
 * per-sample variances are 0 (e.g. constant samples), which would otherwise
 * make the df formula's denominator 0/0.
 */
function welchSatterthwaiteDf(varA: number, nA: number, varB: number, nB: number): number {
  if (nA < 2 || nB < 2) return 0;
  const a = varA / nA;
  const b = varB / nB;
  const denominator = a ** 2 / (nA - 1) + b ** 2 / (nB - 1);
  return denominator > 0 ? (a + b) ** 2 / denominator : nA + nB - 2;
}

/**
 * Two-tailed 95%-confidence Student's-t critical value for `df` degrees of
 * freedom, via the Cornish-Fisher expansion around the normal quantile
 * (Abramowitz & Stegun 26.7.5). Accurate to a few thousandths for df as low
 * as ~10-20 and converges to Z_95 as df grows — unlike a fixed z=1.96
 * threshold, this doesn't understate the true critical value (~2.01 at
 * df≈50) at the low decision counts a manual `YACHT_REGRET_SIM` override
 * can produce.
 */
function studentTCritical95(df: number): number {
  if (!(df > 0)) return Z_95;
  const z = Z_95;
  const g1 = (z ** 3 + z) / 4;
  const g2 = (5 * z ** 5 + 16 * z ** 3 + 3 * z) / 96;
  const g3 = (3 * z ** 7 + 19 * z ** 5 + 17 * z ** 3 - 15 * z) / 384;
  const g4 = (79 * z ** 9 + 776 * z ** 7 + 1482 * z ** 5 - 1920 * z ** 3 - 945 * z) / 92160;
  return z + g1 / df + g2 / df ** 2 + g3 / df ** 3 + g4 / df ** 4;
}

/**
 * Welch's t-test for two independent samples with possibly-unequal variance
 * and sample size — appropriate here since each difficulty's decision-loss
 * distribution has its own variance, and per-difficulty decision counts can
 * differ (an early "keep all dice" turn skips a hold decision).
 *
 * Uses the Welch–Satterthwaite degrees of freedom to pick the correct
 * Student's-t critical value rather than a fixed large-sample z=1.96 — the
 * two are practically indistinguishable at the hundreds-to-thousands of
 * decisions a full YACHT_SIM_FULL run produces, but a manual
 * `YACHT_REGRET_SIM` override (tens to ~100 decisions per difficulty) sits
 * at low enough df that the normal approximation is measurably too lenient.
 *
 * Empty or single-sample inputs degrade gracefully (0 tStat, not-significant)
 * rather than propagating NaN/Infinity from a 0/0 variance-over-n division —
 * or, worse, silently treating a single sample's undefined variance as zero
 * and reporting a false-positive significant result against the most lenient
 * (large-df) critical value.
 */
export function meanDiffSignificant(a: readonly number[], b: readonly number[]): MeanDiffTest {
  const meanA = mean(a);
  const meanB = mean(b);
  const meanDiff = meanA - meanB;

  if (a.length < 2 || b.length < 2) {
    return { meanA, meanB, meanDiff, tStat: 0, tCritical: Z_95, significant: false };
  }

  const varA = sampleVariance(a, meanA);
  const varB = sampleVariance(b, meanB);
  const se = Math.sqrt(varA / a.length + varB / b.length);
  const tStat = se > 0 ? meanDiff / se : meanA === meanB ? 0 : Infinity;
  const df = welchSatterthwaiteDf(varA, a.length, varB, b.length);
  const tCritical = studentTCritical95(df);
  return {
    meanA,
    meanB,
    meanDiff,
    tStat,
    tCritical,
    significant: Math.abs(tStat) > tCritical,
  };
}
