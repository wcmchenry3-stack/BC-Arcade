/**
 * Precomputed probability tables for Yacht hold-EV lookups (GH #2025, story A1).
 *
 * Goals
 * ─────
 * • Provide O(1)-ish EV lookups for any (held dice, free count) combination.
 * • Exact computation for rollsRemaining = 1.
 * • Approximation for rollsRemaining = 2 (see notes below).
 * • Pure module: no React, no IO, no Math.random, no Date.now.
 *
 * Rolls-remaining = 1  (exact)
 * ───────────────────────────
 * For a given hold (keptValues, freeCount), the exact EV is:
 *
 *   EV = Σ_{outcome ∈ 6^freeCount} P(outcome) × maxImmediateScore(kept+outcome)
 *
 * Key optimisation: the dice faces are exchangeable (order doesn't matter for
 * scoring), so we precompute the *multiset* distribution of free dice at init
 * time — one entry per distinct (multiset of n faces, n=0..5).  This reduces
 * 6^5 = 7776 iterations to at most 252 multiset evaluations (for n=5).
 *
 * Rolls-remaining = 2  (approximation — "hold-fixed" two-step)
 * ─────────────────────────────────────────────────────────────
 * Exact 2-step expectimax requires integrating over all possible second-roll
 * rehold decisions, which is O(6^10) per query — rejected by the codebase
 * (see ai.ts comment at `holdHard`).
 *
 * Approximation used here: we model the second roll as rerolling the SAME
 * free dice again (hold-fixed).  Under this policy, having 2 rolls remaining
 * is equivalent to taking the maximum EV across the two independent 1-step
 * EVs:
 *
 *   EV2(held, free) = E[ max(score₁, score₂) ]
 *
 * where score₁ and score₂ are i.i.d draws from the same 1-step distribution.
 * This is computed as:
 *
 *   EV2 = Σ_{(m₁,m₂)} P(m₁)×P(m₂) × max(maxImmediate(kept+m₁), maxImmediate(kept+m₂))
 *
 * Complexity: (252)² ≈ 63k operations per query for n=5 free dice — tractable.
 *
 * This approximation underestimates the true EV because it ignores adaptive
 * rehold: a real player can change which dice they hold between rolls 1 and 2.
 * The direction is consistent: EV2 ≥ EV1 (two rolls are always at least as
 * good as one under any policy), which is verified by the sanity test.
 *
 * IMPORTANT: This module does NOT change holdStrategy / scoreStrategy.
 * It exposes building blocks for future consideration evaluators (story A3).
 */

import { GameState } from "./types";
import { UPPER_CATEGORIES } from "./engine";
import { maxImmediateScore } from "./aiHelpers";

// ─── Types ────────────────────────────────────────────────────────────────────

/** A multiset entry: an ordered tuple of die values (sorted ascending) + probability. */
interface MultisetEntry {
  /** Die values, sorted ascending (length = freeCount). */
  readonly values: readonly number[];
  /** Probability of this multiset outcome = (occurrences / 6^freeCount). */
  readonly prob: number;
}

// ─── Module-level lazy init state ─────────────────────────────────────────────

/**
 * multisetsByCount[n] — array of all multisets of n dice (1–6, with repetition),
 * each paired with its probability.  Indexed 0..5.
 */
let multisetsByCount: ReadonlyArray<readonly MultisetEntry[]> | null = null;

// ─── Lazy init ────────────────────────────────────────────────────────────────

/**
 * Initialise the multiset distribution tables.  Called automatically on first
 * use; safe to call multiple times (idempotent).
 */
export function initProbTables(): void {
  if (multisetsByCount !== null) return;

  const result: (readonly MultisetEntry[])[] = [];

  for (let n = 0; n <= 5; n++) {
    result.push(buildMultisets(n));
  }

  multisetsByCount = result;
}

/**
 * Build all multisets of length n from {1,2,3,4,5,6}, each with its
 * probability weight (count / 6^n).
 */
function buildMultisets(n: number): readonly MultisetEntry[] {
  if (n === 0) {
    return [{ values: Object.freeze([]), prob: 1 }];
  }

  const total = Math.pow(6, n);
  const entries: MultisetEntry[] = [];

  // Generate combinations with repetition via recursive enumeration.
  // We generate each multiset exactly once by always choosing the next
  // face ≥ the last chosen face (canonical sorted form).
  function recurse(remaining: number, minFace: number, current: number[]): void {
    if (remaining === 0) {
      // Count how many distinct orderings produce this multiset.
      const count = countPermutations(current);
      entries.push({
        values: Object.freeze([...current]),
        prob: count / total,
      });
      return;
    }
    for (let face = minFace; face <= 6; face++) {
      current.push(face);
      recurse(remaining - 1, face, current);
      current.pop();
    }
  }

  recurse(n, 1, []);
  return Object.freeze(entries);
}

