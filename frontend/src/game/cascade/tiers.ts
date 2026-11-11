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
 * Geometric: `radius(n) = round(22 * 4 ^ (n / 10))`, so r0 = 22, r10 = 88 and the ratio between
 * tiers is about 1.149. The series continues to the capstone: r11 = 101. Why those ends: the bin
 * is 400 wide with 20 px walls, so 360 px of inner width. Two tier-10 pieces side by side need
 * 4 * 88 = 352 px, which fits (8 px to spare) and leaves them free to touch. The capstone is 202 px
 * across and fits. Droppable tiers are 0-4 (radius 22-38): the largest spawns at
 * `OVERFLOW_LINE_Y - r - inset`, its top edge at y = -1, so a spawn is on the canvas (a tier-5+
 * piece, which only the dev panel drops, spawns further above it). A first try with r0 = 15
 * (r10 = 85) made a game 2x longer: the spam bot took 100-123 s to lose where it took 35-46 s on
 * the old ladder, so the lid test's bound had no headroom; r0 = 22 puts it at 54-73 s.
 *
 * ## Scores
 *
 * Doubling: `score(n) = 2 ^ n`, awarded for the piece a merge makes (a merge into tier n scores
 * `2^n`). PROVISIONAL: the final values are set with the time-bonus story (#3700) so a win
 * dominates a long losing run.
 *
 * ## Density
 *
 * A multiplier on Matter's default body density (0.001), so 1 leaves the physics as it was. The
 * field lives here so the physics story (#3697) tunes it in one place; it is 1 for every tier now.
 */

export type TierSetId = "fruits" | "cosmos";

export interface TierDef {
  readonly tier: number;
  /** Collision radius, and the radius the piece is drawn at (world units). */
  readonly radius: number;
  /** Points for a merge that makes this tier. */
  readonly score: number;
  /** Multiplier on Matter's default density. */
  readonly density: number;
  /** True if the spawner may offer this tier. */
  readonly droppable: boolean;
  /** i18n key suffix per set: `cascade:pieces.<set>.<key>` is the piece's name in every locale. */
  readonly nameKeys: Readonly<Record<TierSetId, string>>;
}

export const TIER_COUNT = 12;
/** The capstone: never dropped, never merges. */
export const CAPSTONE_TIER = 11;

type Row = readonly [radius: number, nameKeyFruits: string, nameKeyCosmos: string];

const ROWS: readonly Row[] = [
  [22, "cherry", "moon"],
  [25, "blueberry", "pluto"],
  [29, "lemon", "mercury"],
  [33, "grape", "mars"],
  [38, "orange", "venus"],
  [44, "apple", "earth"],
  [51, "peach", "neptune"],
  [58, "coconut", "uranus"],
  [67, "dragonfruit", "saturn"],
  [77, "pineapple", "jupiter"],
  [88, "watermelon", "sun"],
  [101, "pumpkin", "milkyWay"],
];

/** Highest droppable tier (0-4 drop; unchanged from the 10-tier ladder). */
const MAX_DROPPABLE_TIER = 4;

export const TIERS: readonly TierDef[] = ROWS.map(([, fruits, cosmos], tier) => ({
  tier,
  radius: ROWS[tier]![0],
  score: 2 ** tier,
  density: 1,
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

/**
 * Half the side of the square a baked sprite is drawn into so the visible fruit has exactly the
 * collider's radius. `bakedClipR` is the sprite canvas half-size per unit of fruit radius.
 */
export function spriteHalfSize(tier: number, bakedClipR: number | undefined): number {
  return tierRadius(tier) * (bakedClipR ?? 1);
}
