// World dimensions
export const WORLD_WIDTH = 400;
export const WORLD_HEIGHT = 600;
export const WALL_THICKNESS = 20;
export const FLOOR_THICKNESS = 20;
export const OVERFLOW_LINE_Y = 80; // y from top; game-over trigger line

// Matter.js physics
export const GRAVITY_Y = 5.0;
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

// Anti-jitter — informational; Matter.Resolver._restingThresh is not a public API in v0.20
export const PIECE_RESTITUTION_THRESHOLD = 0.001;

// CCD / spawn-overlap clamping — prevents explosive ejection on merge spawn
export const MAX_SPAWN_VELOCITY = 3; // px per frame

// Simulation
export const FIXED_STEP_MS = 1000 / 60;
export const MAX_SUBSTEPS = 3;

// Game-over detection
export const OVERFLOW_TICKS_THRESHOLD = 180;
export const OVERFLOW_IGNORE_MERGE_TICKS = 60;

// Merge behavior
export const MERGE_POP_IMPULSE = 0.8;
