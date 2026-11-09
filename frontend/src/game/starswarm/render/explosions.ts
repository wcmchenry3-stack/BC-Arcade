/**
 * #3597: explosions and the Smart Bomb flash, code-drawn as shared display-list geometry. They
 * replaced the 20-frame Kenney explosion strip (48 x 48 PNGs) and the bomb's plain white fade.
 *
 * Both renderers replay these: `buildFrame` (native Skia) appends `effectOps` last, and
 * `GameCanvas.web.tsx` replays the same `circle` / `rect` / `line` ops with `drawPickupOps` after
 * its rocks, so the explosions and the flash sit in the same place in the z-order on both (the
 * web canvas used to draw the flash under its rocks and explosions).
 *
 * The flash family (the #3593 hit flash, the #3625 Carrier plasma): an explosion is a white-hot
 * core in the plasma's yellow-white, an orange fire ring that grows and fades, then dark smoke
 * puffs, with debris ticks thrown off the bigger ones. Its size comes from the explosion's `kind`
 * (a Grunt pops, an Elite / Guardian / ship bursts, the Carrier blasts, a rock breaks into dust
 * and gravel in its own palette, #3596, via the explosion's `srcId`); its age from the engine's existing frame clock, so play is untouched. The
 * puffs' and ticks' angles hash from the explosion's id: stable for its life, no state needed.
 *
 * The Smart Bomb: a short warm tint over the whole screen and a shockwave ring that sweeps out
 * from the ship to the far corner, with a white-hot flash at its start, all over everything else.
 */
import { BOMB_FLASH_DURATION, EXPLOSION_FRAMES, EXPLOSION_FRAME_MS, hashFrac } from "../engine";
import { withAlpha } from "./color";
import type { DrawOp } from "./frame";
import { debugOpKeys } from "./opKeys";
import {
  BOMB_TINT_RGB,
  EXPLOSION_FIRE_RGB,
  EXPLOSION_HOT_RGB,
  EXPLOSION_SMOKE_RGB,
  EXPLOSION_SPARK_RGB,
  HIT_CORE_RGB,
  HIT_RING_RGB,
  ROCK_DUST_HOT_RGB,
  ROCK_DUST_PALETTES,
  ROCK_DUST_RGB,
  WHITE_RGB,
} from "./palette";
import { rockPalette } from "./rockTint";
import type { Asteroid, Explosion, ExplosionKind, StarSwarmState } from "../types";

/** How one kind of explosion is drawn. */
export interface ExplosionStyle {
  /** Radius, px: the core and the ring grow from it. */
  readonly r: number;
  /** Debris ticks thrown off (none for a Grunt's pop). */
  readonly debris: number;
  /** Smoke puffs late in the blast. */
  readonly smoke: number;
  /** The core's colour and the fire ring's (0xRRGGBB). */
  readonly hot: number;
  readonly fire: number;
}

/** #3597: the owner-approved sizes (Grunt pop r 14, burst r 22, Carrier blast r 40, rock r 20). */
export const EXPLOSION_STYLE: Readonly<Record<ExplosionKind, ExplosionStyle>> = {
  pop: { r: 14, debris: 0, smoke: 3, hot: EXPLOSION_HOT_RGB, fire: EXPLOSION_FIRE_RGB },
  burst: { r: 22, debris: 6, smoke: 4, hot: EXPLOSION_HOT_RGB, fire: EXPLOSION_FIRE_RGB },
  blast: { r: 40, debris: 14, smoke: 5, hot: EXPLOSION_HOT_RGB, fire: EXPLOSION_FIRE_RGB },
  rock: { r: 20, debris: 10, smoke: 4, hot: ROCK_DUST_HOT_RGB, fire: ROCK_DUST_RGB },
};

/** The core flash shows for the first 35% of the life... */
export const CORE_UNTIL = 0.35;
/** ...and the smoke from 20% on. */
export const SMOKE_FROM = 0.2;

/** An explosion's whole life, ms: the engine's frame clock, unchanged. */
const LIFE_MS = EXPLOSION_FRAMES * EXPLOSION_FRAME_MS;

/**
 * #3596: a rock's dust in each rock palette (`ROCK_DUST_PALETTES` order): the `rock` size with that
 * palette's hot core and ring.
 */
export const ROCK_DUST_STYLES: readonly ExplosionStyle[] = ROCK_DUST_PALETTES.map((d) => ({
  ...EXPLOSION_STYLE.rock,
  hot: d.hot,
  fire: d.ring,
}));

