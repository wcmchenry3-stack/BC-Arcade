/**
 * The Cascade tier ladder (#3695): the ONE table every other module reads.
 *
 * Physics radius, drawn radius, score, density and the droppable flag live here and nowhere
 * else. `pieceDefs.ts` (engine shapes), `theme/fruitSets.ts` (names + art), the board renderer,
 * the spawner, the preview, the dev panel and the i18n keys all derive from this table. A test
 * (`__tests__/tiers.test.ts`) fails if another module defines a per-tier radius, score or density
 * table: two parallel tables are what once drew the wrong fruit at the wrong size.
 *
 * ## The ladder (11 tiers, 0..10; #3920)
 *
 * Merging two pieces of tier n (n < 10) makes one of tier n + 1. Two tier-9 pieces make the
 * capstone (tier 10, Pumpkin / Milky Way), and making it is the win (#3920): the engine emits
 * `win` and play ends. The capstone is never dropped. #3920 removed the Peach (Fruits) and the
 * Moon (Cosmos) from #3904's 12-tier ladder.
 *
 * ## Radii
 *
 * One constant ratio for the whole ladder (#3920, owner decision after the playtest of #3904's
 * V1): `radius(n) = R0 * K ^ n`, unrounded, with R0 = 11.5 and K = (R10 / R0) ^ (1 / 10) =
 * 1.2389..., so the capstone is exactly R10 = 98 and every tier-to-tier ratio is exactly K. The
 * Cherry / Pluto is about 6.4 % of the bin's 360 px inner width across (about 21 pt on a 390 pt
 * phone), the share of the owner's reference game; the Pumpkin stays about half the bin. Droppable
 * tiers are 0-5 (radius 11.5-33.6). Measured in the sim as shipped (100 seeds, 10 min cap):
 * skilled bot wins about 59 %, heuristic about 38 %, median time to win about 3.5-4 min;
 * docs/games/cascade.md. (#3904's V1 was R0 = 5 on 12 tiers with a two-capstone win.)
 *
 * ## Scores
 *
 * Doubling: `score(n) = 2 ^ n`, awarded for the piece a merge makes (a merge into tier n scores
 * `2^n`). The winning merge into the capstone scores like any other merge, no extra (#3920).
 * PROVISIONAL: the final values are set with the time-bonus story (#3700) so a win dominates a
 * long losing run.
 *
 * ## Density
 *
 * planck.js density per tier: `(r0 / r) ^ 0.5` (#3697), so mass grows as r^1.5 instead of r^2.
 * On this ladder the capstone is 24.9 times a cherry (87 on #3904's 5-98 ladder, 6.5 on the old
 * 18-63 one). #3904 tried flattening it (exponent 0.75 to 1.37, 41 : 1 to 6.5 : 1), the owner's
 * first lever on the overlap: it cut the overlap less than the solver did and cost the skilled win rate most (heavy
 * pieces sinking through light ones is also what packs the pile), so it stays. Only ratios matter
 * to Box2D. The overlap fix is in the solver (`constants.ts`) and the draw inset below.
 *
 * ## Drawn radius (#3904)
 *
 * A piece is drawn DRAW_INSET (1.5 %) smaller than its collider: `drawnRadius = radius * (1 -
 * DRAW_INSET)`. It is the last of the owner's overlap levers, used because the solver alone left
 * the skilled games' p90 deepest overlap at 5.2 px against the 5 px gate; it takes 0.35 px off a
 * pair of cherries and 2.9 px off a pair of capstones (#3920 ladder). Everything that draws a
 * piece (the board, the art bitmaps, the spawner) reads `drawnRadius`; the physics, the lid, the
 * spawn and the merges read `radius`.
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

export const TIER_COUNT = 11;
/** The capstone: never dropped; making one is the win (#3920). */
export const CAPSTONE_TIER = TIER_COUNT - 1;

/** The ladder's ends (see "Radii" above): tier 0's and the capstone's radius, world px. */
const R0 = 11.5;
const R10 = 98;
/** The one tier-to-tier ratio: R0 * K ^ 10 = R10. */
const K = (R10 / R0) ** (1 / CAPSTONE_TIER);
/** Exponent of the density rule `(r0 / r) ^ DENSITY_EXPONENT` (see "Density" above). */
const DENSITY_EXPONENT = 0.5;
/** How much smaller a piece is drawn than its collider (#3904: see "Drawn radius" above). */
export const DRAW_INSET = 0.015;
/** Highest droppable tier (0-5 drop, #3920). */
const MAX_DROPPABLE_TIER = 5;

type Names = readonly [nameKeyFruits: string, nameKeyCosmos: string];

const NAMES: readonly Names[] = [
  ["cherry", "pluto"],
  ["blueberry", "mercury"],
  ["lemon", "mars"],
  ["grape", "venus"],
  ["orange", "earth"],
  ["apple", "neptune"],
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
