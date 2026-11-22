/**
 * Daily Word motion (#3664): how long each animation takes, in one module, so the sounds (#3665)
 * can be timed to the same numbers. Each stays under its story ceiling (checked in
 * `__tests__/motion.test.ts`).
 *
 * Under Reduce Motion nothing animates: a letter just appears, a row's colours just change, a
 * refusal only shows its toast, and the result card follows the last row at once.
 */

/** A typed letter's tile pops (scales up and back). */
export const TYPE_POP_MS = 110;
/** How far it scales at the top of the pop. */
export const TYPE_POP_SCALE = 1.1;
/** A deleted letter's tile gives a small inward pulse. */
export const DELETE_PULSE_MS = 70;

/** Half of a tile's flip (it turns top-to-bottom; the colour changes at the midpoint). */
export const FLIP_HALF_MS = 150;
/** Each tile in a row starts its flip this long after the one before. */
export const TILE_STAGGER_MS = 100;

/** A refused guess shakes its row. */
export const SHAKE_MS = 360;

/** The win dance: each tile of the solved row hops, starting this long after the one before. */
export const WIN_HOP_STAGGER_MS = 70;
/** One tile's hop, up and back. */
export const WIN_HOP_MS = 240;
/** The sparkle burst over the board, from the dance's start. */
export const WIN_SPARKLE_MS = 1100;

/** The loss: the answer's tiles flip in one by one, this long apart. */
export const LOSS_REVEAL_STAGGER_MS = 120;

/** A row of `n` tiles: the time from its first tile starting to flip to its last finishing. */
export function rowFlipMs(n: number): number {
  return Math.max(0, n - 1) * TILE_STAGGER_MS + 2 * FLIP_HALF_MS;
}

/** The win dance for `n` tiles: from the first hop to the last landing. */
export function winDanceMs(n: number): number {
  return Math.max(0, n - 1) * WIN_HOP_STAGGER_MS + WIN_HOP_MS;
}

/** How long the result card waits after a winning row's flip: the dance and the sparkle. */
export function winCelebrationMs(n: number): number {
  return Math.max(winDanceMs(n), WIN_SPARKLE_MS);
}

/** How long the loss reveal takes for an answer of `n` letters (the card follows it). */
export function lossRevealMs(n: number): number {
  return Math.max(0, n - 1) * LOSS_REVEAL_STAGGER_MS + 2 * FLIP_HALF_MS;
}
