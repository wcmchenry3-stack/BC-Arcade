import { FruitDefinition, FruitTier } from "../../theme/fruitSets.engine";
import type { GameEvent } from "./types";

export {
  PACKING_HEIGHT_FACTOR,
  BIN_WALL_RATIO,
  BIN_INNER_DIAMETERS,
  BIN_ASPECT_RATIO,
  calculateBinDimensions,
  calculateMergeCentroid,
  calculateTierRadius,
  packingTheoremClearance,
} from "./physicsLayout";
export type { Vec2 } from "./physicsLayout";

// --- Canonical physics world dimensions (px) ---
// Physics always runs at this fixed size. The renderer scales the canvas to fit
// the device container — see CascadeScreen for the scale computation.
export const WORLD_W = 400;
export const WORLD_H = 700;

// --- Layout constants ---
export const WALL_THICKNESS = 16;
/** 18% from top — game over if settled fruit crosses this */
export const DANGER_LINE_RATIO = 0.18;
export const GAME_OVER_GRACE_MS = 3000;
/** Consecutive ticks a settled fruit must be above the danger line before game-over fires. */
export const GAME_OVER_CONSECUTIVE_TICKS = 180;
/** Ticks after the last merge before game-over can fire — suppresses spurious loss mid-cascade. */
export const GAME_OVER_MERGE_COOLDOWN_TICKS = 90;

// --- Physics tuning constants ---
/** Low friction = fruits slide and settle naturally (spec: 0.05–0.1). */
export const FRUIT_FRICTION = 0.08;
/** Angular damping kills residual spin so fruits stop rotating after landing (UC1). */
export const FRUIT_ANGULAR_DAMPING = 0.05;
/** Air friction slows bodies in free-fall so they decelerate smoothly (UC1). */
export const FRUIT_FRICTION_AIR = 0.01;
/** Wall/floor friction (spec: ~0.2) — higher than fruit friction so fruits grip walls but slide freely on each other. */
export const WALL_FRICTION = 0.2;
/** Radial pop impulse applied to neighbors on merge: magnitude = nextTierRadius × this. Tunable. */
export const POP_IMPULSE_SCALE = 2.0;

// --- Per-tier physics (UC3) ---
// Density (matter-js pixel-area units): heavier for larger fruit so large tiers sink into piles.
// Tuple type ensures noUncheckedIndexedAccess won't widen to `number | undefined` for FruitTier indices.
export const FRUIT_DENSITY_BY_TIER: readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
] = [
  0.0005, // tier-0  (r=18)
  0.0006, // tier-1  (r=23)
  0.0007, // tier-2  (r=28)
  0.0008, // tier-3  (r=35)
  0.0009, // tier-4  (r=44)
  0.001, // tier-5  (r=55)
  0.0012, // tier-6  (r=69)
  0.0014, // tier-7  (r=86)
  0.0016, // tier-8  (r=107)
  0.0018, // tier-9  (r=134)
  0.002, // tier-10 (r=168)
];
// Restitution: smaller fruit bounce more; larger fruit thud and settle.
export const FRUIT_RESTITUTION_BY_TIER: readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
] = [
  0.5, // tier-0
  0.42, // tier-1
  0.35, // tier-2
  0.29, // tier-3
  0.24, // tier-4
  0.2, // tier-5
  0.16, // tier-6
  0.13, // tier-7
  0.1, // tier-8
  0.07, // tier-9
  0.05, // tier-10
];
/** Approach velocity (px/tick) below which restitution is suppressed — Matter.Resolver._restingThresh. */
export const RESTITUTION_THRESHOLD = 0.5;

// --- Matter.js gravity ---
// Equivalent to ~1800 px/s² at 60 Hz (matches Rapier GRAVITY_Y=18 × SCALE=0.01 × 1/SCALE).
// matter.js applies gravity as: velocity += gravity.y * gravity.scale per tick.
// Default gravity.scale = 0.001, so y=1.8 gives snappy arcade freefall.
export const MATTER_GRAVITY_Y = 1.8;

// --- Fixed physics timestep ---
/** Fixed physics sub-step duration (ms). Engine runs at 60 Hz regardless of frame rate. */
export const FIXED_STEP_MS = 1000 / 60;

