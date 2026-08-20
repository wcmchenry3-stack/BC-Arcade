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
  /** True when |tStat| exceeds the 95%-confidence threshold. */
  readonly significant: boolean;
}

const Z_95 = 1.96;

function mean(values: readonly number[]): number {
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function sampleVariance(values: readonly number[], m: number): number {
  if (values.length < 2) return 0;
  const sumSq = values.reduce((s, v) => s + (v - m) ** 2, 0);
  return sumSq / (values.length - 1);
}

/**
 * Welch's t-test for two independent samples with possibly-unequal variance
 * and sample size — appropriate here since each difficulty's decision-loss
 * distribution has its own variance, and per-difficulty decision counts can
 * differ (an early "keep all dice" turn skips a hold decision).
 *
 * Uses a fixed z=1.96 threshold (large-sample normal approximation) rather
 * than a full Student's-t degrees-of-freedom lookup — decision counts in
 * these simulations run into the hundreds-to-thousands, well past where the
 * t- and normal distributions are practically indistinguishable.
 */
export function meanDiffSignificant(a: readonly number[], b: readonly number[]): MeanDiffTest {
  const meanA = mean(a);
  const meanB = mean(b);
  const varA = sampleVariance(a, meanA);
  const varB = sampleVariance(b, meanB);
  const se = Math.sqrt(varA / a.length + varB / b.length);
  const tStat = se > 0 ? (meanA - meanB) / se : meanA === meanB ? 0 : Infinity;
  return {
    meanA,
    meanB,
    meanDiff: meanA - meanB,
    tStat,
    significant: Math.abs(tStat) > Z_95,
  };
}