/**
 * Count the number of distinct ordered permutations of an array where some
 * elements may repeat.  = n! / (c₁! × c₂! × … × cₖ!)
 */
function countPermutations(arr: readonly number[]): number {
  const n = arr.length;
  const faceCounts = new Map<number, number>();
  for (const v of arr) faceCounts.set(v, (faceCounts.get(v) ?? 0) + 1);

  let denom = 1;
  for (const cnt of faceCounts.values()) {
    denom *= factorial(cnt);
  }
  return factorial(n) / denom;
}

const FACTORIALS = [1, 1, 2, 6, 24, 120];
function factorial(n: number): number {
  return FACTORIALS[n] ?? 1;
}

// ─── Upper-subtotal helper ────────────────────────────────────────────────────

function upperSubtotal(scores: GameState["scores"]): number {
  let s = 0;
  for (const cat of UPPER_CATEGORIES) {
    const v = scores[cat];
    if (v !== null && v !== undefined) s += v;
  }
  return s;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Compute the exact expected score for a single-roll hold.
 *
 * The caller supplies the kept die values and a free-dice count; this function
 * averages maxImmediateScore over all possible free-dice outcomes.
 *
 * Complexity: O(|multisets[freeCount]|) — at most 252 iterations.
 * Requires lazy-init tables; calls initProbTables() automatically.
 *
 * @param keptValues  Values of the dice being kept (may be empty).
 * @param freeCount   Number of dice to be rerolled (0–5).
 * @param scores      Current scorecard (open categories matter for EV).
 * @returns Expected score (same semantics as evForHold in ai.ts).
 */
export function evForHold1Roll(
  keptValues: readonly number[],
  freeCount: number,
  scores: GameState["scores"]
): number {
  initProbTables();
  const tables = multisetsByCount!;
  const curUpper = upperSubtotal(scores);

  if (freeCount === 0) {
    return maxImmediateScore(keptValues, scores, curUpper);
  }

  const entries = tables[freeCount]!;
  let ev = 0;
  for (const entry of entries) {
    const combined = [...keptValues, ...entry.values];
    ev += entry.prob * maxImmediateScore(combined, scores, curUpper);
  }
  return ev;
}

/**
 * Approximate expected score for a two-roll hold (hold-fixed approximation).
 *
 * Approximation: both rolls keep the same free dice (the hold pattern does
 * not change between the two rolls).  The value is:
 *
 *   EV2 = E[max(score_roll1, score_roll2)]
 *
 * where score_roll1 and score_roll2 are i.i.d samples from the same 1-step
 * distribution.  Since we use the maximum of two independent draws, this
 * gives EV2 ≥ EV1 for the same hold pattern, providing the monotonicity
 * guarantee: having more rolls left can only help.
 *
 * The approximation underestimates the true 2-roll EV because it ignores
 * adaptive rehold decisions between rolls.  However it is O(252²) ≈ 63k
 * per query (for n=5 free dice) — tractable at decision time.
 *
 * @param keptValues  Values of the dice being kept.
 * @param freeCount   Number of dice to be rerolled.
 * @param scores      Current scorecard.
 * @returns Approximate expected score (≥ evForHold1Roll for same inputs).
 */
export function evForHold2Roll(
  keptValues: readonly number[],
  freeCount: number,
  scores: GameState["scores"]
): number {
  initProbTables();
  const tables = multisetsByCount!;
  const curUpper = upperSubtotal(scores);

  if (freeCount === 0) {
    // No free dice: already determined — same as 1-roll.
    return maxImmediateScore(keptValues, scores, curUpper);
  }

  const entries = tables[freeCount]!;

  // Precompute per-outcome scores to avoid re-scoring in the double loop.
  const scores1: number[] = entries.map((entry) => {
    const combined = [...keptValues, ...entry.values];
    return maxImmediateScore(combined, scores, curUpper);
  });

  // E[max(X₁, X₂)] where X₁ and X₂ are i.i.d with the multiset distribution.
  let ev = 0;
  for (let i = 0; i < entries.length; i++) {
    const pi = entries[i]!.prob;
    for (let j = 0; j < entries.length; j++) {
      const pj = entries[j]!.prob;
      ev += pi * pj * Math.max(scores1[i]!, scores1[j]!);
    }
  }
  return ev;
}

/**
 * Return the multiset distribution table for `freeCount` free dice.
 *
 * Exposed for testing and inspection; not needed for EV lookups.
 */
export function getMultisets(freeCount: number): readonly MultisetEntry[] {
  initProbTables();
  return multisetsByCount![freeCount]!;
}

/**
 * Return the number of distinct multisets for `freeCount` free dice.
 * = C(freeCount + 5, 5)  (stars-and-bars with 6 faces, 0-indexed 1..6).
 */
export function multisetCount(freeCount: number): number {
  initProbTables();
  return multisetsByCount![freeCount]!.length;
}
