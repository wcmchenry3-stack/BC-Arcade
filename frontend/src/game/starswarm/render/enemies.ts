/**
 * #3593: the hive's look, shared by both renderers. Which sprites an enemy is drawn with (by tier,
 * HP, phase and the Carrier's stage), the lean into its sideways travel (at most 35°), and the code-drawn
 * parts around it: the hit flash, the flinch ticks, the Elite's flickering core and the Guardian's
 * smoke at 1 HP, and one fallback shape per tier while the sprites load.
 *
 * `buildFrame` (native Skia) appends these ops; `GameCanvas.web.tsx` replays the same ops with
 * `drawEnemyOps`, so the two cannot drift. Everything here only reads existing state: no engine
 * field was added, and nothing changes the hitbox (the sprite is drawn over the same box, plus a
 * transparent margin, and the bank turns the picture, never the box).
 *
 * Sprites, from `tools/assets/draw_starswarm_art.py` (design log
 * `docs/games/starswarm-art-design.md`):
 * - Grunt: G2 Wasp, one look (1 HP).
 * - Elite: E2 Mantis; the attack pose (scythes spread) while it dives or circles; at 1 HP a
 *   separate sprite with the right scythe snapped (that look wins over the attack pose), with
 *   a code-drawn core that flickers over its dull ember.
 * - Guardian: GD1 Scarab, with damage layers over the base: a blown plate and a dimmed emitter
 *   at 3 HP, cracks from 2 HP, a second plate and a dark emitter at 1 HP, plus code-drawn smoke.
 * - Carrier: C1 Queen, with a crack layer once its armour is down (exposed and final stand). #3625
 *   adds its code-drawn stage looks: a hive-shield bubble and links from each living Guardian while
 *   armoured, and a red-hot tint and glow in the final stand.
 */
import { FLINCH_MS, HIT_FLASH_DURATION } from "../engine";
import { withAlpha } from "./color";
import type { PackedColor } from "./color";
import { flinchWobble } from "./flinch";
import type { DrawOp } from "./frame";
import { debugOpKeys } from "./opKeys";
import {
  CORE_GLOW_RGB,
  CORE_HOT_RGB,
  ENEMY_FALLBACK,
  HEAT_RGB,
  HIT_CORE_RGB,
  HIT_RING_RGB,
  HIT_SPARK_RGB,
  HIVE_SHIELD_PALE_RGB,
  HIVE_SHIELD_RGB,
  SHELL_EDGE_RGB,
  SMOKE_RGB,
} from "./palette";
import type { Enemy, EnemyTier } from "../types";

/** Sprite names — identical to the `StarSwarmImages` fields they resolve to. */
export type EnemySpriteKey =
  | "enemyGrunt"
  | "enemyElite"
  | "enemyEliteAttack"
  | "enemyEliteHurt"
  | "enemyGuardian"
  | "enemyGuardianPlate"
  | "enemyGuardianCracks"
  | "enemyGuardianPlate2"
  | "enemyCarrier"
  | "enemyCarrierCracks";

/** Every enemy sprite, in the order both loaders load them. */
export const ENEMY_SPRITES: readonly EnemySpriteKey[] = [
  "enemyGrunt",
  "enemyElite",
  "enemyEliteAttack",
  "enemyEliteHurt",
  "enemyGuardian",
  "enemyGuardianPlate",
  "enemyGuardianCracks",
  "enemyGuardianPlate2",
  "enemyCarrier",
  "enemyCarrierCracks",
];

/**
 * Transparent margin around the tier's box in each enemy image, game px (12 px at 3x, the
 * generator's `PAD`): the sprite rect is the box grown by this on every side.
 */
export const ENEMY_SPRITE_PAD = 4;

/** The tier's own sprite: drawn alone if a look's first sprite has not loaded yet. */
const TIER_BASE: Record<EnemyTier, EnemySpriteKey> = {
  Grunt: "enemyGrunt",
  Elite: "enemyElite",
  Guardian: "enemyGuardian",
  Carrier: "enemyCarrier",
};

