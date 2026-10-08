/**
 * The one "new best" rule for every game (#2977, owner decision on epic #2950).
 *
 * A prior best of 0 (or any non-positive / non-finite value) means "no best on
 * record". The first completed game sets the best (`improved`) but is never a
 * "new best": that needs a previous best to have beaten (`isNewBest`).
 */
export interface BestResult {
  /** The best after this result: the better of `prior` and `value`. */
  readonly best: number;
  /** The stored best should be written: no prior best, or `value` beats it. */
  readonly improved: boolean;
  /** `value` beat an existing prior best. Never true for a first result. */
  readonly isNewBest: boolean;
}

export function bestOf(prior: number, value: number, lowerIsBetter: boolean): BestResult {
  const hasPrior = Number.isFinite(prior) && prior > 0;
  if (!hasPrior) return { best: value, improved: true, isNewBest: false };
  const beats = lowerIsBetter ? value < prior : value > prior;
  return beats
    ? { best: value, improved: true, isNewBest: true }
    : { best: prior, improved: false, isNewBest: false };
}