// --- Solver iteration counts ---
// O(N × iterations) cost per step — raise to fix penetration in deep stacks,
// lower if the physics budget grows tight on low-end devices.
// Validated against 15-deep piles; these counts resolve cleanly without visible jitter.
/** Matter.js position correction iterations (default 6). 10 prevents jitter in deep stacks. */
export const MATTER_POSITION_ITERATIONS = 10;
/** Matter.js velocity correction iterations (default 4). 6 resolves constraint budget cleanly. */
export const MATTER_VELOCITY_ITERATIONS = 6;

// --- Body sleeping ---
/** Ticks of low velocity before a Matter.js body sleeps (spec: 30 ≈ 500 ms at 60 Hz). */
export const MATTER_SLEEP_THRESHOLD = 30;

// --- Terminal velocity guard ---
// CASCADE-PHYS-08 (Outcome C): tier-0 at 1200 px/s travels 20 px per 1/60s frame > WALL_THICKNESS (16 px).
// Lowering to 900 px/s caps travel at 15 px, making sub-stepping alone geometrically sufficient.
/** Max fruit speed in px/s. Capped so max travel per 1/60s sub-step (15 px) stays below WALL_THICKNESS (16 px). */
export const MAX_FRUIT_SPEED_PX_S = 900;

// --- Spawn grace period + warm spawn ---
/** Number of physics ticks a merge-spawned body is immune to dynamic-vs-dynamic collisions. */
export const SPAWN_GRACE_TICKS = 3;
/** Wall-clock duration of spawn grace (ms). Converted to ticks at spawn time based on actual step
 *  duration so 120 Hz ProMotion devices get the same wall-clock protection as 60 Hz. */
export const SPAWN_GRACE_MS = SPAWN_GRACE_TICKS * FIXED_STEP_MS; // ≈ 50 ms
/** Number of physics ticks over which a merge-spawned body grows from WARM_SPAWN_START_SCALE to 100% radius. */
export const WARM_SPAWN_FRAMES = 10;
/** Initial radius scale for merge-spawned bodies — starts at 50% to prevent explosive ejection. */
export const WARM_SPAWN_START_SCALE = 0.5;

// --- Collision group bitmasks ---
export const COLLISION_GROUP_WALL = 0x0001;
export const COLLISION_GROUP_DYNAMIC = 0x0002;

// --- Shared interfaces ---

export interface FruitBody {
  handle: number;
  fruitTier: FruitTier;
  fruitSetId: string;
  isMerging: boolean;
  createdAt: number;
  fruitRadius: number; // in pixels
  /** Normalized collision hull vertices in [-1, 1] per axis, matching sprite rendering.
   *  Multiply by fruitRadius to get pixel-space polygon. */
  collisionVerts: { x: number; y: number }[] | null;
  /** Ticks remaining in spawn-grace period (0 = normal; >0 = no dynamic-vs-dynamic collisions). */
  graceTicksRemaining: number;
}

export interface BodySnapshot {
  id: number;
  x: number; // pixels
  y: number; // pixels
  tier: number;
  angle: number; // radians
  /** Normalized collision vertices for debug overlay (null = circle fallback). */
  collisionVerts: { x: number; y: number }[] | null;
}

export interface MergeEvent {
  tier: FruitTier;
  x: number; // pixels
  y: number; // pixels
}

export interface EngineHandle {
  /**
   * Advance physics and return snapshots + any game events that fired.
   *
   * @param dt - Elapsed time in **seconds** since the last call. When omitted,
   *   defaults to exactly one 60 Hz sub-step (`FIXED_STEP_MS / 1000`). The engine
   *   breaks `dt` into fixed sub-steps of `FIXED_STEP_MS` ms and caps the total
   *   simulated time at 1/6 s to prevent a spiral-of-death after tab suspension.
   */
  step: (dt?: number) => { snapshots: BodySnapshot[]; events: GameEvent[] };
  /** Drop a fruit at the given pixel coordinates. */
  drop: (def: FruitDefinition, fruitSetId: string, x: number, y: number) => void;
  cleanup: () => void;
}

/** Legacy alias used by tests and components */
export type EngineSetup = EngineHandle;