/** The tier's base sprite alone: what a look draws while its own first sprite loads. */
const TIER_BASE_ONLY: Record<EnemyTier, readonly EnemySpriteKey[]> = {
  Grunt: Object.freeze(["enemyGrunt"]),
  Elite: Object.freeze(["enemyElite"]),
  Guardian: Object.freeze(["enemyGuardian"]),
  Carrier: Object.freeze(["enemyCarrier"]),
};
const NOTHING: readonly EnemySpriteKey[] = Object.freeze([]);
// Each look's stack, bottom to top, built once so choosing one allocates nothing
const GRUNT: readonly EnemySpriteKey[] = Object.freeze(["enemyGrunt"]);
const ELITE: readonly EnemySpriteKey[] = Object.freeze(["enemyElite"]);
const ELITE_ATTACK: readonly EnemySpriteKey[] = Object.freeze(["enemyEliteAttack"]);
const ELITE_HURT: readonly EnemySpriteKey[] = Object.freeze(["enemyEliteHurt"]);
/** `GUARDIAN[n]`: the stack with `n` damage layers (4 HP: 0, 3 HP: 1, 2 HP: 2, 1 HP: 3). */
const GUARDIAN: readonly (readonly EnemySpriteKey[])[] = [
  ["enemyGuardian"],
  ["enemyGuardian", "enemyGuardianPlate"],
  ["enemyGuardian", "enemyGuardianPlate", "enemyGuardianCracks"],
  ["enemyGuardian", "enemyGuardianPlate", "enemyGuardianCracks", "enemyGuardianPlate2"],
].map((s) => Object.freeze(s as EnemySpriteKey[]));
const CARRIER: readonly EnemySpriteKey[] = Object.freeze(["enemyCarrier"]);
const CARRIER_CRACKED: readonly EnemySpriteKey[] = Object.freeze([
  "enemyCarrier",
  "enemyCarrierCracks",
]);

/** The Elite's attack phases: the pose with its scythes spread. */
function attacking(e: Enemy): boolean {
  return e.phase === "Diving" || e.phase === "Circling";
}

/**
 * The sprites an enemy is drawn with, bottom to top. `carrierArmored` is the Carrier's armour
 * (`isCarrierArmored`): its crack layer shows once that is down.
 */
export function enemyLayers(e: Enemy, carrierArmored: boolean): readonly EnemySpriteKey[] {
  switch (e.tier) {
    case "Grunt":
      return GRUNT;
    case "Elite":
      if (e.hp <= 1) return ELITE_HURT;
      return attacking(e) ? ELITE_ATTACK : ELITE;
    case "Guardian":
      return GUARDIAN[Math.min(3, Math.max(0, 4 - Math.ceil(e.hp)))]!;
    case "Carrier":
      return carrierArmored ? CARRIER : CARRIER_CRACKED;
  }
}

// --- Banking --------------------------------------------------------------------------------

/**
 * How far from the start and the end of a path the bank eases in and out, px: a ship leaving
 * its slot leans into its path over this distance, and one arriving turns back to face down, so
 * it never snaps on the frame it settles. Measured from the path's end points, which
 * a rock nudge keeps (it re-splits the path at the ship), so the ease does not restart then.
 */
export const BANK_EASE_PX = 28;
/** The same ease for a Circling loop, by the angle swept since it began and left to sweep, rad. */
export const BANK_EASE_RAD = 0.6;
/** The angle a Circling loop starts at and how far it sweeps before it returns (enemyPhases.ts). */
const CIRCLE_START = Math.PI / 2;
const CIRCLE_SWEEP = Math.PI * 2;

/**
 * The most a ship leans, rad (35°). Owner review of #3593: turning the sprite fully to face its
 * travel (up to a whole turn on a loop) read as too much motion, so a ship only leans into its
 * sideways motion and keeps facing down otherwise.
 */
export const BANK_MAX_RAD = (35 * Math.PI) / 180;

/**
 * The lean for travel along (dx, dy): `BANK_MAX_RAD` times the sideways share of the motion, so
 * straight down or up is 0 and straight sideways is the full lean. Continuous in the direction
 * (no flip when a ship heads up), so a phase change never snaps more than the cap. 0 when still.
 */
function headingOf(dx: number, dy: number): number {
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return 0;
  return (-dx / len) * BANK_MAX_RAD;
}

/**
 * The bank, radians: 0 faces down (the sprites' rest pose), positive turns clockwise on screen.
 * Ships on a path (swoop in, dive, return, flee, the Carrier's attack run) lean into the path's
 * tangent at `pathT`; a Circling ship leans into its loop. The lean is at most `BANK_MAX_RAD`. In formation, wiggling, or waiting
 * out a swoop's stagger, it faces down. A pure function of existing state: no engine field.
 */
