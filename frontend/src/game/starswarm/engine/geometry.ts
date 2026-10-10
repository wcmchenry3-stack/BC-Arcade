/**
 * Star Swarm engine — geometry (#2988).
 *
 * Pure shapes and curves: cubic Béziers (evaluation, de Casteljau split, control-point nudge),
 * AABB / circle overlap tests, the formation slot layout, the swoop / return / flee / dive path
 * factories, the proportional aim used by every enemy gun, and `hashFrac`, the stateless hash
 * the rng-free decisions (Buddy, the Carrier's volley target, rock outlines) are keyed on.
 * The path factories draw jitter from the seeded `rng()`; everything else is deterministic.
 */
import type { CubicBezier, Enemy, EnemyTier, Vec2 } from "../types";
import { rng } from "./rng";
import {
  AIMED_SHOT_FRACTION,
  AIMED_SHOT_WAVE_START,
  BULLET_E_VY,
  CANVAS_H,
  CANVAS_W,
  DODGE_PATH_NUDGE,
  FORMATION_COLS,
  FORMATION_COL_W,
  FORMATION_ROW_H,
  FORMATION_TOP,
} from "./tuning";

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

export function evalCubic(c: CubicBezier, t: number): Vec2 {
  const u = 1 - t;
  const u2 = u * u;
  const u3 = u2 * u;
  const t2 = t * t;
  const t3 = t2 * t;
  return {
    x: u3 * c.p0.x + 3 * u2 * t * c.p1.x + 3 * u * t2 * c.p2.x + t3 * c.p3.x,
    y: u3 * c.p0.y + 3 * u2 * t * c.p1.y + 3 * u * t2 * c.p2.y + t3 * c.p3.y,
  };
}

/** AABB overlap — positions are centers, w/h are full extents. */
export function aabb(
  ax: number,
  ay: number,
  aw: number,
  ah: number,
  bx: number,
  by: number,
  bw: number,
  bh: number
): boolean {
  return (
    ax - aw / 2 < bx + bw / 2 &&
    ax + aw / 2 > bx - bw / 2 &&
    ay - ah / 2 < by + bh / 2 &&
    ay + ah / 2 > by - bh / 2
  );
}

// #974: circle (player hurt area) vs AABB — positions are centers, w/h are full extents
export function collideCircleAABB(
  cx: number,
  cy: number,
  cr: number,
  bx: number,
  by: number,
  bw: number,
  bh: number
): boolean {
  const nearX = Math.max(bx - bw / 2, Math.min(bx + bw / 2, cx));
  const nearY = Math.max(by - bh / 2, Math.min(by + bh / 2, cy));
  const dx = cx - nearX;
  const dy = cy - nearY;
  return dx * dx + dy * dy <= cr * cr;
}

// ---------------------------------------------------------------------------
// Formation layout helpers
// ---------------------------------------------------------------------------

export interface SlotDef {
  tier: EnemyTier;
  row: number;
  col: number;
  rowCols: number;
}

export function waveSlots(wave: number): SlotDef[] {
  const slots: SlotDef[] = [];

  // Guardian row: 4 enemies, centered
  for (let c = 0; c < 4; c++) slots.push({ tier: "Guardian", row: 1, col: c, rowCols: 4 });

  // Two Elite rows
  for (let r = 2; r <= 3; r++)
    for (let c = 0; c < FORMATION_COLS; c++)
      slots.push({ tier: "Elite", row: r, col: c, rowCols: FORMATION_COLS });

  // Grunt rows: 2 at wave 1, +1 every other wave, max 5
  const gruntRows = Math.min(2 + Math.floor((wave - 1) / 2), 5);
  for (let r = 4; r < 4 + gruntRows; r++)
    for (let c = 0; c < FORMATION_COLS; c++)
      slots.push({ tier: "Grunt", row: r, col: c, rowCols: FORMATION_COLS });

  // #2484: Carrier row — one ship, centered above its escorts. Last in the list so it is the
  // last to swoop in (and so enemies[0] stays a Guardian, which the dev panel and tests lean on).
  slots.push({ tier: "Carrier", row: 0, col: 0, rowCols: 1 });

  return slots;
}

/** #2490: a boss wave is the Carrier and its four escorts, nothing else. Carrier last, as above. */
export function bossWaveSlots(): SlotDef[] {
  const slots: SlotDef[] = [];
  for (let c = 0; c < 4; c++) slots.push({ tier: "Guardian", row: 1, col: c, rowCols: 4 });
  slots.push({ tier: "Carrier", row: 0, col: 0, rowCols: 1 });
  return slots;
}

export function slotToWorld(slot: SlotDef, canvasW: number): { fx: number; fy: number } {
  const rowWidth = slot.rowCols * FORMATION_COL_W;
  const left = (canvasW - rowWidth) / 2 + FORMATION_COL_W / 2;
  return {
    fx: left + slot.col * FORMATION_COL_W,
    fy: FORMATION_TOP + slot.row * FORMATION_ROW_H,
  };
}

// ---------------------------------------------------------------------------
// Path factories
// ---------------------------------------------------------------------------

export function swoopPath(idx: number, fx: number, fy: number, canvasW: number): CubicBezier {
  const fromLeft = idx % 2 === 0;
  const p0: Vec2 = fromLeft ? { x: -40, y: -50 } : { x: canvasW + 40, y: -50 };
  const p1: Vec2 = fromLeft
    ? { x: canvasW * 0.72, y: CANVAS_H * 0.32 }
    : { x: canvasW * 0.28, y: CANVAS_H * 0.32 };
  const p2: Vec2 = { x: fx + (fromLeft ? -55 : 55), y: fy + 70 };
  const p3: Vec2 = { x: fx, y: fy };
  return { p0, p1, p2, p3 };
}

