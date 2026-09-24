/**
 * Yacht AI — Easy / Medium / Hard as handicapped reads off one optimal
 * engine (#2246, architecture decision #2269 / epic #2283).
 *
 * Every tier scores its options with the exact optimal-play oracle
 * (`oracle/`), valuing each move as
 *
 *     points banked now + foresight × (optimal expected points still to come)
 *
 * and then picks among the near-best options with a capped softmax:
 *
 * - `foresight` (λ) is the structural dial. λ = 1 is optimal play; λ = 0 is a
 *   greedy player who grabs the biggest score on the table and never plans
 *   for the upper bonus. It changes what the tier *understands*, so tiers
 *   stay distinct with all noise switched off.
 * - `temperature` (points) adds plausible slips: options are weighted by
 *   exp(−loss / T), so small misjudgements are common and big ones rare.
 * - `maxLoss` (points) caps the slips: an option more than this far below the
 *   tier's best is never taken. Holds whose best outcome can't beat banking
 *   the current roll are also excluded (e.g. any reroll of a made yacht, or
 *   rerolling one die of a made large straight); together with the cap, no
 *   tier ever breaks a made yacht or large straight it can score.
 *
 * Measured in the #2245 harness (mean final score, 2026-09-24 gate runs):
 * Easy 161.6–163.9, Medium 211.8–215.6, Hard 245.2–251.6 (pure optimal play
 * is ~254.5). See sim/gate.ts for the bands that guard these and
 * docs/ARCHITECTURE.md for the design.
 */

import { getRng, type Category } from "./engine";
import type { AiDifficulty, GameState } from "./types";
import { getHoldOptions, getOracleTable } from "./oracle/oracle";
import { computeArr0, computeHoldLayer } from "./oracle/microDp";
import { indexOfDice } from "./oracle/multisetIndex";
import { keyFromGameState, legalCategoriesFor, successorAfterScore } from "./oracle/stateKey";

export interface TierParams {
  /** λ in [0, 1]: weight on the optimal value still to come. */
  readonly foresight: number;
  /** Softmax temperature in points; 0 = always the tier's best option. */
  readonly temperature: number;
  /** Options more than this many points below the tier's best are never picked. */
  readonly maxLoss: number;
}

export const TIERS: Readonly<Record<AiDifficulty, TierParams>> = {
  easy: { foresight: 0, temperature: 3, maxLoss: 10 },
  medium: { foresight: 0.4, temperature: 1, maxLoss: 5 },
  hard: { foresight: 1, temperature: 0.5, maxLoss: 3 },
};

// ─── Option scoring ───────────────────────────────────────────────────────────

interface TurnLayers {
  /** Value of each 5-dice multiset if the tier scores it now. */
  readonly bankNow: Float64Array;
  /** Value of each multiset with one reroll still available. */
  readonly oneReroll: Float64Array;
}

// Per-turn DP layers depend only on (scorecard key, foresight), which is
// fixed for a whole turn, so each turn computes them once. A few entries
// cover two simulated players plus the live game.
const layerCache = new Map<string, TurnLayers>();
const LAYER_CACHE_SIZE = 8;

function turnLayers(key: number, foresight: number): TurnLayers {
  const cacheKey = `${key}:${foresight}`;
  const cached = layerCache.get(cacheKey);
  if (cached) return cached;
  const table = getOracleTable();
  const bankNow = computeArr0(key, (next) => foresight * table[next]!);
  const layers = { bankNow, oneReroll: computeHoldLayer(bankNow, getHoldOptions()) };
  if (layerCache.size >= LAYER_CACHE_SIZE) layerCache.delete(layerCache.keys().next().value!);
  layerCache.set(cacheKey, layers);
  return layers;
}

export interface ScoredHold {
  /** Dice values kept (sorted). Keeping all five means "stop and score". */
  readonly kept: readonly number[];
  readonly value: number;
  /** Excluded because it can't beat banking the current roll. */
  readonly dominated: boolean;
}