export function enemyBank(e: Enemy): number {
  switch (e.phase) {
    case "SwoopIn":
    case "Diving":
    case "Returning":
    case "Fleeing":
    case "AttackRun": {
      const p = e.path;
      if (!p || e.pathT < 0) return 0;
      const t = Math.min(1, e.pathT);
      const u = 1 - t;
      // the cubic's derivative at t
      const a = 3 * u * u;
      const b = 6 * u * t;
      const c = 3 * t * t;
      const dx = a * (p.p1.x - p.p0.x) + b * (p.p2.x - p.p1.x) + c * (p.p3.x - p.p2.x);
      const dy = a * (p.p1.y - p.p0.y) + b * (p.p2.y - p.p1.y) + c * (p.p3.y - p.p2.y);
      const fromStart = Math.hypot(e.x - p.p0.x, e.y - p.p0.y);
      const toEnd = Math.hypot(e.x - p.p3.x, e.y - p.p3.y);
      const ease = Math.min(1, fromStart / BANK_EASE_PX, toEnd / BANK_EASE_PX);
      return headingOf(dx, dy) * ease;
    }
    case "Circling": {
      const dir = e.circleSpeed < 0 ? -1 : 1;
      const swept = Math.abs(e.circleAngle - CIRCLE_START);
      const ease = Math.max(
        0,
        Math.min(1, swept / BANK_EASE_RAD, (CIRCLE_SWEEP - swept) / BANK_EASE_RAD)
      );
      return headingOf(-Math.sin(e.circleAngle) * dir, Math.cos(e.circleAngle) * dir) * ease;
    }
    default:
      return 0;
  }
}

// --- Fallback shapes ------------------------------------------------------------------------

/** One shape per tier, flat [x, y, …] in box units about the centre, pointing down. */
const FALLBACK_SHAPE: Record<EnemyTier, readonly number[]> = {
  // a down-pointing dart
  Grunt: [-0.5, -0.4, 0.5, -0.4, 0, 0.5],
  // an arrowhead with swept wings
  Elite: [0, -0.5, 0.5, -0.15, 0.18, 0.08, 0, 0.5, -0.18, 0.08, -0.5, -0.15],
  // a domed shell (octagon)
  Guardian: Array.from({ length: 16 }, (_, i) => {
    const a = (Math.floor(i / 2) * Math.PI) / 4 + Math.PI / 8;
    return (i % 2 === 0 ? Math.cos(a) : Math.sin(a)) * 0.5;
  }),
  // a broad hull with a crown and a tail
  Carrier: [-0.5, -0.25, -0.2, -0.5, 0.2, -0.5, 0.5, -0.25, 0.32, 0.4, 0, 0.5, -0.32, 0.4],
};

/** `units` scaled to the box, turned by `rot` and moved to (cx, cy). */
function placed(
  units: readonly number[],
  cx: number,
  cy: number,
  w: number,
  h: number,
  rot: number
): number[] {
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  const out: number[] = [];
  for (let i = 0; i + 1 < units.length; i += 2) {
    const x = units[i]! * w;
    const y = units[i + 1]! * h;
    out.push(cx + x * cos - y * sin, cy + x * sin + y * cos);
  }
  return out;
}

// --- Code-drawn effects ---------------------------------------------------------------------

/** The Elite's core, as a fraction of its box from the centre (generator `MANTIS_CORE`). */
const ELITE_CORE_DY = 0.42 - 0.5;
/** The flicker's frame length, ms: two frames, core on and off. */
export const CORE_FLICKER_MS = 80;
/** Smoke: two vents on the Guardian's shell (box fractions from the centre) and a puff's life, ms. */
const SMOKE_VENTS: readonly number[] = [-0.2, -0.3, 0.22, -0.32];
export const SMOKE_PUFF_MS = 900;
/** How far a puff drifts over its life, px. */
const SMOKE_DRIFT_PX = 8;
/** The flinch ticks, box units about the centre: thin bars just outside each flank. */
const FLINCH_TICK_L: readonly number[] = [-0.62, -0.22, -0.7, -0.22, -0.7, 0.22, -0.62, 0.22];
const FLINCH_TICK_R: readonly number[] = [0.62, -0.22, 0.7, -0.22, 0.7, 0.22, 0.62, 0.22];
const CORE_GLOW = withAlpha(CORE_GLOW_RGB, 0.75);
const CORE_HOT = withAlpha(CORE_HOT_RGB, 1);
// The Carrier's stage looks (#3625), colours built once
const BUBBLE_FILL = withAlpha(HIVE_SHIELD_RGB, 0.12);
const BUBBLE_HEX = withAlpha(HIVE_SHIELD_PALE_RGB, 0.55);
const HEAT_TINT = withAlpha(HEAT_RGB, 0.2);
/** Hit-flash sparks per hit. */
const HIT_SPARKS = 4;