export function returnPath(ex: number, ey: number, fx: number, fy: number): CubicBezier {
  const jitter = rng() * 50 - 25;
  return {
    p0: { x: ex, y: ey },
    p1: { x: (ex + fx) / 2, y: ey - 110 },
    p2: { x: fx + jitter, y: fy + 55 },
    p3: { x: fx, y: fy },
  };
}

/** #2489: from where the grunt is to off-screen top on its nearer side — a lift, then a bolt. */
export function fleePath(x: number, y: number, canvasW: number): CubicBezier {
  const endX = x < canvasW / 2 ? -60 : canvasW + 60;
  const endY = -60;
  return {
    p0: { x, y },
    p1: { x: x + (endX - x) * 0.15, y: y - 40 - rng() * 30 },
    p2: { x: endX - (endX - x) * 0.25, y: endY + 80 },
    p3: { x: endX, y: endY },
  };
}

// #977: wide Bézier arc for Diving phase — sweeps outward before descending
// shallow=true produces an Elite Phase-1 dive that stays above 60% canvas height
export function divePath(
  enemy: Enemy,
  targetX: number,
  canvasH: number,
  shallow = false
): CubicBezier {
  const sweepDir = enemy.formationX < CANVAS_W / 2 ? -1 : 1;
  const jitter = (rng() - 0.5) * 40;
  if (shallow) {
    return {
      p0: { x: enemy.x, y: enemy.y },
      p1: { x: enemy.formationX + sweepDir * 50, y: enemy.formationY + 50 },
      p2: { x: targetX + jitter, y: canvasH * 0.4 },
      p3: { x: targetX, y: canvasH * 0.55 },
    };
  }
  return {
    p0: { x: enemy.x, y: enemy.y },
    p1: { x: enemy.formationX + sweepDir * 80, y: enemy.formationY + 80 },
    p2: { x: targetX + jitter, y: canvasH * 0.7 },
    p3: { x: targetX, y: canvasH * 0.9 },
  };
}

export function circleCircle(
  ax: number,
  ay: number,
  ar: number,
  bx: number,
  by: number,
  br: number
): boolean {
  const dx = ax - bx;
  const dy = ay - by;
  const r = ar + br;
  return dx * dx + dy * dy <= r * r;
}

/**
 * GLSL-style hash → a fraction in [0, 1). Shared by the outline wobble below and the render
 * layer's per-rock meteor-sprite pick (#2573), so the technique lives in exactly one place.
 */
export function hashFrac(seed: number): number {
  const h = Math.sin(seed) * 43758.5453;
  return h - Math.floor(h);
}

export function lerp(a: Vec2, b: Vec2, t: number): Vec2 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/**
 * The part of a cubic still ahead of parameter `t`, as its own cubic (de Casteljau split).
 * Evaluating the result at u gives the original at t + u·(1 − t); at t = 0 it is the same curve.
 */
export function splitRemaining(path: CubicBezier, t: number): CubicBezier {
  if (t <= 0) return path;
  const a = lerp(path.p0, path.p1, t);
  const b = lerp(path.p1, path.p2, t);
  const c = lerp(path.p2, path.p3, t);
  const d = lerp(a, b, t);
  const e = lerp(b, c, t);
  const f = lerp(d, e, t);
  return { p0: f, p1: e, p2: c, p3: path.p3 };
}

/** Shift a path's middle control points sideways; p0 and the destination (p3) are untouched. */
export function nudgePath(
  path: CubicBezier,
  dir: 1 | -1,
  px: number = DODGE_PATH_NUDGE
): CubicBezier {
  return {
    p0: path.p0,
    p1: { x: path.p1.x + dir * px, y: path.p1.y },
    p2: { x: path.p2.x + dir * px, y: path.p2.y },
    p3: path.p3,
  };
}

// #1314: proportional aim — keeps vy = speed (same arrival time), scales vx to intersect the player.
// vx is capped at ±speed so the bullet never travels more than 45° from vertical; without the cap,
// circling enemies near the player's altitude produce extreme vx values (dy is small → dx/dy blows up).
export function aimVelocity(
  enemyX: number,
  enemyY: number,
  playerX: number,
  playerY: number,
  speed = BULLET_E_VY
): { vx: number; vy: number } {
  const dy = playerY - enemyY;
  if (dy <= 0) return { vx: 0, vy: speed }; // player at or above enemy — fire straight down
  const dx = playerX - enemyX;
  const rawVx = (dx / dy) * speed;
  const vx = Math.max(-speed, Math.min(speed, rawVx));
  return { vx, vy: speed };
}

// #924/#1314: compute velocity for a Grunt enemy bullet — straight down before wave 1+;
// probability-gated proportional aim that ramps per wave
export function aimedBulletVelocity(
  enemyX: number,
  enemyY: number,
  playerX: number,
  playerY: number,
  wave: number,
  paramScale = 1
): { vx: number; vy: number } {
  if (wave < AIMED_SHOT_WAVE_START) return { vx: 0, vy: BULLET_E_VY };
  const cap = Math.min(0.9, 0.6 * paramScale);
  const fraction = Math.min(cap, AIMED_SHOT_FRACTION + (wave - AIMED_SHOT_WAVE_START) * 0.05);
  if (rng() > fraction) return { vx: 0, vy: BULLET_E_VY };
  return aimVelocity(enemyX, enemyY, playerX, playerY);
}
