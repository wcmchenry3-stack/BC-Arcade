/**
 * Sort's per-level stars (#3687): 1 to 3 for a solve, judged against the
 * level's `par` (the catalog's target move count, #2761). Undo costs nothing:
 * only the move count decides (undos are still recorded on the result).
 *
 * The thresholds live here and nowhere else:
 *   3 stars: moves <= par
 *   2 stars: moves <= ceil(par x 1.25)
 *   1 star:  anything else
 *
 * A level's best stars are not stored: they are derived from its best moves
 * (`@sort/best_moves`) and its par, so there is one copy of the truth and a
 * save from before stars needs no migration.
 *
 * Pure data. No React, no side effects.
 */
import type { BestMoves } from "./storage";

export type Stars = 1 | 2 | 3;
/** A level's best stars; 0 is a level not solved yet. */
export type BestStars = 0 | Stars;

export const MAX_STARS = 3;

/** The 2-star margin over par is 25%, as a ratio (5 / 4) kept in integers. */
const TWO_STAR_NUMERATOR = 5;
const TWO_STAR_DENOMINATOR = 4;

/** The most moves that still earn 2 stars: ceil(par x 1.25). */
export function twoStarMoves(par: number): number {
  return Math.ceil((par * TWO_STAR_NUMERATOR) / TWO_STAR_DENOMINATOR);
}

/** The stars a solve in `moves` earns on a level with target `par`. */
export function starsFor(moves: number, par: number): Stars {
  if (moves <= par) return 3;
  if (moves <= twoStarMoves(par)) return 2;
  return 1;
}

/** A level's best stars, derived from its best moves; 0 when unsolved (or `par` is unknown). */
export function bestStarsFor(
  bests: BestMoves,
  levelId: number,
  par: number | undefined
): BestStars {
  const best = bests[String(levelId)];
  if (typeof best !== "number" || par === undefined) return 0;
  return starsFor(best, par);
}