/**
 * A clock the state already keeps, for the flicker and the smoke: `nextDiveTimer` counts down
 * every Playing tick and freezes with the game (paused, it stands still). When it resets, the
 * effect just jumps phase. Offset per ship, so a row of damaged ships does not pulse in step.
 */
function effectClock(clock: number, id: number, period: number): number {
  const t = clock + id * 53;
  return ((t % period) + period) % period;
}

/** Whether the Elite's core is lit on this frame (the first of the two flicker frames). */
export function eliteCoreLit(clock: number, id: number): boolean {
  return effectClock(clock, id, 2 * CORE_FLICKER_MS) < CORE_FLICKER_MS;
}

/**
 * Where one enemy is drawn this frame: its box centre (with the flinch's sideways jitter), size,
 * and the turn (bank plus flinch tilt) with its cosine and sine. One scratch object, reused for
 * every enemy, so a frame allocates nothing for it.
 */
interface Pose {
  cx: number;
  cy: number;
  w: number;
  h: number;
  rot: number;
  cos: number;
  sin: number;
}
const POSE: Pose = { cx: 0, cy: 0, w: 0, h: 0, rot: 0, cos: 1, sin: 0 };

function poseOf(e: Enemy): Pose {
  const wobble = flinchWobble(e.flinchMs); // #2881: the flinch adds on top of the bank
  POSE.cx = e.x + wobble.dx;
  POSE.cy = e.y;
  POSE.w = e.width;
  POSE.h = e.height;
  POSE.rot = enemyBank(e) + wobble.rotate;
  POSE.cos = Math.cos(POSE.rot);
  POSE.sin = Math.sin(POSE.rot);
  return POSE;
}

/** The enemy's sprites (each the box plus its margin), or its tier's fallback shape. */
function bodyOps(
  e: Enemy,
  q: Pose,
  loaded: Readonly<Record<EnemySpriteKey, boolean>>,
  carrierArmored: boolean,
  ops: DrawOp[],
  key: string | undefined
): void {
  let layers = enemyLayers(e, carrierArmored);
  if (!loaded[layers[0]!]) layers = loaded[TIER_BASE[e.tier]] ? TIER_BASE_ONLY[e.tier] : NOTHING;
  if (layers.length === 0) {
    ops.push({
      k: "poly",
      key,
      points: placed(FALLBACK_SHAPE[e.tier], q.cx, q.cy, q.w, q.h, q.rot),
      color: ENEMY_FALLBACK,
    });
    return;
  }
  const m = ENEMY_SPRITE_PAD;
  const rotate = q.rot !== 0 ? q.rot : undefined;
  for (let i = 0; i < layers.length; i++) {
    const sprite = layers[i]!;
    if (!loaded[sprite]) continue; // a damage layer still loading
    ops.push({
      k: "image",
      key: key && (i === 0 ? key : `${key}-${sprite}`),
      sprite,
      x: q.cx - q.w / 2 - m,
      y: q.cy - q.h / 2 - m,
      w: q.w + 2 * m,
      h: q.h + 2 * m,
      fit: "fill",
      rotate,
    });
  }
}

/** The Elite at 1 HP: its core flickers (two frames) over the ember baked into the sprite. */
function coreFlickerOps(q: Pose, ops: DrawOp[], key: string | undefined): void {
  const dy = ELITE_CORE_DY * q.h; // the core sits on the centre line, so only its y offset turns
  const x = q.cx - dy * q.sin;
  const y = q.cy + dy * q.cos;
  ops.push(
    {
      k: "circle",
      key: key && `${key}-core`,
      cx: x,
      cy: y,
      r: q.w * 0.09,
      color: CORE_GLOW,
    },
    {
      k: "circle",
      key: key && `${key}-core-hot`,
      cx: x,
      cy: y,
      r: q.w * 0.035,
      color: CORE_HOT,
    }
  );
}

