/**
 * Cascade sim harness: configuration seam (#2893).
 *
 * The harness drives the real `CascadeEngine` and the real spawn selector/queue. To compare a
 * candidate physics set later (#3696 spike, #3697), a run takes:
 *   - `createEngine`: a factory for any engine with the `SimEngine` surface (the real class
 *     today, a variant tomorrow);
 *   - `constants`: overrides for what the SIM reads (world size, lid line, drawn and physics
 *     radius per tier, score per tier, droppable tiers).
 * `constants` configures the sim and its metrics only. The real engine reads its tuning from
 * `../constants.ts` at import time, so a candidate engine brings its own numbers and the same
 * numbers are passed here so the metrics measure it correctly.
 */
import { CascadeEngine } from "../engine";
import {
  DANGER_STACK_MARGIN,
  FIXED_STEP_MS,
  FLOOR_THICKNESS,
  OVERFLOW_LINE_Y,
  WALL_THICKNESS,
  WORLD_HEIGHT,
  WORLD_WIDTH,
} from "../constants";
import { DROPPABLE_PIECE_TIERS, MAX_TIER, PIECE_DEFS } from "../pieceDefs";
import { createSeededRng, type RandomSource } from "../../_shared/seededRng";

/** The slice of the engine the sim uses. `CascadeEngine` satisfies it. */
export type SimEngine = Pick<
  CascadeEngine,
  "step" | "drop" | "canDrop" | "getState" | "restore" | "destroy"
>;

export interface SimConstants {
  worldWidth: number;
  worldHeight: number;
  wallThickness: number;
  floorThickness: number;
  /** The lid: y of the game-over line. */
  lidY: number;
  /** A piece higher than lidY + dangerMargin puts the spawn selector in its danger mode. */
  dangerMargin: number;
  /** The engine's fixed physics step (ms); converts px per step to px per second. */
  fixedStepMs: number;
  maxTier: number;
  droppableTiers: number[];
  /** Radius the physics uses (contact test). */
  physicsRadius: (tier: number) => number;
  /** Radius the player sees (visible gap, packing density). Equal to physics today. */
  drawnRadius: (tier: number) => number;
  scoreValue: (tier: number) => number;
}

function physicsRadiusOf(tier: number): number {
  const shape = PIECE_DEFS[tier]!.shape;
  return shape.kind === "circle" ? shape.radius : shape.boundingRadius;
}

export const DEFAULT_CONSTANTS: SimConstants = {
  worldWidth: WORLD_WIDTH,
  worldHeight: WORLD_HEIGHT,
  wallThickness: WALL_THICKNESS,
  floorThickness: FLOOR_THICKNESS,
  lidY: OVERFLOW_LINE_Y,
  dangerMargin: DANGER_STACK_MARGIN,
  fixedStepMs: FIXED_STEP_MS,
  maxTier: MAX_TIER,
  droppableTiers: DROPPABLE_PIECE_TIERS,
  physicsRadius: physicsRadiusOf,
  // The drawn radius is the physics radius today; #3697 may separate them.
  drawnRadius: physicsRadiusOf,
  scoreValue: (tier) => PIECE_DEFS[tier]!.scoreValue,
};

export interface SimConfig {
  createEngine?: () => SimEngine;
  constants?: Partial<SimConstants>;
}

export function resolveConstants(config?: SimConfig): SimConstants {
  return { ...DEFAULT_CONSTANTS, ...(config?.constants ?? {}) };
}

export function resolveEngine(config?: SimConfig): SimEngine {
  return config?.createEngine ? config.createEngine() : new CascadeEngine({});
}

/** The two frame rates every run is done at (#1419: ProMotion broke 60-Hz-only assumptions). */
export const FRAME_RATES_HZ = [60, 120] as const;
export type FrameRateHz = (typeof FRAME_RATES_HZ)[number];

/** Independent RNG streams per seed, so a bot's choices never shift the piece sequence. */
export type RngStream = "queue" | "bot";
const STREAM_SALT: Record<RngStream, number> = { queue: 0x9e3779b1, bot: 0x85ebca6b };

/**
 * A seeded generator for one stream. The shared LCG's first draws of adjacent seeds are almost
 * equal, so the seed is mixed (murmur3 finaliser) and a few draws are discarded first.
 */
export function streamRng(seed: number, stream: RngStream): RandomSource {
  let h = (seed ^ STREAM_SALT[stream]) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  const rng = createSeededRng(h);
  for (let i = 0; i < 4; i++) rng();
  return rng;
}
