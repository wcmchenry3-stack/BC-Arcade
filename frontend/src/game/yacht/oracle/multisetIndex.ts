/**
 * Yacht oracle — dice-multiset indexing + reroll transitions (#2243).
 *
 * Shipped (unlike solver.ts and the outer retrograde loop): this is pure
 * dice-probability combinatorics, not game-scoring logic, so there's no
 * rule-drift risk in reusing it at runtime — `optimalHoldEVs` needs the same
 * hold/reroll-transition structure the offline solver uses, just evaluated
 * for one specific dice roll instead of all 252 at once per scorecard state.
 *
 * Reuses `probTables.ts`'s multiset enumeration (`getMultisets`) — the exact
 * same dice-probability distributions the live AI's hold-EV already relies
 * on — rather than re-deriving them, so there's one probability model in the
 * codebase, not two that could quietly diverge.
 *
 * The expensive part is "for every dice multiset and every way to hold some
 * of it, what's the probability distribution over the resulting multiset
 * after rerolling the rest" — that computation is 100% independent of
 * scorecard state, so it's precomputed ONCE (`buildHoldOptions`) and reused
 * across every state the offline solver visits, and cached module-wide for
 * every runtime hold-EV query.
 */

import { getMultisets, multisetCount } from "../probTables";

// ---------------------------------------------------------------------------
// Canonical multiset indexing
// ---------------------------------------------------------------------------

export interface IndexedMultisets {
  /** Sorted dice values for each canonical multiset of this size. */
  readonly values: readonly (readonly number[])[];
  /** Probability of rolling each multiset (sums to 1 across the array). */
  readonly prob: readonly number[];
  /** Lookup from a sorted-values key (`values.join(",")`) to its index. */
  readonly indexOf: ReadonlyMap<string, number>;
}

/**
 * Canonical string key for a sorted dice-values array. Exported so other
 * modules that need to match against the same dice-multiset representation
 * (e.g. `regret.ts`'s hold-EV lookup) share this single definition instead of
 * risking a silently-drifting duplicate.
 */
export function keyOf(values: readonly number[]): string {
  return values.join(",");
}

function indexMultisets(size: number): IndexedMultisets {
  const entries = getMultisets(size);
  const values = entries.map((e) => e.values);
  const prob = entries.map((e) => e.prob);
  const indexOf = new Map<string, number>();
  values.forEach((v, i) => indexOf.set(keyOf(v), i));
  return { values, prob, indexOf };
}

/** Indexed multisets for sizes 0-5, built once and reused for the whole solve. */
export const MULTISETS_BY_SIZE: readonly IndexedMultisets[] = [0, 1, 2, 3, 4, 5].map(
  indexMultisets
);

/** The 252 size-5 multisets — every possible dice roll, canonicalized. */
export const MULTISETS5 = MULTISETS_BY_SIZE[5]!;

/** Index of a specific 5-dice roll within MULTISETS5, or undefined if malformed. */
export function indexOfDice(dice: readonly number[]): number | undefined {
  return MULTISETS5.indexOf.get(keyOf([...dice].sort((a, b) => a - b)));
}

// ---------------------------------------------------------------------------
// Sub-multiset (hold) enumeration
// ---------------------------------------------------------------------------

/**
 * All distinct sub-multisets of `values` reachable by choosing, for each
 * distinct face present, how many of its occurrences to keep (0..count).
 * This is the "hold decision" space — smaller and non-redundant compared to
 * enumerating 2^5 position-subsets directly (holding "either" of two equal
 * dice produces the same sub-multiset, so we don't double-count it).
 */
function enumerateSubMultisets(values: readonly number[]): number[][] {
  const faceCounts = new Map<number, number>();
  for (const v of values) faceCounts.set(v, (faceCounts.get(v) ?? 0) + 1);
  const faces = [...faceCounts.keys()].sort((a, b) => a - b);

  let results: number[][] = [[]];
  for (const face of faces) {
    const count = faceCounts.get(face)!;
    const next: number[][] = [];
    for (const partial of results) {
      for (let k = 0; k <= count; k++) {
        const withFace = [...partial];
        for (let i = 0; i < k; i++) withFace.push(face);
        next.push(withFace);
      }
    }
    results = next;
  }
  return results.map((r) => r.sort((a, b) => a - b));
}

// ---------------------------------------------------------------------------
// Hold transitions: for each multiset and each valid hold, the probability
// distribution over resulting (post-reroll) multisets.
// ---------------------------------------------------------------------------

export interface HoldTransition {
  /** Index into MULTISETS5 of the resulting 5-dice multiset. */
  readonly targetIndex: number;
  /** Probability of landing on this result, given this hold was chosen. */
  readonly weight: number;
}

export interface HoldOption {
  /** The dice values kept under this hold (sorted, length 0-5). */
  readonly keptValues: readonly number[];
  /** Number of dice kept; reroll count is 5 - keptValues.length. */
  readonly keptSize: number;
  readonly transitions: readonly HoldTransition[];
}

/**
 * For every one of the 252 size-5 multisets, every valid hold decision and
 * its resulting transition distribution. State-independent — computed once
 * and reused across every scorecard state the offline solver visits, and
 * cached (see oracle.ts's lazy singleton) for repeated runtime queries.
 */
export function buildHoldOptions(): readonly (readonly HoldOption[])[] {
  const result: HoldOption[][] = [];

  for (const dice of MULTISETS5.values) {
    const subMultisets = enumerateSubMultisets(dice);
    const options: HoldOption[] = [];

    for (const kept of subMultisets) {
      const rerollSize = 5 - kept.length;
      const rerollTable = MULTISETS_BY_SIZE[rerollSize]!;
      const transitions: HoldTransition[] = [];

      for (let i = 0; i < rerollTable.values.length; i++) {
        const rerolled = rerollTable.values[i]!;
        const combined = [...kept, ...rerolled].sort((a, b) => a - b);
        const targetIndex = MULTISETS5.indexOf.get(keyOf(combined));
        if (targetIndex === undefined) {
          throw new Error(
            `Combined multiset ${keyOf(combined)} not found in MULTISETS5 — indexing bug`
          );
        }
        transitions.push({ targetIndex, weight: rerollTable.prob[i]! });
      }

      options.push({ keptValues: kept, keptSize: kept.length, transitions });
    }

    result.push(options);
  }

  return result;
}

// Re-exported for callers that just want the raw counts (tests, docs).
export { multisetCount };
