/**
 * Cascade feel proposals (#3697, phase 1): the difficulty levers, as parameters.
 *
 * Two levers the production code hard-codes, made tunable for the sim only:
 *   - the radius ladder (`../../tiers.ts`: `round(22 * 4 ^ (n / 10))`), here
 *     `round(r0 * (r10 / r0) ^ (n / 10))`, continued to the capstone the same way;
 *   - the spawn selector (`../../spawnSelector.ts`): base weights of the droppable tiers, the
 *     drought boost and the danger mode. `makeSelector` is the same algorithm with these numbers
 *     as inputs; with `PRODUCTION_DIFFICULTY` it returns exactly what `selectNextTier` returns
 *     for the same history and RNG (a test checks it), so a change in a proposal's numbers is
 *     a difficulty change, never an algorithm drift.
 *
 * Sim-only (under `sim/`, excluded from the app and from `knip --production`). If the owner
 * picks a proposal, #3697 phase 2 writes its numbers into `tiers.ts` / `spawnSelector.ts`.
 */
import { CAPSTONE_TIER } from "../../tiers";
import { DROUGHT_WINDOW } from "../../spawnSelector";

export interface Difficulty {
  /** Ladder ends: tier 0's and tier 10's radius (px). The capstone continues the series. */
  r0Px: number;
  r10Px: number;
  /**
   * Highest tier the spawner may offer (production 4). A higher one is only safe with radii
   * small enough that its spawn (`OVERFLOW_LINE_Y - r - 5`) keeps its top edge on the canvas.
   */
  maxDroppableTier: number;
  /** Base weight per droppable tier (tier -> weight; a tier without one weighs 0). */
  weights: Readonly<Record<number, number>>;
  /** Added to a droppable tier absent from the last `DROUGHT_WINDOW` drops. */
  droughtBoost: number;
  /** In danger (pile near the lid), tiers at or above this are scaled by `dangerPenalty`... */
  dangerTierThreshold: number;
  dangerPenalty: number;
  /** ...and tiers below it by this (1 = production: only the big tiers are suppressed). */
  dangerSmallBoost: number;
}

const STREAK_WINDOW = 4;

/** Today's numbers (`tiers.ts`, `spawnSelector.ts`). */
export const PRODUCTION_DIFFICULTY: Difficulty = {
  r0Px: 22,
  r10Px: 88,
  maxDroppableTier: 4,
  weights: { 0: 5, 1: 4, 2: 3, 3: 2, 4: 1 },
  droughtBoost: 3,
  dangerTierThreshold: 3,
  dangerPenalty: 0.2,
  dangerSmallBoost: 1,
};

/** The ladder radius of `tier` for these ends (0 for a tier outside the ladder). */
export function ladderRadius(d: Pick<Difficulty, "r0Px" | "r10Px">): (tier: number) => number {
  const table = Array.from({ length: CAPSTONE_TIER + 1 }, (_, n) =>
    Math.round(d.r0Px * (d.r10Px / d.r0Px) ** (n / 10))
  );
  return (tier) => table[tier] ?? 0;
}

export type TierSelector = (history: number[], isInDanger: boolean, rng: () => number) => number;

/** The tiers the spawner may offer under this difficulty: 0..maxDroppableTier. */
export function droppableTiers(d: Pick<Difficulty, "maxDroppableTier">): number[] {
  return Array.from({ length: d.maxDroppableTier + 1 }, (_, t) => t);
}

/** `selectNextTier` with the difficulty's numbers (same order of rules, same draw). */
export function makeSelector(d: Difficulty): TierSelector {
  const DROPPABLE_TIERS = droppableTiers(d);
  return (history, isInDanger, rng) => {
    const weights: Record<number, number> = { ...d.weights };
    const recent = history.slice(-DROUGHT_WINDOW);
    for (const tier of DROPPABLE_TIERS) {
      if (!recent.includes(tier)) weights[tier] = (weights[tier] ?? 0) + d.droughtBoost;
    }
    if (isInDanger) {
      for (const tier of DROPPABLE_TIERS) {
        if (tier >= d.dangerTierThreshold) {
          weights[tier] = Math.max(1, Math.round((weights[tier] ?? 1) * d.dangerPenalty));
        } else if (d.dangerSmallBoost !== 1) {
          weights[tier] = (weights[tier] ?? 0) * d.dangerSmallBoost;
        }
      }
    }
    if (history.length >= STREAK_WINDOW) {
      const tail = history.slice(-STREAK_WINDOW);
      const streakTier = tail[0];
      if (streakTier !== undefined && tail.every((t) => t === streakTier)) weights[streakTier] = 0;
    }
    const total = DROPPABLE_TIERS.reduce((s, t) => s + (weights[t] ?? 0), 0);
    let rand = rng() * total;
    for (const tier of DROPPABLE_TIERS) {
      rand -= weights[tier] ?? 0;
      if (rand <= 0) return tier;
    }
    return DROPPABLE_TIERS[DROPPABLE_TIERS.length - 1] ?? 0;
  };
}

/**
 * Expected cherry-equivalents per drop (a tier-n piece is 2^n Cherries) under the base weights
 * alone (no drought, no danger): the capstone is 2^11 = 2048 of them, so 2048 / this is the
 * fewest drops a perfect player needs.
 */
export function cherriesPerDrop(d: Difficulty): number {
  let w = 0;
  let v = 0;
  for (const t of droppableTiers(d)) {
    w += d.weights[t] ?? 0;
    v += (d.weights[t] ?? 0) * 2 ** t;
  }
  return w > 0 ? v / w : 0;
}