/**
 * Every distinct hold for `state`'s dice, valued for a tier with this
 * foresight. Call after a roll (rolls_used 1 or 2).
 */
export function scoreHolds(state: GameState, foresight: number): ScoredHold[] {
  const key = keyFromGameState(state.scores);
  const { bankNow, oneReroll } = turnLayers(key, foresight);
  const source = state.rolls_used === 2 ? bankNow : oneReroll;
  const diceIndex = indexOfDice(state.dice);
  if (diceIndex === undefined) throw new Error(`scoreHolds: invalid dice ${state.dice}`);
  const banked = bankNow[diceIndex]!;

  return getHoldOptions()[diceIndex]!.map((option) => {
    // Keeping every die ends the turn (the AI loop stops rolling), so its
    // value is banking now, not "hold everything and maybe reroll later".
    if (option.keptSize === 5) return { kept: option.keptValues, value: banked, dominated: false };
    let value = 0;
    let best = -Infinity;
    for (const t of option.transitions) {
      const v = source[t.targetIndex]!;
      value += t.weight * v;
      if (v > best) best = v;
    }
    return { kept: option.keptValues, value, dominated: best <= banked };
  });
}

export interface ScoredCategory {
  readonly category: Category;
  readonly value: number;
}

/** Every legal category for `state`'s dice (Joker-aware), valued for this foresight. */
export function scoreCategories(state: GameState, foresight: number): ScoredCategory[] {
  const key = keyFromGameState(state.scores);
  const table = getOracleTable();
  return legalCategoriesFor(key, state.dice).map((category) => {
    const { scoreDelta, nextKey } = successorAfterScore(key, category, state.dice);
    return { category, value: scoreDelta + foresight * table[nextKey]! };
  });
}

// ─── Selection ────────────────────────────────────────────────────────────────

/**
 * Index of the option to play: the best one at temperature 0, otherwise a
 * softmax draw over options within `maxLoss` of the best (and not
 * `excluded`). Draws from the engine RNG so seeded simulations replay.
 */
export function chooseOption(
  values: readonly number[],
  params: Pick<TierParams, "temperature" | "maxLoss">,
  excluded: (i: number) => boolean = () => false,
  rng: () => number = getRng()
): number {
  let best = -1;
  for (let i = 0; i < values.length; i++) {
    if (!excluded(i) && (best < 0 || values[i]! > values[best]!)) best = i;
  }
  if (best < 0) throw new Error("chooseOption: no eligible option");
  if (params.temperature <= 0) return best;

  const top = values[best]!;
  const weights = values.map((v, i) =>
    excluded(i) || top - v > params.maxLoss ? 0 : Math.exp((v - top) / params.temperature)
  );
  const total = weights.reduce((s, w) => s + w, 0);
  let r = rng() * total;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i]!;
    if (weights[i]! > 0 && r <= 0) return i;
  }
  return best;
}

/** Map a kept multiset back onto dice positions. */
function keptToMask(dice: readonly number[], kept: readonly number[]): boolean[] {
  const remaining = [...kept];
  return dice.map((d) => {
    const i = remaining.indexOf(d);
    if (i < 0) return false;
    remaining.splice(i, 1);
    return true;
  });
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Which dice to keep before the next roll. Call after each roll while
 * rolls_used is 1 or 2; true = keep that die. All five kept means the AI
 * stops rolling and scores.
 */
export function holdStrategy(state: GameState, difficulty: AiDifficulty): boolean[] {
  const params = TIERS[difficulty];
  const holds = scoreHolds(state, params.foresight);
  const pick = chooseOption(
    holds.map((h) => h.value),
    params,
    (i) => holds[i]!.dominated
  );
  return keptToMask(state.dice, holds[pick]!.kept);
}

/** The category to score the current dice in (always legal, Joker rules included). */
export function scoreStrategy(state: GameState, difficulty: AiDifficulty): Category {
  const params = TIERS[difficulty];
  const options = scoreCategories(state, params.foresight);
  return options[
    chooseOption(
      options.map((o) => o.value),
      params
    )
  ]!.category;
}