/** The Guardian at 1 HP smokes: a puff from each vent drifts back off the shell and fades. */
function smokeOps(e: Enemy, q: Pose, clock: number, ops: DrawOp[], key: string | undefined) {
  for (let v = 0; v + 1 < SMOKE_VENTS.length; v += 2) {
    // the clock counts down, so a puff's age (0 new, 1 gone) runs the other way
    const p = 1 - effectClock(clock, e.id + v * 7, SMOKE_PUFF_MS) / SMOKE_PUFF_MS;
    const sx = SMOKE_VENTS[v]! * q.w;
    const sy = SMOKE_VENTS[v + 1]! * q.h - p * SMOKE_DRIFT_PX; // back, against the heading
    ops.push({
      k: "circle",
      key: key && `${key}-smoke-${v / 2}`,
      cx: q.cx + sx * q.cos - sy * q.sin,
      cy: q.cy + sx * q.sin + sy * q.cos,
      r: 2.5 + 3 * p,
      color: withAlpha(SMOKE_RGB, 0.55 * (1 - p)),
    });
  }
}

/** The flinch (#2881): two short rim-light ticks either side of the ship, fading out with it. */
function flinchOps(e: Enemy, q: Pose, ops: DrawOp[], key: string | undefined): void {
  const color = withAlpha(SHELL_EDGE_RGB, 0.7 * Math.min(1, e.flinchMs / FLINCH_MS));
  for (let side = -1; side <= 1; side += 2) {
    ops.push({
      k: "poly",
      key: key && `${key}-flinch-${side < 0 ? "l" : "r"}`,
      points: placed(side < 0 ? FLINCH_TICK_L : FLINCH_TICK_R, q.cx, q.cy, q.w, q.h, q.rot),
      color,
    });
  }
}

/** One enemy's ops, back to front: sprites or fallback, then its damage and flinch effects. */
function oneEnemyOps(
  e: Enemy,
  loaded: Readonly<Record<EnemySpriteKey, boolean>>,
  carrierArmored: boolean,
  clock: number,
  ops: DrawOp[],
  key: string | undefined
): void {
  const q = poseOf(e);
  bodyOps(e, q, loaded, carrierArmored, ops, key);
  if (e.tier === "Elite" && e.hp <= 1 && eliteCoreLit(clock, e.id)) coreFlickerOps(q, ops, key);
  if (e.tier === "Guardian" && e.hp <= 1) smokeOps(e, q, clock, ops, key);
  if (e.flinchMs > 0) flinchOps(e, q, ops, key);
}

/**
 * Hit-flash burst for something `timer` ms into its flash (#1310/#974), normalized against
 * `duration` — the full flash length the timer counts down from (ships use `HIT_FLASH_DURATION`;
 * #2573's asteroid ring uses the shorter `ASTEROID_HIT_FLASH_MS`, so it still starts at full
 * intensity instead of already 52% decayed).
 */
export function hitFlash(
  w: number,
  h: number,
  timer: number,
  duration: number = HIT_FLASH_DURATION
): { r: number; fillAlpha: number; strokeAlpha: number } {
  const progress = 1 - timer / duration;
  const r = Math.max(w, h) * 1.2 * (0.6 + 0.5 * progress);
  const a = timer / duration; // 1 → 0 as the burst plays
  return { r, fillAlpha: a * 0.25, strokeAlpha: a * 0.75 };
}

/**
 * #3593: the enemy hit flash in style B — a white-hot core, a ring in the hot crack colour and
 * four sparks flying out, on the same timing and radius as before. In world space (it does not
 * turn with the bank).
 */
export function enemyHitFlashOps(e: Enemy, ops: DrawOp[], key: string | undefined): void {
  hitFlashBurstOps(
    e.id,
    e.x,
    e.y,
    e.width,
    e.height,
    e.hitFlashTimer,
    HIT_FLASH_DURATION,
    ops,
    key
  );
}

/**
 * The hit flash family's burst (#3593), for anything `w` x `h` centred on (cx, cy) that is
 * `timer` ms into a flash of `duration` ms: the core, the ring and the sparks (their angles
 * offset by `id`). Shared by the enemies and, since #3596, the rocks.
 */
