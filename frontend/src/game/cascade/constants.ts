// World dimensions
export const WORLD_WIDTH = 400;
export const WORLD_HEIGHT = 600;
export const WALL_THICKNESS = 20;
export const FLOOR_THICKNESS = 20;
export const OVERFLOW_LINE_Y = 80; // y from top: the lid (game-over line, #3694)

// Matter.js physics
export const GRAVITY_Y = 2.5;
export const GRAVITY_SCALE = 0.001; // Matter.js v0.20 gravity.scale fix

// Piece physics defaults
export const PIECE_RESTITUTION = 0.2;
export const PIECE_FRICTION = 0.5;
export const PIECE_FRICTION_AIR = 0.01;
export const PIECE_ANGULAR_DAMPING = 0.3;
export const MAX_ANGULAR_VELOCITY = 0.3; // rad/step hard clamp

// Sleep system — prevents microscopic wiggling on resting pieces
export const PIECE_SLEEP_THRESHOLD = 0.08; // motion = speed² + angularSpeed²; applied to Matter.Sleeping._motionSleepThreshold
export const PIECE_SLEEP_MIN_FRAMES = 10; // frames below threshold before sleeping; applied to body.sleepThreshold

// CCD / spawn-overlap clamping — prevents explosive ejection on merge spawn
export const MAX_SPAWN_VELOCITY = 3; // px per frame

// Simulation
export const FIXED_STEP_MS = 1000 / 60;
export const MAX_SUBSTEPS = 3;

// Game over: the lid (#3694). All counts are fixed physics steps (FIXED_STEP_MS), never frames
// or wall-clock time, so the rule runs the same at 60 and 120 Hz. See docs/games/cascade.md.
/** Fixed steps a settled piece must stay over the lid, without a break, to end the game (3 s). */
export const OVERFLOW_TICKS_THRESHOLD = 180;
/**
 * Merge grace: a merge involving a piece in the danger band (top edge at or above
 * OVERFLOW_LINE_Y + DANGER_STACK_MARGIN) resets the overflow count and pauses it for this many
 * fixed steps. A merge lower in the bin does nothing. Restore gets the same grace once.
 */
export const OVERFLOW_IGNORE_MERGE_TICKS = 60;
/**
 * "Settled" for the lid rule: a piece moving faster than this (px per fixed step, Matter's
 * `body.speed`) is in flight and is not counted (v1's ~8 px/step filter, #1615 / #1710).
 */
export const OVERFLOW_SETTLED_SPEED = 8;
/** Hard stop: a settled piece whose top edge reaches this y (the canvas top) ends the game. */
export const HARD_STOP_Y = 0;

// Merge behavior
export const MERGE_POP_IMPULSE = 0.4;

// Guard rail — horizontal tolerance (px) before firing; prevents triggering on wall-contact bodies.
// No tolerance is applied to the floor: falling pieces should be caught immediately.
export const GUARD_RAIL_HORIZONTAL_TOLERANCE = 1;

// Spawn selection — danger band above the overflow line that suppresses large-tier drops
export const DANGER_STACK_MARGIN = 80; // px below OVERFLOW_LINE_Y

// Combo detection — fixed physics steps after a drop within which merges count toward a combo
export const COMBO_WINDOW_TICKS = 120;
