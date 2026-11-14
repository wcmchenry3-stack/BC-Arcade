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
 * capstone (tier 11). Two capstones that touch are the win (#3904): both burst, and the engine
 * emits `win`. The capstone is never dropped.
 *
 * ## Radii
 *
 * One constant ratio for the whole ladder (#3904, owner pick "V1"): `radius(n) = R0 * K ^ n`,
 * unrounded, with R0 = 5 and K = (R11 / R0) ^ (1 / 11) = 1.31062..., so the capstone is exactly
 * R11 = 98 and every tier-to-tier ratio is exactly K. Big fruit feel big: the Pumpkin is about
 * half the bin's 360 px inner width across. At most three capstones fit under the lid (four need
 * r <= 97.2), so two can never sit side by side on the floor: the win is a diagonal or stacked
 * touch. Droppable tiers are 0-7 (radius 5-33.2); the largest spawns at
 * `OVERFLOW_LINE_Y - r - inset`, its top edge at y = 8.6, on the canvas. The cherry (5) is the
 * main lever on the win rate (more, smaller material) and draws about 9 pt across on a phone.
 * Measured in the sim (100 seeds, 10 min cap): skilled bot wins about 55 %, heuristic 24 %,
 * median time to win about 4 min; docs/games/cascade.md.
 *
 * ## Scores
 *
 * Doubling: `score(n) = 2 ^ n`, awarded for the piece a merge makes (a merge into tier n scores
 * `2^n`). The capstone pair that wins scores 2 x the capstone. PROVISIONAL: the final values are
 * set with the time-bonus story (#3700) so a win dominates a long losing run.
 *
 * ## Density
 *
 * planck.js density per tier: `(r0 / r) ^ 0.5` (#3697), so mass grows as r^1.5 instead of r^2.
 * On this ladder the capstone is 87 times a cherry (6.5 times on the old 18-63 one). #3904 tried
 * flattening it (exponent 0.75 to 1.37, 41 : 1 to 6.5 : 1), the owner's first lever on the
 * overlap: it cut the overlap less than the solver did and cost the skilled win rate most (heavy
 * pieces sinking through light ones is also what packs the pile), so it stays. Only ratios matter
 * to Box2D. The overlap fix is in the solver (`constants.ts`) and the draw inset below.
 *
 * ## Drawn radius (#3904)
 *
 * A piece is drawn DRAW_INSET (1.5 %) smaller than its collider: `drawnRadius = radius * (1 -
 * DRAW_INSET)`. It is the last of the owner's overlap levers, used because the solver alone left
 * the skilled games' p90 deepest overlap at 5.2 px against the 5 px gate; it takes 0.15 px off a
 * pair of cherries and 2.9 px off a pair of capstones. Everything that draws a piece (the board,
 * the art bitmaps, the spawner) reads `drawnRadius`; the physics, the lid, the spawn and the merges
 * read `radius`.
 */

export type TierSetId = "fruits" | "cosmos";

export interface TierDef {
  readonly tier: number;
  /** Collision radius (world units): physics, lid, spawn, merges. */
  readonly radius: number;
  /** The radius the piece is drawn at: `radius * (1 - DRAW_INSET)` (#3904). */
  readonly drawnRadius: number;
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
/** The capstone: never dropped; two that touch are the win (#3904). */
export const CAPSTONE_TIER = TIER_COUNT - 1;

/** The ladder's ends (see "Radii" above): tier 0's and the capstone's radius, world px. */
const R0 = 5;
const R11 = 98;
/** The one tier-to-tier ratio: R0 * K ^ 11 = R11. */
const K = (R11 / R0) ** (1 / CAPSTONE_TIER);
/** Exponent of the density rule `(r0 / r) ^ DENSITY_EXPONENT` (see "Density" above). */
const DENSITY_EXPONENT = 0.5;
/** How much smaller a piece is drawn than its collider (#3904: see "Drawn radius" above). */
export const DRAW_INSET = 0.015;
/** Highest droppable tier (0-7 drop, #3904). */
const MAX_DROPPABLE_TIER = 7;

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

const ladderRadius = (tier: number): number => R0 * K ** tier;

export const TIERS: readonly TierDef[] = NAMES.map(([fruits, cosmos], tier) => ({
  tier,
  radius: ladderRadius(tier),
  drawnRadius: ladderRadius(tier) * (1 - DRAW_INSET),
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

/** A tier's drawn radius (0 for an unknown tier, #3904). */
export function tierDrawnRadius(tier: number): number {
  return TIERS[tier]?.drawnRadius ?? 0;
}
