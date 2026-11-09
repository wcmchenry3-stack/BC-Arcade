/**
 * #3596: the asteroids as shared display-list geometry — the native canvas (`buildFrame`) and
 * the web canvas (`GameCanvas.web.tsx`, through `drawRockOps`) draw the same ops, so a rock
 * looks the same on both.
 *
 * - Art: two large and two small neutral (greyscale) shapes from the generator
 *   (`tools/assets/draw_starswarm_art.py`), tinted per rock into one of three palettes (R1
 *   basalt, R2 rust iron, R3 slate blue-grey; see `rockTint.ts`). Large rocks carry a gold
 *   ore-vein layer drawn untinted over the body (they can drop salvage, #3568); small rocks
 *   have none. Each rock's shape and palette come from a hash of its id (render-only, stable for
 *   its life), and the image spins with the rock's existing `rotation`.
 * - Fallback: until the art loads, the shared 9-point outline (`asteroidOutline`), filled in
 *   basalt with a light rim.
 * - Hit flash: the #3593 burst (white-hot core, orange ring, sparks) on the rock's own clock.
 * - Split: when a large rock splits, a glowing crack opens between the two halves for
 *   `SPLIT_CRACK_MS`, over the rock-dust explosion (the #3560 "rock crack" sound). It is read
 *   from existing state alone: the two halves are consecutive small rocks whose midpoint, run
 *   back by the age of a fresh `rock` explosion, lands on that explosion.
 *
 * Hitboxes are the engine's circles (`radius`); none of this touches play.
 */
import {
  ASTEROID_HIT_FLASH_MS,
  EXPLOSION_FRAME_MS,
  EXPLOSION_FRAMES,
  asteroidOutline,
  hashFrac,
} from "../engine";
import { opaque, withAlpha } from "./color";
import { hitFlashBurstOps } from "./enemies";
import { explosionProgress } from "./explosions";
import type { DrawOp } from "./frame";
import { debugOpKeys } from "./opKeys";
import { ASTEROID_EDGE_RGB, ASTEROID_RGB, HIT_CORE_RGB, HIT_RING_RGB } from "./palette";
import { rockPalette } from "./rockTint";
import type { Asteroid, AsteroidKind, Explosion } from "../types";

/** The rock bodies (neutral, tinted at draw time), by size. */
export const ROCK_BODIES = {
  large: ["rockLarge1", "rockLarge2"],
  small: ["rockSmall1", "rockSmall2"],
} as const satisfies Record<AsteroidKind, readonly string[]>;

export type RockBodyKey = (typeof ROCK_BODIES)[AsteroidKind][number];

/** The ore veins drawn untinted over a large body. */
export const ROCK_VEINS = {
  rockLarge1: "rockLarge1Veins",
  rockLarge2: "rockLarge2Veins",
} as const;

export type RockVeinKey = (typeof ROCK_VEINS)[keyof typeof ROCK_VEINS];
export type RockSpriteKey = RockBodyKey | RockVeinKey;

/** Every body, large then small: the web's tint cache is indexed by a body's place here. */
export const ROCK_BODY_LIST: readonly RockBodyKey[] = [...ROCK_BODIES.large, ...ROCK_BODIES.small];

/** Every rock image slot, bodies then veins. */
export const ROCK_SPRITES: readonly RockSpriteKey[] = [
  ...ROCK_BODY_LIST,
  ...Object.values(ROCK_VEINS),
];

/** A body's index in `ROCK_BODY_LIST` (-1 for anything else). */
export function rockBodySlot(sprite: string): number {
  return (ROCK_BODY_LIST as readonly string[]).indexOf(sprite);
}

/** The art's transparent margin around the 2 x radius box, game px (the generator's ROCK_PAD). */
export const ROCK_SPRITE_PAD = 2;

/** How long the split crack shows, ms (under half the rock-dust explosion's 560 ms). */
export const SPLIT_CRACK_MS = 220;

/** Half the crack's length, px: about a large rock's radius. */
const CRACK_HALF = 20;
/** Points along the crack (both ends included). */
const CRACK_POINTS = 5;
/** How far a split's back-projected midpoint may sit from its explosion, px (a tick's drift). */
const SPLIT_MATCH_PX = 6;

const LIFE_MS = EXPLOSION_FRAMES * EXPLOSION_FRAME_MS;

/** Which shape a rock draws: stable for its life (the same hash the Kenney pick used). */
export function rockBody(a: Pick<Asteroid, "id" | "kind">): RockBodyKey {
  const set = ROCK_BODIES[a.kind] ?? ROCK_BODIES.large;
  return set[Math.floor(hashFrac(a.id * 78.233) * set.length)] ?? set[0];
}

/** The ore-vein layer of a body, or undefined for a small rock. */
export function rockVeins(body: RockBodyKey): RockVeinKey | undefined {
  return (ROCK_VEINS as Partial<Record<RockBodyKey, RockVeinKey>>)[body];
}

/** Flatten points, rounded to 0.1 px — what the asteroid path used before #2564. */
function flatRounded(points: readonly { x: number; y: number }[]): number[] {
  const out: number[] = [];
  for (const p of points) out.push(Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10);
  return out;
}

/**
 * The two halves of a large rock split by `ex` (a `rock` explosion), or null. The engine makes
 * them in one go right after the explosion (consecutive ids, `±` the split speed), so their
 * midpoint moves with the parent's velocity: run back by the explosion's age it lands on it.
 */