export function hitFlashBurstOps(
  id: number,
  cx: number,
  cy: number,
  w: number,
  h: number,
  timer: number,
  duration: number,
  ops: DrawOp[],
  key: string | undefined
): void {
  const f = hitFlash(w, h, timer, duration);
  ops.push(
    {
      k: "circle",
      key: key && `${key}-flash`,
      cx,
      cy,
      r: f.r * 0.6,
      color: withAlpha(HIT_CORE_RGB, f.fillAlpha * 1.6),
    },
    {
      k: "circle",
      key: key && `${key}-flash-ring`,
      cx,
      cy,
      r: f.r,
      color: withAlpha(HIT_RING_RGB, f.strokeAlpha),
      stroke: 2,
    }
  );
  const spark: PackedColor = withAlpha(HIT_SPARK_RGB, f.strokeAlpha);
  for (let i = 0; i < HIT_SPARKS; i++) {
    const a = ((i + 0.5) * 2 * Math.PI) / HIT_SPARKS + id * 0.7;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const inner = f.r * 0.55;
    const tip = f.r * 0.95;
    ops.push({
      k: "poly",
      key: key && `${key}-flash-spark-${i}`,
      points: [
        cx + ca * inner - sa * 1.2,
        cy + sa * inner + ca * 1.2,
        cx + ca * tip,
        cy + sa * tip,
        cx + ca * inner + sa * 1.2,
        cy + sa * inner - ca * 1.2,
      ],
      color: spark,
    });
  }
}

// --- The Carrier's stage looks (#3625) -------------------------------------------------------

/** The bubble's radius, as a share of the Carrier box's longer side (the old ring sat at 0.62). */
const BUBBLE_R = 0.68;
/** Hex-cell hints on the bubble: how many, each one's arc half-length (rad), and the drift period, ms. */
const BUBBLE_HEXES = 6;
const BUBBLE_HEX_HALF = 0.17;
/** cos / sin of each hint's two end angles at rest, [start, end] per hint, built once. */
const HEX_ENDS = Array.from({ length: BUBBLE_HEXES }, (_, k) => {
  const a = (k * 2 * Math.PI) / BUBBLE_HEXES;
  return [a - BUBBLE_HEX_HALF, a + BUBBLE_HEX_HALF] as const;
}).flat();
const HEX_COS: readonly number[] = Object.freeze(HEX_ENDS.map(Math.cos));
const HEX_SIN: readonly number[] = Object.freeze(HEX_ENDS.map(Math.sin));
const BUBBLE_SHIMMER_MS = 2400;
/** The shield links' widths (glow, core), px, and the period of the pulse running along one, ms. */
const LINK_GLOW_W = 4;
const LINK_CORE_W = 1.4;
const LINK_PULSE_MS = 1200;
/** The final stand's heat pulse period, ms. */
const HEAT_PULSE_MS = 1000;

/**
 * Armoured: a translucent pink-violet hive-shield bubble around the Carrier — a soft fill, a bright
 * rim that breathes, and hex-cell hints drifting round the rim (the old #2484 ring, restyled).
 */
function bubbleOps(e: Enemy, clock: number, ops: DrawOp[], key: string | undefined): void {
  const r = Math.max(e.width, e.height) * BUBBLE_R;
  const t = effectClock(clock, e.id, BUBBLE_SHIMMER_MS) / BUBBLE_SHIMMER_MS; // 1 → 0, counting down
  const breath = 0.5 + 0.5 * Math.sin(t * 2 * Math.PI);
  ops.push(
    {
      k: "circle",
      key: key && `${key}-bubble`,
      cx: e.x,
      cy: e.y,
      r,
      color: BUBBLE_FILL,
    },
    {
      k: "circle",
      key: key && `${key}-bubble-rim`,
      cx: e.x,
      cy: e.y,
      r,
      color: withAlpha(HIVE_SHIELD_RGB, 0.5 + 0.2 * breath),
      stroke: 1.5,
    }
  );
  // each hint's ends are the precomputed base angles turned by t (angle addition, no trig per hint)
  const ct = Math.cos(t * 2 * Math.PI);
  const st = Math.sin(t * 2 * Math.PI);
  const ri = r - 1.5;
  const ro = r + 0.5;
  for (let k = 0; k < BUBBLE_HEXES; k++) {
    const c0 = HEX_COS[2 * k]! * ct - HEX_SIN[2 * k]! * st;
    const s0 = HEX_SIN[2 * k]! * ct + HEX_COS[2 * k]! * st;
    const c1 = HEX_COS[2 * k + 1]! * ct - HEX_SIN[2 * k + 1]! * st;
    const s1 = HEX_SIN[2 * k + 1]! * ct + HEX_COS[2 * k + 1]! * st;
    // a poly op owns its points (as in carrier.ts): consumers may keep the op, so a fresh array
    ops.push({
      k: "poly",
      key: key && `${key}-bubble-hex-${k}`,
      points: [
        e.x + c0 * ri,
        e.y + s0 * ri,
        e.x + c1 * ri,
        e.y + s1 * ri,
        e.x + c1 * ro,
        e.y + s1 * ro,
        e.x + c0 * ro,
        e.y + s0 * ro,
      ],
      color: BUBBLE_HEX,
    });
  }
}