/**
 * The style for an explosion; an absent or unknown kind (another build's save) is a pop. A rock's
 * dust takes the palette of the rock that broke (`srcId`, hashed as the rock's art is); without a
 * usable `srcId` (an older save) it is the default brown.
 */
export function explosionStyle(ex: Explosion): ExplosionStyle {
  // Own keys only: a saved kind such as "constructor" must not reach Object.prototype
  const kind = ex.kind;
  if (kind === "rock" && typeof ex.srcId === "number" && Number.isFinite(ex.srcId)) {
    return ROCK_DUST_STYLES[rockPalette(ex.srcId)] ?? EXPLOSION_STYLE.rock;
  }
  return kind !== undefined && Object.prototype.hasOwnProperty.call(EXPLOSION_STYLE, kind)
    ? EXPLOSION_STYLE[kind]
    : EXPLOSION_STYLE.pop;
}

/**
 * How far through its life an explosion is, 0 at spawn and approaching 1 as the engine retires it
 * — smooth between the frame steps, from the frame index and the time left on that frame.
 */
export function explosionProgress(ex: Explosion): number {
  const left = Math.min(EXPLOSION_FRAME_MS, Math.max(0, ex.frameTimer));
  return (ex.frame * EXPLOSION_FRAME_MS + (EXPLOSION_FRAME_MS - left)) / LIFE_MS;
}

/**
 * Draw ops for one explosion, back to front: the core flash, the fire ring (a soft glow under a
 * bright band), smoke puffs, debris ticks. Appends to `ops` and returns it. Nothing once its life
 * is over (or for one with no usable clock).
 */
export function explosionOps(ex: Explosion, ops: DrawOp[] = []): DrawOp[] {
  const t = explosionProgress(ex);
  if (!(t >= 0 && t < 1)) return ops;
  const dbg = debugOpKeys();
  const key = dbg ? `ex-${ex.id}` : undefined;
  const s = explosionStyle(ex);
  const { x: cx, y: cy } = ex;
  const R = s.r;

  // The core: a hot disc under a white centre, shrinking in strength as it swells
  if (t < CORE_UNTIL) {
    const k = 1 - t / CORE_UNTIL;
    const r = R * (0.4 + 0.5 * t);
    ops.push({
      k: "circle",
      key: dbg ? `${key}-core` : undefined,
      cx,
      cy,
      r,
      color: withAlpha(s.hot, 0.6 * k),
    });
    ops.push({
      k: "circle",
      key: dbg ? `${key}-core-hot` : undefined,
      cx,
      cy,
      r: r * 0.5,
      color: withAlpha(WHITE_RGB, k),
    });
  }

  // The fire ring grows from 30% of the radius to 110%, fading as it goes
  const rr = R * (0.3 + 0.8 * t);
  const fade = 0.85 * (1 - t);
  ops.push({
    k: "circle",
    key: dbg ? `${key}-ring-glow` : undefined,
    cx,
    cy,
    r: rr * 0.78,
    color: withAlpha(s.fire, 0.4 * fade),
    stroke: rr * 0.44,
  });
  ops.push({
    k: "circle",
    key: dbg ? `${key}-ring` : undefined,
    cx,
    cy,
    r: rr * 0.86,
    color: withAlpha(s.fire, fade),
    stroke: Math.max(1, rr * 0.14),
  });

  // Smoke: dark puffs inside the ring, swelling and thinning out
  if (t >= SMOKE_FROM) {
    const color = withAlpha(EXPLOSION_SMOKE_RGB, t * (1 - t));
    const r = R * 0.25 * t;
    for (let i = 0; i < s.smoke; i++) {
      const a = 2 * Math.PI * hashFrac(ex.id * 12.9898 + i * 78.233);
      const d = rr * (0.3 + 0.5 * hashFrac(ex.id * 39.346 + i * 11.135));
      ops.push({
        k: "circle",
        key: dbg ? `${key}-smoke-${i}` : undefined,
        cx: cx + Math.cos(a) * d,
        cy: cy + Math.sin(a) * d,
        r,
        color,
      });
    }
  }

  // Debris: short ticks flying outward, pointing back at the centre (`line` ops: no path, no array)
  if (s.debris > 0) {
    const color = withAlpha(EXPLOSION_SPARK_RGB, 1 - t);
    const len = 0.12 * R;
    for (let i = 0; i < s.debris; i++) {
      const a = 2 * Math.PI * hashFrac(ex.id * 7.137 + i * 93.989);
      const d = R * (0.2 + t) * (0.6 + 0.4 * hashFrac(ex.id * 3.71 + i * 51.17));
      const ux = Math.cos(a);
      const uy = Math.sin(a);
      const x = cx + ux * d;
      const y = cy + uy * d;
      ops.push({
        k: "line",
        key: dbg ? `${key}-debris-${i}` : undefined,
        x0: x,
        y0: y,
        x1: x - ux * len,
        y1: y - uy * len,
        color,
        stroke: 1,
      });
    }
  }
  return ops;
}

