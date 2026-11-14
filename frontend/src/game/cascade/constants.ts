// World dimensions
export const WORLD_WIDTH = 400;
export const WORLD_HEIGHT = 600;
export const WALL_THICKNESS = 20;
export const FLOOR_THICKNESS = 20;
export const OVERFLOW_LINE_Y = 80; // y from top: the lid (game-over line, #3694)

// Physics (#3697: planck.js 1.4.2, the owner's "3 lively" tuning). The engine works in world
// pixels and fixed steps; `physicsWorld.ts` converts to planck's metres and seconds.
/** Gravity, px/s^2 (Matter's old 2.5 x 0.001 per ms^2 = 2500 px/s^2: lively keeps today's). */
export const GRAVITY_PX_S2 = 2500;
/** World pixels per planck metre: radii 5-98 px are 0.1-1.96 m, inside Box2D's 0.1-10 m range. */
export const PX_PER_M = 50;
/**
 * Overlap tuning (#3904; owner: the overlap between pieces looks bad; the sim gates the deepest
 * overlap at 3 px median / 5 px p90). Each fixed step runs PHYSICS_SUBSTEPS planck steps of
 * FIXED_STEP_MS / PHYSICS_SUBSTEPS, each with these solver iterations, and planck's position
 * correction (Baumgarte) removes POSITION_BAUMGARTE of an overlap per pass instead of 0.2. The
 * deepest overlap of a skilled game fell from 9.4 px (median) to 2.5. The levers, what each did
 * and what it cost: docs/games/cascade.md#physics.
 */
export const PHYSICS_SUBSTEPS = 2;
/** Box2D solver iterations per planck step (#3697: 10 / 8 per fixed step). */
export const VELOCITY_ITERATIONS = 10;
export const POSITION_ITERATIONS = 20;
/** planck's `Settings.baumgarte`: the share of an overlap the position solver removes per pass. */
export const POSITION_BAUMGARTE = 0.35;

// Piece physics (lively)
export const PIECE_RESTITUTION = 0.2;
/**
 * Friction of pieces, walls and floor: low, so pieces shuffle into gaps (#3904: 0.2 to 0.12, which
 * gives back the packing the overlap fix took; lower still and the spam bot outlives the lid).
 */
export const PIECE_FRICTION = 0.12;
/** Air friction: velocity kept per fixed step is 1 - this (Matter's frictionAir; planck linear damping). */
export const PIECE_FRICTION_AIR = 0.01;
/** Rolling damping applied per fixed step after the solver (lively: 0, pieces roll freely). */
export const PIECE_ANGULAR_DAMPING = 0;
export const MAX_ANGULAR_VELOCITY = 0.3; // rad/step hard clamp

/**
 * Walls and floor are this thick, grown outward from the bin's inner faces (which stay at
 * WALL_THICKNESS / FLOOR_THICKNESS), and the walls reach WALLS_ABOVE_PX above the canvas, so no
 * piece can tunnel through or fall over them.
 */
export const BOUNDARY_THICKNESS = 200;
export const WALLS_ABOVE_PX = 600;

// CCD / spawn-overlap clamping — prevents explosive ejection on merge spawn
export const MAX_SPAWN_VELOCITY = 3; // px per fixed step

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
/**
 * Grace for the last dropped piece: it must be settled with its top edge at or above
 * HARD_STOP_Y for this many consecutive fixed steps (0.5 s) before the hard stop fires. A large
 * piece spawns with its top edge above the canvas and can touch a pile just under the lid while
 * still near spawn height; without this the hard stop ended the game instantly, with no countdown.
 */
export const HARD_STOP_SETTLE_TICKS = 30;

// Merge behavior (#3697, lively)
/** Upward kick of a merged piece, px per fixed step. */
export const MERGE_POP_IMPULSE = 0.4;
/**
 * Grow-in: a merged piece is made at its parents' radius and grows to its own over this many
 * fixed steps (267 ms; #3904: 8 to 16, so the solver keeps up with a big piece's growth and its
 * neighbours are eased aside instead of overlapped), so it never appears overlapping its
 * neighbours at full size.
 */
export const GROW_IN_STEPS = 16;
/**
 * Two same-tier pieces closer than this (px, gap between the circles) merge, checked every fixed
 * step: Box2D can rest two pieces a fraction of a pixel apart, which a player sees as touching.
 */
export const MERGE_GAP_PX = 1.5;
/**
 * Chain reach: a piece still growing in also merges with a same-tier piece its FULL radius would
 * touch (gap at full size up to this, px), without waiting to grow into it.
 */
export const CHAIN_REACH_PX = 2;

// Spawn selection — danger band above the overflow line that suppresses large-tier drops
export const DANGER_STACK_MARGIN = 80; // px below OVERFLOW_LINE_Y

// Combo detection — fixed physics steps after a drop within which merges count toward a combo
export const COMBO_WINDOW_TICKS = 120;
