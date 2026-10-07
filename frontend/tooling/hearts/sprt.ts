/**
 * Sequential probability ratio tests for the Hearts sim gate (#2238).
 *
 * Every check in the gate is a Wald SPRT on a per-block series from
 * metrics.ts (a rate, or a paired difference of two rates) between two
 * simple hypotheses about its mean:
 *
 *   H0: μ = μ0  — the behaviour the gate expects (no regression)
 *   H1: μ = μ1  — the behaviour it must catch
 *
 * The block means are close to normal, so the log-likelihood ratio after B
 * blocks with sum S is
 *
 *   LLR = (μ1 − μ0) · (2S − B(μ0 + μ1)) / (2σ̂²)
 *
 * with σ̂² the series' sample variance (a plug-in "generalised" SPRT, as
 * chess-engine test frameworks do for game-pair scores). The test stops as
 * soon as LLR ≥ ln((1 − β)/α) (accept H1: fail) or LLR ≤ ln(β/(1 − α))
 * (accept H0: pass), so a clear pass or fail needs far fewer games than a
 * fixed-N test with the same error rates. α is the false-fail rate, β the
 * rate of missing a real change of size |μ1 − μ0|.
 *
 * A test still undecided at the block cap is truncated: it takes the
 * hypothesis its LLR favours, i.e. fails exactly when the estimate is past
 * the midpoint (μ0 + μ1)/2. The report marks such results as truncated.
 */

export interface SprtParams {
  readonly mu0: number;
  readonly mu1: number;
  /** Probability of accepting H1 (failing) when H0 is true. */
  readonly alpha: number;
  /** Probability of accepting H0 (passing) when H1 is true. */
  readonly beta: number;
}

export type SprtDecision = "h0" | "h1" | "continue";

export interface SprtResult {
  readonly decision: SprtDecision;
  readonly llr: number;
  readonly lower: number;
  readonly upper: number;
  readonly blocks: number;
  /** Decided by the LLR's sign at the block cap rather than a boundary. */
  readonly truncated: boolean;
}

/** Wald's boundaries: accept H0 at or below `lower`, H1 at or above `upper`. */
export function sprtBounds(alpha: number, beta: number): { lower: number; upper: number } {
  if (!(alpha > 0 && alpha < 1 && beta > 0 && beta < 1)) {
    throw new RangeError(`sprtBounds: alpha and beta must be in (0, 1), got ${alpha}, ${beta}`);
  }
  return { lower: Math.log(beta / (1 - alpha)), upper: Math.log((1 - beta) / alpha) };
}

// A constant series has zero sample variance; the floor keeps the LLR finite
// (and decisive, which is right — there is no noise left to doubt).
const MIN_VARIANCE = 1e-12;

/** Gaussian LLR of H1 against H0 for a series, with plug-in variance. */
export function gaussianLlr(series: readonly number[], mu0: number, mu1: number): number {
  const B = series.length;
  if (B < 2) return 0;
  const sum = series.reduce((s, v) => s + v, 0);
  const mean = sum / B;
  const variance = Math.max(
    series.reduce((s, v) => s + (v - mean) ** 2, 0) / (B - 1),
    MIN_VARIANCE
  );
  return ((mu1 - mu0) * (2 * sum - B * (mu0 + mu1))) / (2 * variance);
}

/**
 * Evaluate an SPRT on the series so far. With `final` (the block cap has
 * been reached) an undecided test is truncated to the side its LLR favours.
 */
export function sprt(series: readonly number[], params: SprtParams, final = false): SprtResult {
  const { lower, upper } = sprtBounds(params.alpha, params.beta);
  const llr = gaussianLlr(series, params.mu0, params.mu1);
  const base = { llr, lower, upper, blocks: series.length };
  if (llr >= upper) return { ...base, decision: "h1", truncated: false };
  if (llr <= lower) return { ...base, decision: "h0", truncated: false };
  if (final) return { ...base, decision: llr > 0 ? "h1" : "h0", truncated: true };
  return { ...base, decision: "continue", truncated: false };
}

export type CheckStatus = "pass" | "fail" | "continue";

export interface TwoSidedResult {
  readonly status: CheckStatus;
  readonly low: SprtResult;
  readonly high: SprtResult;
}

/**
 * Non-regression in both directions: H0 μ = μ0 against H1 μ = μ0 − δ and,
 * separately, H1 μ = μ0 + δ, each at α/2. Fails as soon as either side
 * accepts its H1; passes once both have accepted H0.
 */
export function twoSidedSprt(
  series: readonly number[],
  mu0: number,
  delta: number,
  alpha: number,
  beta: number,
  final = false
): TwoSidedResult {
  const low = sprt(series, { mu0, mu1: mu0 - delta, alpha: alpha / 2, beta }, final);
  const high = sprt(series, { mu0, mu1: mu0 + delta, alpha: alpha / 2, beta }, final);
  const status: CheckStatus =
    low.decision === "h1" || high.decision === "h1"
      ? "fail"
      : low.decision === "h0" && high.decision === "h0"
        ? "pass"
        : "continue";
  return { status, low, high };
}