// --- The split crack (#3596) ------------------------------------------------------------------

/** How long the split crack shows, ms of the dust explosion's clock (under half its 560 ms). */
export const SPLIT_CRACK_MS = 220;

/** Half the crack's length, px: about a large rock's radius. */
const CRACK_HALF = 20;
/** Points along the crack (both ends included). */
const CRACK_POINTS = 5;
/** How far the dust may sit off the halves' track, px (float noise and a tick of drift). */
const SPLIT_MATCH_PX = 6;
/**
 * The explosion clock runs slow against real time: `tickExplosions` drops each frame's overshoot,
 * and a tick advances it at most one 28 ms frame, so its age is 85-88% of real time at 8-33 ms
 * ticks (both canvases cap a tick at 33 ms) and far less on a long uncapped tick. How far along
 * their track the halves may be is bounded by `|v| x (SPLIT_LAG x age + SPLIT_HITCH_MS)`: 25%
 * over the measured lag, plus one 100 ms hitch.
 */
const SPLIT_LAG = 1.25;
const SPLIT_HITCH_MS = 100;

/**
 * The first half of a large rock split by `ex` (a `rock` explosion still inside the crack's
 * time), or null; the second half is the rock with the next id. The engine makes the halves right
 * after the dust (consecutive ids, 1-2 after it: a salvage crate may take one between), at the
 * rock's centre ± 10 px and its velocity ± the split speed, so their midpoint leaves the dust
 * along the parent's velocity. A match needs the ids, the dust on that track (within
 * SPLIT_MATCH_PX of it) and the midpoint no farther along it than the rock could have travelled.
 */
function splitFirstHalf(ex: Explosion, asteroids: readonly Asteroid[]): Asteroid | null {
  if (ex.kind !== "rock") return null;
  const age = explosionProgress(ex) * LIFE_MS;
  if (!(age >= 0 && age < SPLIT_CRACK_MS)) return null;
  for (const a of asteroids) {
    if (a.kind !== "small" || a.id <= ex.id || a.id > ex.id + 2) continue;
    for (const b of asteroids) {
      if (b.id !== a.id + 1 || b.kind !== "small") continue;
      const dx = (a.x + b.x) / 2 - ex.x;
      const dy = (a.y + b.y) / 2 - ex.y;
      const vx = (a.vx + b.vx) / 2;
      const vy = (a.vy + b.vy) / 2;
      const speed = Math.hypot(vx, vy);
      if (speed === 0) {
        if (Math.hypot(dx, dy) <= SPLIT_MATCH_PX) return a;
        continue;
      }
      const along = (dx * vx + dy * vy) / speed;
      const off = Math.abs(dx * vy - dy * vx) / speed;
      const reach = speed * (SPLIT_LAG * age + SPLIT_HITCH_MS) + SPLIT_MATCH_PX;
      if (off <= SPLIT_MATCH_PX && along >= -SPLIT_MATCH_PX && along <= reach) return a;
    }
  }
  return null;
}

/** @internal The two halves of a rock split by `ex`, or null (tests; the frame uses `splitCrackOps`). */
export function splitHalves(
  ex: Explosion,
  asteroids: readonly Asteroid[]
): readonly [Asteroid, Asteroid] | null {
  const a = splitFirstHalf(ex, asteroids);
  const b = a && asteroids.find((r) => r.id === a.id + 1);
  return a && b ? [a, b] : null;
}

/**
 * The split crack for explosion `ex`, if it split a rock: a jagged seam between the two halves,
 * across the line joining them — an orange glow under a white-hot core that both fade out — and
 * a brief white-hot flash where it opened. Drawn after the explosions, so it reads on top of the
 * dust, and before the bomb flash.
 */
