/**
 * Shared types for the utility-AI architecture.
 *
 * These are the shared contracts used by the Hearts and Yacht computer players:
 * a state parser builds an InformationSet, consideration evaluators score each
 * legal action, a weight broker multiplies those scores by persona weights, and
 * a decision selector picks the best (or stochastically samples from the top-K).
 *
 * See issues #2022 (utility-AI epic) and #2024 (shared type interfaces).
 */

/**
 * A base marker interface for read-only decision snapshots.
 *
 * Each game's information set must extend this and declare a discriminant
 * `kind` field (e.g., "hearts", "yacht") so that code can safely narrow
 * types at runtime.
 */
export interface InformationSet {
  readonly kind: string;
}

/**
 * A pure scoring function for evaluating one legal action in a given state.
 *
 * Implementations MUST be pure and deterministic: same input always yields
 * the same output. The returned score is a "consideration" — a quantified
 * preference that will be multiplied by persona-specific weights and aggregated
 * to produce a final decision score.
 *
 * **Normalization contract:** The score must be in the range [0.0, 1.0], where:
 * - 0.0 means the action is highly undesirable in the given state.
 * - 1.0 means the action is highly desirable in the given state.
 * - Intermediate values reflect relative preference.
 *
 * @template TInfoSet The information set type (state snapshot).
 * @template TAction The action type being evaluated.
 */
export type Consideration<TInfoSet extends InformationSet, TAction> = (
  infoSet: TInfoSet,
  action: TAction
) => number;

/**
 * A read-only map of non-negative weights, one per consideration dimension.
 *
 * Each weight is a non-negative multiplier applied to the corresponding
 * consideration score. A weight of 0 disables that consideration; higher
 * weights amplify its influence on the final decision. One map is defined
 * per difficulty level or personality archetype (e.g., "aggressive", "cautious").
 *
 * @template TKey The string key naming each consideration dimension.
 */
export type WeightMap<TKey extends string> = Readonly<Record<TKey, number>>;

/**
 * A candidate action together with its final weighted-sum decision score.
 *
 * The score is computed by evaluating all relevant considerations for this
 * action and summing their outputs after applying personality weights. The
 * decision selector (pick-best, pick-top-K, sample, etc.) uses these scored
 * candidates to choose which action to execute.
 */
export interface DecisionCandidate<TAction> {
  readonly action: TAction;
  readonly score: number;
}
