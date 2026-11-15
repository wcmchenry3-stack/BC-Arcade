/**
 * #3699: the win celebration's timeline (owner pick 2026-11-15: proposal A "Spotlight", with
 * proposal C's cheering face). Pure numbers, no Skia and no React, so the timings are unit-tested
 * and the same functions run on the UI thread (they are worklets) inside the board's Picture
 * (`render/drawCelebration.ts`).
 *
 * The clock `t` is milliseconds since the win event. From 0 to `CELEBRATION_START_MS` the real
 * capstone grows in (the engine's grow-in, `winTail.ts` keeps the loop running for it); the
 * celebration draws from there on:
 *
 * | ms        | Motion                                                                 |
 * | --------- | ---------------------------------------------------------------------- |
 * | 400-700   | the pile dims (to `DIM_MAX`)                                            |
 * | 400-850   | the capstone rises to the board centre, scaling to `LIFT_SCALE`        |
 * | 450-900   | the glow and gold ring grow in; the rays / galaxy swirl fade in, turn  |
 * | 700-850   | the cheering face replaces the capstone's own                          |
 * | 700-1900  | twinkles over the dimmed pile                                          |
 * | 850-1950  | two pulses of +-5 %, settling                                          |
 * | 2100      | the result card (`CELEBRATION_CARD_MS`)                                |
 *
 * Reduce Motion: no rise, rotation, pulse, rays, swirl or twinkles. The dim, glow, ring and
 * cheering face fade in where the capstone lies (400-600), and the card comes at 1600
 * (`CELEBRATION_CARD_MS_REDUCED`).
 */
import { FLOOR_THICKNESS, OVERFLOW_LINE_Y, WORLD_HEIGHT, WORLD_WIDTH } from "./constants";

/** The celebration starts here: the capstone has grown in and the loop has stopped. */
export const CELEBRATION_START_MS = 400;
/** When the result card shows, with motion. */
export const CELEBRATION_CARD_MS = 2100;
/** When the result card shows, under Reduce Motion. */
export const CELEBRATION_CARD_MS_REDUCED = 1600;
/** The capstone's size at the board centre, over its size in the pile. */
export const LIFT_SCALE = 1.32;
/** The pulses' amplitude, of the capstone's size. */
export const PULSE_AMPLITUDE = 0.05;
/** The dim over the pile, at its strongest. */
export const DIM_MAX = 0.68;
/** Where the capstone rises to: the middle of the bin under the lid (world units). */
export const CELEBRATION_TARGET = {
  x: WORLD_WIDTH / 2,
  y: (OVERFLOW_LINE_Y + WORLD_HEIGHT - FLOOR_THICKNESS) / 2,
} as const;
/** Twinkles over the dimmed pile, and the stars of the Cosmos galaxy swirl. */
export const TWINKLE_COUNT = 26;
export const SWIRL_COUNT = 90;
/** Floats per twinkle (x, y, start ms, size) and per swirl star (arm, u, offset, size). */
export const TWINKLE_STRIDE = 4;
export const SWIRL_STRIDE = 4;
/** Sun rays (Fruits) around the capstone. */
export const RAY_COUNT = 12;
/** Each ray's angular width (radians). */
export const RAY_WIDTH = 0.13;

/** When the card shows: `CELEBRATION_CARD_MS`, or the Reduce Motion one. */
export function celebrationCardMs(reduceMotion: boolean): number {
  return reduceMotion ? CELEBRATION_CARD_MS_REDUCED : CELEBRATION_CARD_MS;
}

/**
 * How long until the card, `elapsedMs` into the celebration (0 once it is due). Used when Reduce
 * Motion changes mid-celebration: the clock carries on at the same `t` on the other timeline.
 */
export function celebrationRemainingMs(elapsedMs: number, reduceMotion: boolean): number {
  return Math.max(0, celebrationCardMs(reduceMotion) - Math.max(0, elapsedMs));
}

/** What one frame of the celebration draws (filled in place, see `celebrationPose`). */
export interface CelebrationPose {
  /** The dim's opacity over the pile (0..DIM_MAX). */
  dim: number;
  /** How far the capstone has risen to the centre (0..1, overshooting a little: easeOutBack). */
  lift: number;
  /** The capstone's drawn size, over its size in the pile. */
  scale: number;
  /** How far its angle has eased back to upright (0..1). */
  upright: number;
  /** The glow and ring's opacity (0..1). */
  glow: number;
  /** The ring's radius, over the capstone's drawn radius (the glow is 1.5 times it). */
  ring: number;
  /** The rays / swirl: their opacity (0 under Reduce Motion) and turn (radians). */
  rays: number;
  spin: number;
  /** The cheering face's opacity over the capstone's own (0..1). */
  cheer: number;
  /** The twinkles' fade at the end (1, easing to 0.5); 0 under Reduce Motion (none drawn). */
  twinkle: number;
}

