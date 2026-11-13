/**
 * 2048 motion (#3689): how long each animation takes, in one module, so the sounds (#3690) can be
 * timed to the same numbers. Each stays under its story ceiling (checked in
 * `__tests__/motion.test.ts`).
 *
 * All times are from the moment the swipe's board is rendered (t = 0).
 *
 *   t = 0                   every tile starts sliding; the two tiles of a merge slide into each other
 *   t = SPAWN_AT_MS         the new tile starts to appear
 *   t = SLIDE_MS            the merging tiles meet: the merged tile appears and pops
 *   t = WIN_BEAT_MS         the 2048 win card (after the 2048 tile has formed and glowed)
 *   t = GAME_OVER_BEAT_MS   the game-over card (after the stuck board dims and shakes)
 *
 * Under Reduce Motion nothing animates: tiles jump to their cells, the score just changes, and
 * both cards show as soon as the move lands (docs/ACCESSIBILITY.md section 3).
 */

/** Every tile's slide to its new cell. */
export const SLIDE_MS = 100;

// The merged tile appears and pops as the two sources meet: at `SLIDE_MS`.
/** The merge pop: up to `MERGE_POP_SCALE`, then back. */
export const MERGE_POP_UP_MS = 70;
export const MERGE_POP_DOWN_MS = 70;
export const MERGE_POP_SCALE = 1.15;
/**
 * The whole merge pop, from the tiles meeting to the merged tile at rest.
 * @internal Exported for tests and offline tooling only; no production caller (knip --production, #3126).
 */
export const MERGE_POP_MS = MERGE_POP_UP_MS + MERGE_POP_DOWN_MS;

/**
 * The spawned tile starts to appear this long after the swipe: while the slide is still
 * finishing, so it is on screen well before the old ~100 ms. It grows from `SPAWN_FROM_SCALE`.
 */
export const SPAWN_AT_MS = 60;
export const SPAWN_FROM_SCALE = 0.4;
export const SPAWN_UP_MS = 90;
export const SPAWN_DOWN_MS = 70;
export const SPAWN_SCALE = 1.1;
/**
 * The whole spawn, from the swipe to the new tile at rest.
 * @internal Exported for tests and offline tooling only; no production caller (knip --production, #3126).
 */
export const SPAWN_MS = SPAWN_AT_MS + SPAWN_UP_MS + SPAWN_DOWN_MS;

/**
 * Time between a move and the next one: the board takes no second move until this has passed
 * (up to `MOVE_QUEUE_DEPTH` swipes made inside it wait their turn). A little over the slide, so
 * a queued move never starts on a tile that is still travelling.
 */
export const MOVE_LOCK_MS = 120;
/** Swipes made during the lock that are kept, to play one after another. */
export const MOVE_QUEUE_DEPTH = 2;

/** The score's "+N" floats up and fades (React Native `Animated`). */
export const SCORE_FLOAT_MS = 600;
export const SCORE_FLOAT_RISE_PX = 24;

/** The tile that wins the game. */
export const WIN_TILE_VALUE = 2048;
/** The win: the 2048 tile forms with a bigger pop and a glow, then the card. */
export const WIN_BEAT_MS = 1000;
export const WIN_POP_SCALE = 1.35;
export const WIN_POP_UP_MS = 180;
export const WIN_POP_DOWN_MS = 260;
/** The glow's flare, from the tiles meeting to it fading out. */
export const WIN_GLOW_MS = 700;

/** Game over: the stuck board dims with a small shake, then the card. */
export const GAME_OVER_BEAT_MS = 600;
/** The dim and the shake start together, after the last spawn has settled. */
export const GAME_OVER_DIM_AT_MS = 220;
export const GAME_OVER_DIM_MS = 250;
export const GAME_OVER_SHAKE_MS = 300;
/** How far the board shakes to each side. */
export const GAME_OVER_SHAKE_PX = 5;
/** How dark the stuck board goes (an overlay's opacity). */
export const GAME_OVER_DIM_OPACITY = 0.45;
