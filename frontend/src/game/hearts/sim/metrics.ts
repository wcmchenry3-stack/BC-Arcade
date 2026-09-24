/**
 * Conditional metrics for the Hearts sim gate (#2238).
 *
 * Every metric is `numerator | denominator`: a ratio of two per-seat
 * counters from harness.ts, reported with both counts. A rate can only be
 * declared against the counter that is its real population — moon success
 * is completions ÷ the hands where the trigger actually fired, never ÷ some
 * other trigger count (the HRT-1 bug #2204 fixed). The type makes a metric
 * without a denominator unrepresentable.
 *
 * Estimates are ratio estimators over blocks: the ratio of summed
 * numerators to summed denominators, with a block-level (delta-method)
 * standard error, so games that share deals are never treated as
 * independent — blocks are the independent unit.
 */

import { normalQuantile } from "../../_shared/simRandom";
import type { BlockRecord, CounterKey } from "./harness";

export interface MetricDef {
  readonly id: string;
  readonly numerator: CounterKey;
  readonly denominator: CounterKey;
  /** Human-readable `numerator | denominator`. */
  readonly description: string;
  readonly percent: boolean;
}

export const METRICS = {
  win_share: {
    id: "win_share",
    numerator: "winShare",
    denominator: "seatGames",
    description: "games won (ties split) | games played",
    percent: true,
  },
  points_per_hand: {
    id: "points_per_hand",
    numerator: "points",
    denominator: "handsPlayed",
    description: "points taken (moon-adjusted) | hands played",
    percent: false,
  },
  qs_taken: {
    id: "qs_taken",
    numerator: "qsTaken",
    denominator: "handsPlayed",
    description: "hands taking Q♠ | hands played",
    percent: true,
  },
  moon_attempt: {
    id: "moon_attempt",
    numerator: "moonAttempts",
    denominator: "handsPlayed",
    description: "hands the moon-attempt trigger fired | hands played",
    percent: true,
  },
  moon_success: {
    id: "moon_success",
    numerator: "moonAttemptSuccesses",
    denominator: "moonAttempts",
    description: "moons shot in attempted hands | hands attempted",
    percent: true,
  },
  moon_shot: {
    id: "moon_shot",
    numerator: "moonShots",
    denominator: "handsPlayed",
    description: "moons shot | hands played",
    percent: true,
  },
  qs_dump_on_human: {
    id: "qs_dump_on_human",
    numerator: "qsDumpsOnHuman",
    denominator: "qsDumps",
    description: "Q♠ dumps won by the human seat | Q♠ dumps",
    percent: true,
  },
  void_created: {
    id: "void_created",
    numerator: "voidsCreated",
    denominator: "voidOpportunities",
    description: "passes that emptied a suit | passes that could have",
    percent: true,
  },
} as const satisfies Record<string, MetricDef>;

export type MetricId = keyof typeof METRICS;

/** One block's (numerator, denominator) for a role's metric. */
export interface Observation {
  readonly y: number;
  readonly n: number;
}

export function observations(
  blocks: readonly BlockRecord[],
  role: string,
  metric: MetricDef
): Observation[] {
  return blocks.map((blk) => {
    const c = blk.roles[role];
    return { y: c ? c[metric.numerator] : 0, n: c ? c[metric.denominator] : 0 };
  });
}

/**
 * Per-block values whose mean is the ratio Σy / Σn and whose sample
 * variance gives its delta-method standard error:
 * z_b = (y_b − r·n_b) / n̄ + r. Blocks with a zero denominator contribute r
 * (no information). Empty when Σn = 0 — the rate is undefined.
 *
 * Every estimate and SPRT in the gate runs on series like this, so a rate
 * and a paired difference of two rates are handled the same way.
 */
export function ratioSeries(obs: readonly Observation[]): number[] {
  const den = obs.reduce((s, o) => s + o.n, 0);
  if (den === 0) return [];
  const r = obs.reduce((s, o) => s + o.y, 0) / den;
  const nBar = den / obs.length;
  return obs.map((o) => (o.y - r * o.n) / nBar + r);
}

/**
 * Per-block difference of two ratio metrics measured on the same block
 * indices (both sides saw the same deals), over their common prefix. Its
 * mean is the difference of the two ratios; shared deal luck cancels in its
 * variance.
 */
export function differenceSeries(
  left: readonly Observation[],
  right: readonly Observation[]
): number[] {
  const B = Math.min(left.length, right.length);
  const l = ratioSeries(left.slice(0, B));
  const r = ratioSeries(right.slice(0, B));
  if (l.length === 0 || r.length === 0) return [];
  return l.map((v, i) => v - r[i]!);
}

export interface Estimate {
  readonly mean: number;
  readonly se: number;
  readonly ciLow: number;
  readonly ciHigh: number;
  /** Blocks behind the estimate (the independent units). */
  readonly blocks: number;
}

/** Two-sided normal critical value for confidence 1 − alpha. */
export function zCritical(alpha: number): number {
  return normalQuantile(1 - alpha / 2);
}

/** Mean of a per-block series with a normal (1 − alpha) CI; NaN when empty. */
export function meanEstimate(series: readonly number[], alpha = 0.05): Estimate {
  const B = series.length;
  if (B === 0) return { mean: NaN, se: NaN, ciLow: NaN, ciHigh: NaN, blocks: 0 };
  const mean = series.reduce((s, v) => s + v, 0) / B;
  const se = B >= 2 ? Math.sqrt(series.reduce((s, v) => s + (v - mean) ** 2, 0) / (B - 1) / B) : 0;
  const half = zCritical(alpha) * se;
  return { mean, se, ciLow: mean - half, ciHigh: mean + half, blocks: B };
}

export interface RatioEstimate extends Estimate {
  /** Summed numerator and denominator — the logged counts behind the rate. */
  readonly num: number;
  readonly den: number;
}

/** A role's metric over blocks, with its logged numerator and denominator. */
export function ratioEstimate(obs: readonly Observation[], alpha = 0.05): RatioEstimate {
  const num = obs.reduce((s, o) => s + o.y, 0);
  const den = obs.reduce((s, o) => s + o.n, 0);
  return { ...meanEstimate(ratioSeries(obs), alpha), blocks: obs.length, num, den };
}