export function createCelebrationPose(): CelebrationPose {
  "worklet";
  return {
    dim: 0,
    lift: 0,
    scale: 1,
    upright: 0,
    glow: 0,
    ring: 1,
    rays: 0,
    spin: 0,
    cheer: 0,
    twinkle: 0,
  };
}

/** `t` between `a` and `b`, as 0..1. */
export function segment(t: number, a: number, b: number): number {
  "worklet";
  const k = (t - a) / (b - a);
  return k < 0 ? 0 : k > 1 ? 1 : k;
}

export function easeOutCubic(x: number): number {
  "worklet";
  return 1 - (1 - x) * (1 - x) * (1 - x);
}

export function easeOutBack(x: number): number {
  "worklet";
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const y = x - 1;
  return 1 + c3 * y * y * y + c1 * y * y;
}

/**
 * Fills `out` with the celebration at `t` ms after the win. False (and `out` untouched) before
 * the celebration starts or with no win (`t` < 0): the board draws as in play.
 */
export function celebrationPose(t: number, reduceMotion: boolean, out: CelebrationPose): boolean {
  "worklet";
  if (!(t >= CELEBRATION_START_MS)) return false;
  if (reduceMotion) {
    const k = segment(t, CELEBRATION_START_MS, 600);
    out.dim = k * DIM_MAX;
    out.lift = 0;
    out.scale = 1;
    out.upright = 0;
    out.glow = k;
    out.ring = 1.35;
    out.rays = 0;
    out.spin = 0;
    out.cheer = k;
    out.twinkle = 0;
    return true;
  }
  const lift = easeOutBack(segment(t, CELEBRATION_START_MS, 850));
  const pulse =
    t > 850
      ? PULSE_AMPLITUDE * Math.sin(((t - 850) / 550) * Math.PI * 2) * (1 - segment(t, 1900, 2100))
      : 0;
  out.dim = segment(t, CELEBRATION_START_MS, 700) * DIM_MAX;
  out.lift = lift;
  out.scale = 1 + (LIFT_SCALE - 1) * lift + pulse;
  out.upright = lift > 1 ? 1 : lift;
  out.glow = segment(t, 450, 800);
  out.ring = 1.25 + 0.12 * easeOutCubic(segment(t, 450, 900)) + pulse * 1.5;
  out.rays = out.glow;
  out.spin = (t - 450) * 0.00035;
  out.cheer = segment(t, 700, 850);
  out.twinkle = 1 - segment(t, 1900, 2100) * 0.5;
  return true;
}

/** A twinkle's opacity at `t`: a 700 ms fade in and out from its start. */
export function twinkleAlpha(t: number, start: number, fade: number): number {
  "worklet";
  const k = (t - start) / 700;
  if (k <= 0 || k >= 1) return 0;
  return Math.sin(k * Math.PI) * fade;
}

/** A seeded random number generator (mulberry32): the twinkles and stars are the same each win. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The twinkles (x, y, start ms, size; world units), built once per board. */
export function twinkleTable(): Float64Array {
  const r = seeded(7);
  const out = new Float64Array(TWINKLE_COUNT * TWINKLE_STRIDE);
  for (let i = 0; i < TWINKLE_COUNT; i++) {
    const o = i * TWINKLE_STRIDE;
    out[o] = 30 + r() * 340;
    out[o + 1] = 100 + r() * 470;
    out[o + 2] = 700 + r() * 900;
    out[o + 3] = 3 + r() * 5;
  }
  return out;
}

/** The galaxy swirl's stars (arm 0..2, u 0..1 along it, offset, size), built once per board. */
export function swirlTable(): Float64Array {
  const r = seeded(9);
  const out = new Float64Array(SWIRL_COUNT * SWIRL_STRIDE);
  for (let i = 0; i < SWIRL_COUNT; i++) {
    const o = i * SWIRL_STRIDE;
    out[o] = i % 3;
    out[o + 1] = r();
    out[o + 2] = (r() - 0.5) * 0.35;
    out[o + 3] = 1 + r() * 2.2;
  }
  return out;
}
