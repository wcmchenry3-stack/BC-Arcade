/**
 * The Cascade tier ladder (#3695): the ONE table every other module reads.
 *
 * Physics radius, drawn radius, score, density and the droppable flag live here and nowhere
 * else. `pieceDefs.ts` (engine shapes), `theme/fruitSets.ts` (names + art), the board renderer,
 * the spawner, the preview, the dev panel and the i18n keys all derive from this table. A test
 * (`__tests__/tiers.test.ts`) fails if another module defines a per-tier radius, score or density
 * table: two parallel tables are what once drew the wrong fruit at the wrong size.
 *
 * ## The ladder (12 tiers, 0..11)
 *
 * Merging two pieces of tier n (n < 11) makes one of tier n + 1. Two tier-10 pieces make the
 * capstone (tier 11), which is never dropped and never merges further (the win itself is #3699).
 *
 * ## Radii
 *
 * Geometric (#3697, the owner's "3 lively" tuning): `radius(n) = round(R0 * (R10 / R0) ^ (n / 10))`
 * with R0 = 18 and R10 = 56, so the ratio between tiers is about 1.12 and the series continues to
 * the capstone: r11 = 63. Smaller and flatter than #3695's ladder (22 / 88 / 101) so the capstone
 * can be built in one session: holding a tier 10 while the second one is built (one piece of each
 * tier 0-10) covers about 25 % of the bin under the lid, against 53 % on the old ladder, where no
 * bot ever reached tier 10. Two tier-10 pieces side by side need 224 px of the 360 px inner width,
 * and the capstone (126 px across) fits. Droppable tiers are 0-5 (radius 18-32): the largest spawns
 * at `OVERFLOW_LINE_Y - r - inset`, its top edge at y = 11, on the canvas. Why 18 / 56 and not the
 * 16 / 52 the other two proposals used: on lively physics (low friction, bounce) the spam bot
 * outlived the lid's 120 s bound in 6-10 % of games on 16 / 52; 18 / 56 puts its longest game at
 * about 107-109 s (docs/research/CASCADE_FEEL_PROPOSALS.md).
 *
 * ## Scores
 *
 * Doubling: `score(n) = 2 ^ n`, awarded for the piece a merge makes (a merge into tier n scores
 * `2^n`). PROVISIONAL: the final values are set with the time-bonus story (#3700) so a win
 * dominates a long losing run.
 *
 * ## Density
 *
 * planck.js density per tier: `(r0 / r) ^ 0.5`, so mass grows as r^1.5 instead of r^2. The largest
 * mass ratio on the board (capstone : tier 0) is then 3.5^1.5 = 6.5 : 1 instead of 12 : 1, so a big
 * piece no longer drives small ones through each other (#3696). Only ratios matter to Box2D.
 */

export type TierSetId = "fruits" | "cosmos";

export interface TierDef {
  readonly tier: number;
  /** Collision radius, and the radius the piece is drawn at (world units). */
  readonly radius: number;
  /** Points for a merge that makes this tier. */
  readonly score: number;
  /** planck.js density (only the ratios between tiers matter). */
  readonly density: number;
  /** True if the spawner may offer this tier. */
  readonly droppable: boolean;
  /** i18n key suffix per set: `cascade:pieces.<set>.<key>` is the piece's name in every locale. */
  readonly nameKeys: Readonly<Record<TierSetId, string>>;
}

export const TIER_COUNT = 12;
/** The capstone: never dropped, never merges. */
export const CAPSTONE_TIER = TIER_COUNT - 1;

/** The ladder's ends (see "Radii" above): tier 0's and tier 10's radius, world px. */
const R0 = 18;
const R10 = 56;
/** Exponent of the density rule `(r0 / r) ^ DENSITY_EXPONENT`. */
const DENSITY_EXPONENT = 0.5;
/** Highest droppable tier (0-5 drop, #3697). */
const MAX_DROPPABLE_TIER = 5;

type Names = readonly [nameKeyFruits: string, nameKeyCosmos: string];

const NAMES: readonly Names[] = [
  ["cherry", "moon"],
  ["blueberry", "pluto"],
  ["lemon", "mercury"],
  ["grape", "mars"],
  ["orange", "venus"],
  ["apple", "earth"],
  ["peach", "neptune"],
  ["coconut", "uranus"],
  ["dragonfruit", "saturn"],
  ["pineapple", "jupiter"],
  ["watermelon", "sun"],
  ["pumpkin", "milkyWay"],
];

const ladderRadius = (tier: number): number => Math.round(R0 * (R10 / R0) ** (tier / 10));

export const TIERS: readonly TierDef[] = NAMES.map(([fruits, cosmos], tier) => ({
  tier,
  radius: ladderRadius(tier),
  score: 2 ** tier,
  density: (ladderRadius(0) / ladderRadius(tier)) ** DENSITY_EXPONENT,
  droppable: tier <= MAX_DROPPABLE_TIER,
  nameKeys: { fruits, cosmos },
}));

/** The tiers the spawner may offer. */
export const DROPPABLE_TIERS: readonly number[] = TIERS.filter((t) => t.droppable).map(
  (t) => t.tier
);

/** A tier's radius (0 for an unknown tier). */
export function tierRadius(tier: number): number {
  return TIERS[tier]?.radius ?? 0;
}