/** How far from its formation slot a Guardian's link has faded out, px (linear). */
const LINK_FADE_PX = 40;
/** Below this strength a link is too faint to see, so it is skipped. */
const LINK_MIN_STRENGTH = 0.02;

/**
 * A ship's link strength 0-1: full while settled in Formation or Wiggling, otherwise fading
 * linearly with its distance from its formation slot, gone at `LINK_FADE_PX`. A link uses the
 * weaker of its Guardian's and its Carrier's (#3650).
 */
function linkStrength(g: Enemy): number {
  if (g.phase === "Formation" || g.phase === "Wiggling") return 1;
  const d = Math.hypot(g.x - g.formationX, g.y - g.formationY);
  return Math.max(0, 1 - d / LINK_FADE_PX);
}

/** A line from (x0, y0) to (x1, y1) as a quad `width` px wide, appended as a filled poly. */
function lineOp(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  width: number,
  color: PackedColor,
  ops: DrawOp[],
  key: string | undefined
): void {
  const len = Math.hypot(x1 - x0, y1 - y0) || 1;
  const nx = (-(y1 - y0) / len) * (width / 2);
  const ny = ((x1 - x0) / len) * (width / 2);
  ops.push({
    k: "poly",
    key,
    points: [x0 + nx, y0 + ny, x1 + nx, y1 + ny, x1 - nx, y1 - ny, x0 - nx, y0 - ny],
    color,
  });
}

/**
 * Armoured: one energy link from each LIVING Guardian in formation (fading as it or the Carrier
 * leaves its slot) to the Carrier's bubble, with a bead of light running along it. Drawn under the ships, so a
 * link seems to leave the Guardian's centre (hidden under its sprite) and end on the bubble's rim.
 */
function linkOps(
  c: Enemy,
  enemies: readonly Enemy[],
  clock: number,
  ops: DrawOp[],
  key: string | undefined
): void {
  const r = Math.max(c.width, c.height) * BUBBLE_R;
  // #3650: the Carrier must be at its slot too — while it swoops in (or is away on an attack run)
  // its links fade with its own distance from the slot, so none stretch across the screen
  const carrierStr = linkStrength(c);
  if (carrierStr < LINK_MIN_STRENGTH) return;
  for (const g of enemies) {
    if (!g.isAlive || g.tier !== "Guardian") continue;
    const dx = c.x - g.x;
    const dy = c.y - g.y;
    const len = Math.hypot(dx, dy);
    if (len <= r) continue; // inside the bubble: nothing to link across
    const str = Math.min(linkStrength(g), carrierStr);
    if (str < LINK_MIN_STRENGTH) continue; // out of formation (or too faint to show): no link
    const ex = c.x - (dx / len) * r;
    const ey = c.y - (dy / len) * r;
    const k = key && `${key}-link-${g.id}`;
    lineOp(g.x, g.y, ex, ey, LINK_GLOW_W, withAlpha(HIVE_SHIELD_RGB, 0.25 * str), ops, k);
    lineOp(
      g.x,
      g.y,
      ex,
      ey,
      LINK_CORE_W,
      withAlpha(HIVE_SHIELD_PALE_RGB, 0.7 * str),
      ops,
      k && `${k}-core`
    );
    const p = 1 - effectClock(clock, g.id, LINK_PULSE_MS) / LINK_PULSE_MS; // runs Guardian → Carrier
    ops.push({
      k: "circle",
      key: k && `${k}-pulse`,
      cx: g.x + (ex - g.x) * p,
      cy: g.y + (ey - g.y) * p,
      r: 2,
      color: withAlpha(HIVE_SHIELD_PALE_RGB, 0.95 * str),
    });
  }
}