export function splitHalves(
  ex: Explosion,
  asteroids: readonly Asteroid[]
): readonly [Asteroid, Asteroid] | null {
  if (ex.kind !== "rock") return null;
  const age = explosionProgress(ex) * LIFE_MS;
  if (!(age >= 0 && age < SPLIT_CRACK_MS)) return null;
  for (const a of asteroids) {
    if (a.kind !== "small" || !(a.id > ex.id)) continue;
    for (const b of asteroids) {
      if (b.id !== a.id + 1 || b.kind !== "small") continue;
      const mx = (a.x + b.x) / 2 - ((a.vx + b.vx) / 2) * age;
      const my = (a.y + b.y) / 2 - ((a.vy + b.vy) / 2) * age;
      if (Math.abs(mx - ex.x) <= SPLIT_MATCH_PX && Math.abs(my - ex.y) <= SPLIT_MATCH_PX) {
        return [a, b];
      }
    }
  }
  return null;
}

/**
 * The split crack for explosion `ex`, if it split a rock: a jagged seam between the two halves,
 * across the line joining them — an orange glow under a white-hot core that both fade out — and
 * a brief white-hot flash where it opened.
 */
export function splitCrackOps(
  ex: Explosion,
  asteroids: readonly Asteroid[],
  ops: DrawOp[] = []
): DrawOp[] {
  const halves = splitHalves(ex, asteroids);
  if (!halves) return ops;
  const [a, b] = halves;
  const dbg = debugOpKeys();
  const key = dbg ? `crack-${ex.id}` : undefined;
  const p = (explosionProgress(ex) * LIFE_MS) / SPLIT_CRACK_MS; // 0 → 1 over the crack
  const k = 1 - p;
  const cx = (a.x + b.x) / 2;
  const cy = (a.y + b.y) / 2;
  let ux = b.x - a.x;
  let uy = b.y - a.y;
  const len = Math.hypot(ux, uy) || 1;
  ux /= len;
  uy /= len;
  // Along the crack is across the split; the jag is along the split
  const ax = -uy;
  const ay = ux;
  if (p < 0.4) {
    ops.push({
      k: "circle",
      key: dbg ? `${key}-flash` : undefined,
      cx,
      cy,
      r: 5 + 10 * p,
      color: withAlpha(HIT_CORE_RGB, 0.9 * (1 - p / 0.4)),
    });
  }
  const glow = withAlpha(HIT_RING_RGB, 0.6 * k);
  const core = withAlpha(HIT_CORE_RGB, k);
  for (const [pass, color, stroke] of [
    ["glow", glow, 3],
    ["core", core, 1.2],
  ] as const) {
    let px = 0;
    let py = 0;
    for (let i = 0; i < CRACK_POINTS; i++) {
      const s = -CRACK_HALF + (2 * CRACK_HALF * i) / (CRACK_POINTS - 1);
      const end = i === 0 || i === CRACK_POINTS - 1;
      const jag = end ? 0 : (hashFrac(ex.id * 17.31 + i * 4.77) - 0.5) * 6;
      const x = cx + ax * s + ux * jag;
      const y = cy + ay * s + uy * jag;
      if (i > 0) {
        ops.push({
          k: "line",
          key: dbg ? `${key}-${pass}-${i}` : undefined,
          x0: px,
          y0: py,
          x1: x,
          y1: y,
          color,
          stroke,
        });
      }
      px = x;
      py = y;
    }
  }
  return ops;
}

/**
 * Draw ops for every rock, back to front: each rock's tinted body (or the fallback outline), its
 * veins (large only) and its hit flash, then any split crack over them. `loaded` says which rock
 * images can be drawn. Appends to `ops` and returns it.
 */
export function asteroidOps(
  asteroids: readonly Asteroid[],
  explosions: readonly Explosion[],
  loaded: Readonly<Record<RockSpriteKey, boolean>>,
  ops: DrawOp[] = []
): DrawOp[] {
  const dbg = debugOpKeys();
  for (const a of asteroids) {
    const key = dbg ? `rock-${a.id}` : undefined;
    const body = rockBody(a);
    if (loaded[body]) {
      const m = ROCK_SPRITE_PAD;
      const x = a.x - a.radius - m;
      const y = a.y - a.radius - m;
      const size = 2 * (a.radius + m);
      ops.push({
        k: "image",
        key,
        sprite: body,
        x,
        y,
        w: size,
        h: size,
        fit: "fill",
        rotate: a.rotation,
        tint: rockPalette(a.id),
      });
      const veins = rockVeins(body);
      if (veins && loaded[veins]) {
        ops.push({
          k: "image",
          key: dbg ? `${key}-veins` : undefined,
          sprite: veins,
          x,
          y,
          w: size,
          h: size,
          fit: "fill",
          rotate: a.rotation,
        });
      }
    } else {
      const points = flatRounded(asteroidOutline(a));
      ops.push({ k: "poly", key, points, color: opaque(ASTEROID_RGB) });
      ops.push({
        k: "poly",
        key: dbg ? `${key}-edge` : undefined,
        points,
        color: opaque(ASTEROID_EDGE_RGB),
        stroke: 1.5,
      });
    }
    if (a.hitFlashTimer > 0) {
      const d = 2 * a.radius;
      hitFlashBurstOps(a.id, a.x, a.y, d, d, a.hitFlashTimer, ASTEROID_HIT_FLASH_MS, ops, key);
    }
  }
  for (const ex of explosions) splitCrackOps(ex, asteroids, ops);
  return ops;
}