export function splitCrackOps(
  ex: Explosion,
  asteroids: readonly Asteroid[],
  ops: DrawOp[] = []
): DrawOp[] {
  const a = splitFirstHalf(ex, asteroids);
  if (!a) return ops;
  let b: Asteroid | undefined;
  for (const r of asteroids) if (r.id === a.id + 1) b = r;
  if (!b) return ops;
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
  crackLine(
    ex.id,
    cx,
    cy,
    ux,
    uy,
    withAlpha(HIT_RING_RGB, 0.6 * k),
    3,
    dbg ? `${key}-glow` : undefined,
    ops
  );
  crackLine(
    ex.id,
    cx,
    cy,
    ux,
    uy,
    withAlpha(HIT_CORE_RGB, k),
    1.2,
    dbg ? `${key}-core` : undefined,
    ops
  );
  return ops;
}

/**
 * One pass of the crack: a jagged line through (cx, cy) across the split direction (ux, uy), its
 * inner points jagged along the split by a hash of the explosion's id.
 */
function crackLine(
  id: number,
  cx: number,
  cy: number,
  ux: number,
  uy: number,
  color: number,
  stroke: number,
  key: string | undefined,
  ops: DrawOp[]
): void {
  let px = 0;
  let py = 0;
  for (let i = 0; i < CRACK_POINTS; i++) {
    const s = -CRACK_HALF + (2 * CRACK_HALF * i) / (CRACK_POINTS - 1);
    const end = i === 0 || i === CRACK_POINTS - 1;
    const jag = end ? 0 : (hashFrac(id * 17.31 + i * 4.77) - 0.5) * 6;
    const x = cx - uy * s + ux * jag;
    const y = cy + ux * s + uy * jag;
    if (i > 0) {
      ops.push({
        k: "line",
        key: key && `${key}-${i}`,
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

/** The bomb's white-hot flash at the ship shows for the first 30% of the flash. */
const BOMB_CORE_UNTIL = 0.3;

/**
 * Draw ops for the Smart Bomb flash while `bombFlashTimer` runs, back to front: the warm tint over
 * the screen, the shockwave's soft glow and bright band, and the white-hot flash at the ship.
 * The ring starts at the ship and reaches the farthest corner as the flash ends (eased out).
 */
export function bombFlashOps(
  state: StarSwarmState,
  width: number,
  height: number,
  ops: DrawOp[] = []
): DrawOp[] {
  const timer = state.bombFlashTimer;
  if (!(timer > 0)) return ops;
  const dbg = debugOpKeys();
  const left = Math.min(1, timer / BOMB_FLASH_DURATION); // 1 at detonation, 0 at the end
  const p = 1 - left;
  const { x: cx, y: cy } = state.player;

  ops.push({
    k: "rect",
    key: dbg ? "bomb-flash" : undefined,
    x: 0,
    y: 0,
    w: width,
    h: height,
    color: withAlpha(BOMB_TINT_RGB, 0.45 * left * left),
  });

  const reach = Math.hypot(Math.max(cx, width - cx), Math.max(cy, height - cy));
  const r = reach * (1 - left * left * left);
  if (r >= 1) {
    ops.push({
      k: "circle",
      key: dbg ? "bomb-wave-glow" : undefined,
      cx,
      cy,
      r,
      color: withAlpha(EXPLOSION_FIRE_RGB, 0.5 * left),
      stroke: 4 + 18 * left,
    });
    ops.push({
      k: "circle",
      key: dbg ? "bomb-wave" : undefined,
      cx,
      cy,
      r,
      color: withAlpha(EXPLOSION_HOT_RGB, 0.9 * left),
      stroke: 3,
    });
  }

  if (p < BOMB_CORE_UNTIL) {
    ops.push({
      k: "circle",
      key: dbg ? "bomb-core" : undefined,
      cx,
      cy,
      r: 24 + 40 * p,
      color: withAlpha(WHITE_RGB, 0.8 * (1 - p / BOMB_CORE_UNTIL)),
    });
  }
  return ops;
}

/**
 * Every explosion, then any split rock's crack over its dust (#3596), then the bomb flash over
 * them — the top of the playfield on both renderers. Appends to `ops` and returns it.
 */
export function effectOps(
  state: StarSwarmState,
  width: number,
  height: number,
  ops: DrawOp[] = []
): DrawOp[] {
  for (const ex of state.explosions) explosionOps(ex, ops);
  for (const ex of state.explosions) splitCrackOps(ex, state.asteroids, ops);
  return bombFlashOps(state, width, height, ops);
}