/** Final stand, under the sprite: a red glow that pulses. */
function heatGlowOps(e: Enemy, clock: number, ops: DrawOp[], key: string | undefined): void {
  const t = effectClock(clock, e.id, HEAT_PULSE_MS) / HEAT_PULSE_MS;
  const pulse = 0.5 + 0.5 * Math.sin(t * 2 * Math.PI);
  const r = Math.max(e.width, e.height);
  ops.push(
    {
      k: "circle",
      key: key && `${key}-heat-glow`,
      cx: e.x,
      cy: e.y,
      r: r * 0.78,
      color: withAlpha(HEAT_RGB, 0.12 + 0.1 * pulse),
    },
    {
      k: "circle",
      key: key && `${key}-heat-glow-core`,
      cx: e.x,
      cy: e.y,
      r: r * 0.58,
      color: withAlpha(HEAT_RGB, 0.18 + 0.12 * pulse),
    }
  );
}

/** Final stand, over the sprite: the red-hot tint. */
function heatTintOps(e: Enemy, ops: DrawOp[], key: string | undefined): void {
  ops.push({
    k: "circle",
    key: key && `${key}-heat-tint`,
    cx: e.x,
    cy: e.y,
    r: Math.max(e.width, e.height) * 0.46,
    color: HEAT_TINT,
  });
}

export interface EnemyOpsInput {
  readonly enemies: readonly Enemy[];
  /** `isCarrierArmored(state)`. */
  readonly carrierArmored: boolean;
  /** The effect clock (`state.nextDiveTimer`). */
  readonly clock: number;
  readonly loaded: Readonly<Record<EnemySpriteKey, boolean>>;
}

/**
 * Every live enemy, back to front: the Carrier's shield links (under the ships), then each
 * enemy's sprites (or fallback) and effects — the Carrier's bubble while armoured, its heat in the
 * final stand — and its hit flash. Appends to `ops` and returns it.
 */
export function enemyOps(input: EnemyOpsInput, ops: DrawOp[] = []): DrawOp[] {
  const dbg = debugOpKeys();
  // One pass finds the Carrier and whether anything but it still fights. The final stand is
  // `carrierStageIn(enemies) === "finalStand"`, derived here without its three `.some` closures:
  // no live Guardian (not armoured) and no live non-Carrier ship that has not fled.
  let carrier: Enemy | null = null;
  let others = false;
  for (const e of input.enemies) {
    if (!e.isAlive) continue;
    if (e.tier === "Carrier") carrier ??= e;
    else if (e.phase !== "Fleeing") others = true;
  }
  const finalStand = carrier !== null && !input.carrierArmored && !others;
  if (carrier && input.carrierArmored) {
    linkOps(carrier, input.enemies, input.clock, ops, dbg ? `en-${carrier.id}` : undefined);
  }
  for (const e of input.enemies) {
    if (!e.isAlive) continue;
    const key = dbg ? `en-${e.id}` : undefined;
    const heat = finalStand && e.tier === "Carrier";
    if (heat) heatGlowOps(e, input.clock, ops, key);
    oneEnemyOps(e, input.loaded, input.carrierArmored, input.clock, ops, key);
    if (heat) heatTintOps(e, ops, key);
    if (e.tier === "Carrier" && input.carrierArmored) bubbleOps(e, input.clock, ops, key);
    if (e.hitFlashTimer > 0) enemyHitFlashOps(e, ops, key);
  }
  return ops;
}

/** One-op list reused for every shape `drawEnemyOps` hands on, so a frame allocates none. */
const SHAPE_SCRATCH: DrawOp[] = [];

/**
 * Replay enemy ops on a 2D canvas context (web). Image ops turn about their rect's centre, as
 * Skia's `canvas.rotate(deg, px, py)` does on native; shapes go through `drawShape`. #3594: the
 * shots (`shotOps`) replay through it too, with their own image set.
 */
export function drawEnemyOps(
  ctx: CanvasRenderingContext2D,
  ops: readonly DrawOp[],
  images: Readonly<Record<string, CanvasImageSource | null>>,
  drawShape: (ctx: CanvasRenderingContext2D, ops: readonly DrawOp[]) => void
): void {
  for (const op of ops) {
    if (op.k === "image") {
      const img = images[op.sprite];
      if (!img) continue;
      if (op.rotate) {
        const cx = op.x + op.w / 2;
        const cy = op.y + op.h / 2;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(op.rotate);
        ctx.drawImage(img, -op.w / 2, -op.h / 2, op.w, op.h);
        ctx.restore();
      } else {
        ctx.drawImage(img, op.x, op.y, op.w, op.h);
      }
    } else {
      SHAPE_SCRATCH[0] = op;
      drawShape(ctx, SHAPE_SCRATCH);
    }
  }
}
