/**
 * The lid and danger state as drawing data (#3694): pure mappings from the engine's
 * `dangerRatio`, `canDrop` and piece positions to what the board draws. No React, no Skia, so
 * they are unit-tested on their own and the drawing (`render/drawFrame.ts`, #2960) only places
 * shapes. Each is a worklet: the board's Picture is recorded on the UI thread, which calls them.
 *
 * The look (owner's pick on #3694): proposal 3, a clock ring around the spawner that drains
 * clockwise as the danger rises (cyan to red, with a glow near the end), plus proposal 1's solid
 * lid line. Pieces over the lid get a red wash and outline while the count runs; the spawner piece
 * is a dashed, faded ghost while a drop is not allowed. Colours come from `CASCADE_LID_PALETTE`
 * (`theme/theme.cascade.ts`). All geometry is in world units (the board scales it).
 */
import type { CascadeLidPalette } from "../../theme/theme.cascade";
import { OVERFLOW_LINE_Y, WALL_THICKNESS, WORLD_WIDTH } from "./constants";

/** The solid lid line, wall to wall, at the lid. */
export const LID_LINE = {
  x1: WALL_THICKNESS,
  x2: WORLD_WIDTH - WALL_THICKNESS,
  y: OVERFLOW_LINE_Y,
  strokeWidth: 3,
} as const;

/**
 * The spawner: the queue's current piece, centred in the space above the lid, with the clock
 * ring around it. A big piece is drawn smaller here (at most `maxPieceRadius`) so the ring fits
 * between the canvas top and the lid.
 */
export const SPAWNER = {
  cx: WORLD_WIDTH / 2,
  cy: OVERFLOW_LINE_Y / 2,
  maxPieceRadius: 24,
  ringRadius: 32,
  ringWidth: 5,
} as const;

/** The ring's colour mix reaches full red at this ratio (it reads red before the very end). */
const RING_RED_AT = 1 / 1.3;
/** The ring glows from here on (no pulse: Reduce Motion needs nothing turned off). */
export const RING_GLOW_FROM = 0.7;
/** Track and ghost opacities (of the palette's ink colour). */
export const RING_TRACK_OPACITY = 0.12;
export const GHOST_OUTLINE_OPACITY = 0.4;
export const GHOST_FILL_OPACITY = 0.25;
export const OVER_LID_OUTLINE_OPACITY = 0.9;
export const OVER_LID_OUTLINE_WIDTH = 2;

function clamp01(v: number): number {
  "worklet";
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
}

/** Linear mix of two `#rrggbb` colours, `t` = 0 gives `a`, 1 gives `b`. */
export function mixHex(a: string, b: string, t: number): string {
  "worklet";
  const k = clamp01(t);
  const channel = (i: number) => {
    const ca = parseInt(a.slice(i, i + 2), 16);
    const cb = parseInt(b.slice(i, i + 2), 16);
    return Math.round(ca + (cb - ca) * k)
      .toString(16)
      .padStart(2, "0");
  };
  return "#" + channel(1) + channel(3) + channel(5);
}

export interface RingState {
  /** The part of the ring left, 0..1 (1 - dangerRatio). 1 = full, calm. */
  readonly remaining: number;
  /** The ring's arc, clockwise from 12 o'clock, in degrees (0..360). */
  readonly sweepDeg: number;
  readonly color: string;
  readonly glow: boolean;
}

/** The spawner ring for a danger ratio: full and cyan when safe, draining and reddening. */
export function ringState(dangerRatio: number, palette: CascadeLidPalette): RingState {
  "worklet";
  const ratio = clamp01(dangerRatio);
  const remaining = 1 - ratio;
  return {
    remaining,
    sweepDeg: remaining * 360,
    color: mixHex(palette.ringSafe, palette.danger, ratio / RING_RED_AT),
    glow: ratio >= RING_GLOW_FROM && remaining > 0,
  };
}

/**
 * The ring's arc as an SVG path: clockwise from 12 o'clock through `sweepDeg`. Empty for no
 * arc; a full ring is drawn as a circle instead (an SVG arc cannot close on itself).
 */
export function ringArcPath(cx: number, cy: number, r: number, sweepDeg: number): string {
  "worklet";
  const sweep = Math.min(359.99, Math.max(0, sweepDeg));
  if (sweep <= 0) return "";
  const end = ((sweep - 90) * Math.PI) / 180;
  const x1 = cx + r * Math.cos(end);
  const y1 = cy + r * Math.sin(end);
  const largeArc = sweep > 180 ? 1 : 0;
  const f = (v: number) => Number(v.toFixed(3));
  return `M ${f(cx)} ${f(cy - r)} A ${f(r)} ${f(r)} 0 ${largeArc} 1 ${f(x1)} ${f(y1)}`;
}

/** The lid line's colour: the calm colour, reddening as the count runs. */
export function lidColor(dangerRatio: number, palette: CascadeLidPalette): string {
  "worklet";
  return mixHex(palette.lid, palette.danger, clamp01(dangerRatio));
}

/** True when a piece's top edge is above the lid (the engine's overflow test, by position). */
export function isOverLid(piece: { y: number }, radius: number): boolean {
  "worklet";
  return piece.y - radius < OVERFLOW_LINE_Y;
}

/**
 * The red wash on a piece: only while the count runs (a calm board, or the piece just dropped
 * from the spawner, shows none), and only on pieces over the lid. Null = no wash.
 */
export function overLidWash(
  piece: { y: number },
  radius: number,
  dangerRatio: number
): { opacity: number } | null {
  const ratio = clamp01(dangerRatio);
  if (ratio <= 0 || !isOverLid(piece, radius)) return null;
  return { opacity: 0.3 + 0.35 * ratio };
}

/** The spawner piece's drawn radius: its own, capped so the ring fits above the lid. */
export function spawnerPieceRadius(radius: number): number {
  "worklet";
  "worklet";
  return Math.min(radius, SPAWNER.maxPieceRadius);
}
