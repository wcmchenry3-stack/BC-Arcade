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
 * - Split: the crack between a split rock's halves is drawn with the explosions, over its dust
 *   (`splitCrackOps` in `explosions.ts`).
 *
 * Hitboxes are the engine's circles (`radius`); none of this touches play.
 */
import { ASTEROID_HIT_FLASH_MS, asteroidOutline, hashFrac } from "../engine";
import { opaque } from "./color";
import { hitFlashBurstOps } from "./enemies";
import type { DrawOp } from "./frame";
import { debugOpKeys } from "./opKeys";
import { ASTEROID_EDGE_RGB, ASTEROID_RGB } from "./palette";
import { rockPalette } from "./rockTint";
import type { Asteroid, AsteroidKind } from "../types";

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
 * Draw ops for every rock, back to front: each rock's tinted body (or the fallback outline), its
 * veins (large only) and its hit flash. `loaded` says which rock images can be drawn. Appends to
 * `ops` and returns it. (A split's crack is drawn with the explosions, `splitCrackOps`.)
 */
export function asteroidOps(
  asteroids: readonly Asteroid[],
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
  return ops;
}
