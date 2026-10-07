/**
 * #2564 (epic #2562, phase 2): every "what do we draw for this state" decision for the native
 * canvas, as a pure function returning a flat, ordered display list of primitive draw ops.
 *
 * The ops are plain data — numbers and sprite keys, no Skia objects and no functions — so the
 * list can be replayed on the UI thread (#2565) by `drawFrame.ts`, a worklet that makes no
 * decisions of its own. Draw order is list order (painter's algorithm), so the order below is the
 * z-order on screen.
 *
 * #2963: the background and starfield are not in the list — they are recorded once into their
 * own Pictures and scrolled on the UI thread (`starfieldPictures.ts`), drawn under this one.
 * Colours are packed numbers (`color.ts`), and op keys exist only while `setDebugOpKeys` is on.
 *
 * The web renderer (`GameCanvas.web.tsx`, unmaintained) still derives the same rules itself.
 */
import {
  BULLET_C_W,
  HIT_FLASH_DURATION,
  ASTEROID_HIT_FLASH_MS,
  isCarrierArmored,
  asteroidOutline,
  hashFrac,
} from "../engine";
import { buddyOps } from "./buddy";
import { carrierOps } from "./carrier";
import { withAlpha } from "./color";
import type { PackedColor } from "./color";
import { flinchWobble } from "./flinch";
import { debugOpKeys } from "./opKeys";
import { isUpgradePickup, upgradePickupOps } from "./pickups";
import type { UpgradePickupType } from "./pickups";
import type { EnemyTier, PowerUpType, StarSwarmState } from "../types";

/** Explosion sprite draw size, px. */
export const EXPLOSION_DRAW_SIZE = 48;
/** The player ship blinks on this interval while invincible, ms. */
export const INVINCIBLE_BLINK_INTERVAL = 120;
/** Buddy ship sprite size, px (square, centred on the ship). */
export const BUDDY_SIZE = 34;
/** Explosion strip length — the procedural fallback's progress runs over this many frames. */
const EXPLOSION_FRAME_COUNT = 20;

/** Sprite names — identical to the `StarSwarmImages` fields they resolve to. */
export type SpriteKey =
  | "playerShip"
  | "buddyShip"
  | "enemyGrunt"
  | "enemyElite"
  | "enemyGuardian"
  | "enemyCarrier"
  | "bulletPlayer"
  | "puShield"
  | "puBomb"
  | "puBuddy"
  | "puLightning"
  | "asteroid1"
  | "asteroid2"
  | "asteroid3"
  | "asteroid4"
  | "explosion";

/**
 * #2573: the four Kenney meteor designs a rock's sprite is randomly picked from. Collision uses
 * `radius`, not the art, so one design serves both `large` and `small` rocks — each is just drawn
 * at a different `2 × radius` size.
 */
export const ASTEROID_SPRITES = ["asteroid1", "asteroid2", "asteroid3", "asteroid4"] as const;

/** Which sprites have finished loading; a missing one draws its procedural fallback instead. */
export type LoadedSprites = Readonly<Record<Exclude<SpriteKey, "explosion">, boolean>> & {
  /** One flag per explosion frame. */
  readonly explosion: readonly boolean[];
};

/**
 * A primitive draw op. Colours are packed `0xAARRGGBB` numbers (#2963, see `color.ts`). `key`
 * is stable per entity and only present while `setDebugOpKeys(true)` is on — tests and
 * debugging use it to find an op; the app never builds it.
 */
export type DrawOp =
  | { readonly k: "fill"; readonly key?: string; readonly color: PackedColor }
  | {
      readonly k: "rect";
      readonly key?: string;
      readonly x: number;
      readonly y: number;
      readonly w: number;
      readonly h: number;
      readonly color: PackedColor;
      readonly opacity?: number;
    }
  | {
      readonly k: "circle";
      readonly key?: string;
      readonly cx: number;
      readonly cy: number;
      readonly r: number;
      readonly color: PackedColor;
      readonly opacity?: number;
      /** Stroke width; absent = filled. */
      readonly stroke?: number;
    }
  | {
      readonly k: "image";
      readonly key?: string;
      readonly sprite: SpriteKey;
      /** Explosion frame index (only for `sprite: "explosion"`). */
      readonly frame?: number;
      readonly x: number;
      readonly y: number;
      readonly w: number;
      readonly h: number;
      /** "fill" stretches to the rect; "contain" keeps aspect (Skia's default). */
      readonly fit: "fill" | "contain";
      /** Mirror horizontally about the rect's centre. */
      readonly flipX?: boolean;
      /** Rotate about the rect's centre, radians (#2573: asteroid `rotation`). */
      readonly rotate?: number;
    }
  | {
      readonly k: "poly";
      readonly key?: string;
      /** Closed polygon, flat [x0, y0, x1, y1, …]. */
      readonly points: readonly number[];
      readonly color: PackedColor;
      /** Stroke width; absent = filled. */
      readonly stroke?: number;
    };

export interface FrameOptions {
  readonly loaded: LoadedSprites;
  /** Canvas size in logical px (the bomb flash covers it). */
  readonly width: number;
  readonly height: number;
}

const TIER_SPRITE: Record<EnemyTier, Exclude<SpriteKey, "explosion">> = {
  Grunt: "enemyGrunt",
  Elite: "enemyElite",
  Guardian: "enemyGuardian",
  Carrier: "enemyCarrier",
};
const TIER_FALLBACK: Record<EnemyTier, PackedColor> = {
  Grunt: 0xff8888ff,
  Elite: 0xffff88ff,
  Guardian: 0xffffff44,
  Carrier: 0xffb06cff,
};
const POWERUP_SPRITE: Partial<Record<PowerUpType, Exclude<SpriteKey, "explosion">>> = {
  shield: "puShield",
  bomb: "puBomb",
  buddy: "puBuddy",
  lightning: "puLightning",
};

/** The shield / armor blue every ring and flash below is drawn in. */
const SHIELD_RGB = 0x00aaff;
const ARMOR_RING = withAlpha(SHIELD_RGB, 0.45);
const SHIELD_FILL = withAlpha(SHIELD_RGB, 0.25);
const SHIELD_RING = withAlpha(SHIELD_RGB, 0.75);
const LIGHTNING_TINT = withAlpha(0xffee00, 0.45);
const BUDDY_FALLBACK = withAlpha(0x0078ff, 0.8);
const PU_SHIELD = withAlpha(SHIELD_RGB, 0.9);
const PU_BOMB = withAlpha(0xff5000, 0.9);
const PU_BUDDY = withAlpha(0x00ffc8, 0.9);

/** Whether the player ship and its overlays are drawn this frame. */
export function playerVisible(state: StarSwarmState): boolean {
  const { player } = state;
  const blink =
    player.invincibleTimer > 0 &&
    Math.floor(player.invincibleTimer / INVINCIBLE_BLINK_INTERVAL) % 2 === 1;
  // #2334: tick() freezes the instant phase becomes GameOver, so the ship would otherwise render
  // frozen mid-frame (looking like it's still flying/firing) instead of appearing destroyed.
  return !blink && player.y + player.height > 0 && state.phase !== "GameOver";
}

/**
 * Hit-flash burst ring for something `timer` ms into its flash (#1310/#974), normalized against
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

/** Flatten points, rounded to 0.1 px — what the asteroid path used before #2564. */
function flatRounded(points: readonly { x: number; y: number }[]): number[] {
  const out: number[] = [];
  for (const p of points) out.push(Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10);
  return out;
}

/**
 * #2573: which of the 4 meteor designs a rock draws — stable for the rock's lifetime (shares
 * `asteroidOutline`'s hash, see `hashFrac`) without needing a field on `Asteroid`.
 */
function asteroidSprite(id: number): (typeof ASTEROID_SPRITES)[number] {
  const frac = hashFrac(id * 78.233);
  return ASTEROID_SPRITES[Math.floor(frac * ASTEROID_SPRITES.length)]!;
}

/** The whole native-canvas scene for one frame (above the starfield), back to front. */
export function buildFrame(state: StarSwarmState, opts: FrameOptions): DrawOp[] {
  const { loaded } = opts;
  const dbg = debugOpKeys(); // #2963: keys only for tests and debugging
  const ops: DrawOp[] = [];

  // Enemy bullets — #2487 flak is amber. #2842: every shot in flight is live (none is ever
  // "harmless"), so none is dimmed.
  for (const b of state.enemyBullets) {
    ops.push({
      k: "rect",
      key: dbg ? `eb-${b.id}` : undefined,
      x: b.x - b.width / 2,
      y: b.y - b.height / 2,
      w: b.width,
      h: b.height,
      color: b.flak ? 0xffffd27a : 0xffff4422,
    });
  }

  // Player bullets — charge bullets (wider) as a distinct cyan beam
  for (const b of state.playerBullets) {
    const key = dbg ? `pb-${b.id}` : undefined;
    const x = b.x - b.width / 2;
    const y = b.y - b.height / 2;
    const w = b.width;
    const h = b.height;
    if (b.width >= BULLET_C_W) {
      ops.push({ k: "rect", key, x, y, w, h, color: 0xff00f0ff });
    } else if (loaded.bulletPlayer) {
      ops.push({ k: "image", key, sprite: "bulletPlayer", x, y, w, h, fit: "fill" });
    } else {
      ops.push({ k: "rect", key, x, y, w, h, color: 0xff00ffcc });
    }
  }

  // Enemies — sprite, #2484 armor ring, hit-flash burst
  const armored = isCarrierArmored(state);
  for (const e of state.enemies) {
    if (!e.isAlive) continue;
    const key = dbg ? `en-${e.id}` : undefined;
    const wobble = flinchWobble(e.flinchMs); // #2881: reaction cue
    const x = e.x - e.width / 2 + wobble.dx;
    const y = e.y - e.height / 2;
    const w = e.width;
    const h = e.height;
    const sprite = TIER_SPRITE[e.tier];
    if (loaded[sprite]) {
      const rotate = wobble.rotate !== 0 ? wobble.rotate : undefined;
      ops.push({ k: "image", key, sprite, x, y, w, h, fit: "fill", rotate });
    } else {
      ops.push({ k: "rect", key, x, y, w, h, color: TIER_FALLBACK[e.tier] });
    }
    if (e.tier === "Carrier" && armored) {
      ops.push({
        k: "circle",
        key: dbg ? `${key}-ring` : undefined,
        cx: e.x,
        cy: e.y,
        r: Math.max(e.width, e.height) * 0.62,
        color: ARMOR_RING,
        stroke: 2,
      });
    }
    if (e.hitFlashTimer > 0) {
      const f = hitFlash(e.width, e.height, e.hitFlashTimer);
      ops.push({
        k: "circle",
        key: dbg ? `${key}-flash` : undefined,
        cx: e.x,
        cy: e.y,
        r: f.r,
        color: withAlpha(SHIELD_RGB, f.fillAlpha),
      });
      ops.push({
        k: "circle",
        key: dbg ? `${key}-flash-ring` : undefined,
        cx: e.x,
        cy: e.y,
        r: f.r,
        color: withAlpha(SHIELD_RGB, f.strokeAlpha),
        stroke: 3,
      });
    }
  }

  // #2485/#2843 Carrier telegraphs (beam charge, attack-run brace) and released beams
  carrierOps(state, ops);

  // Player and its overlays — one visibility rule for all of them
  const { player } = state;
  if (playerVisible(state)) {
    const x = player.x - player.width / 2;
    const y = player.y - player.height / 2;
    const w = player.width;
    const h = player.height;
    if (loaded.playerShip) {
      ops.push({
        k: "image",
        key: dbg ? "player" : undefined,
        sprite: "playerShip",
        x,
        y,
        w,
        h,
        fit: "fill",
      });
    } else {
      ops.push({ k: "rect", key: dbg ? "player" : undefined, x, y, w, h, color: 0xff00ffcc });
    }
    // #1033 shield aura
    if (state.activePowerUp?.type === "shield") {
      const r = player.width * 0.8;
      const cx = player.x;
      const cy = player.y;
      ops.push({ k: "circle", key: dbg ? "shield" : undefined, cx, cy, r, color: SHIELD_FILL });
      ops.push({
        k: "circle",
        key: dbg ? "shield-ring" : undefined,
        cx,
        cy,
        r,
        color: SHIELD_RING,
        stroke: 2,
      });
    }
    // #2488 hull plating flash — the plating that just took a hit
    if (player.hullFlashTimer > 0) {
      const t = player.hullFlashTimer;
      ops.push({
        k: "circle",
        key: dbg ? "hull-flash" : undefined,
        cx: player.x,
        cy: player.y,
        r: player.width * (0.6 + 0.4 * (1 - t / HIT_FLASH_DURATION)),
        color: withAlpha(SHIELD_RGB, (0.75 * t) / HIT_FLASH_DURATION),
        stroke: 3,
      });
    }
    // Lightning super-state tint
    if (state.activePowerUp?.type === "lightning") {
      ops.push({
        k: "rect",
        key: dbg ? "lightning" : undefined,
        x,
        y,
        w,
        h,
        color: LIGHTNING_TINT,
      });
    }
  }

  // #1035 Buddy ships — the sprite faces its direction of travel
  for (const buddy of state.buddyShips) {
    const key = dbg ? `buddy-${buddy.id}` : undefined;
    const x = buddy.x - BUDDY_SIZE / 2;
    const y = buddy.y - BUDDY_SIZE / 2;
    const w = BUDDY_SIZE;
    const h = BUDDY_SIZE;
    if (loaded.buddyShip) {
      const flipX = !buddy.facingRight;
      ops.push({ k: "image", key, sprite: "buddyShip", x, y, w, h, fit: "fill", flipX });
    } else {
      ops.push({ k: "rect", key, x, y, w, h, color: BUDDY_FALLBACK });
    }
    buddyOps(buddy, BUDDY_SIZE, ops); // #2845 HP bar + hit flash, shared with web
  }

  // Power-ups — sprites with procedural fallbacks; #2488 salvage and hull are procedural
  for (const pu of state.powerUps) {
    const lx = pu.x - pu.width / 2;
    const ly = pu.y - pu.height / 2;
    const pw = pu.width;
    const ph = pu.height;
    const key = dbg ? `pu-${pu.id}` : undefined;
    const sprite = POWERUP_SPRITE[pu.type];
    if (sprite && loaded[sprite]) {
      ops.push({ k: "image", key, sprite, x: lx, y: ly, w: pw, h: ph, fit: "contain" });
    } else if (isUpgradePickup(pu.type)) {
      // #2847: salvage crate / hull plating — shared geometry, halo + glyph
      upgradePickupOps(pu as typeof pu & { type: UpgradePickupType }, ops);
    } else if (pu.type === "shield") {
      ops.push({ k: "circle", key, cx: pu.x, cy: pu.y, r: pw * 0.4, color: PU_SHIELD });
    } else if (pu.type === "bomb") {
      ops.push({ k: "circle", key, cx: pu.x, cy: pu.y, r: pw * 0.4, color: PU_BOMB });
    } else if (pu.type === "buddy") {
      ops.push({
        k: "rect",
        key,
        x: lx + pw * 0.2,
        y: ly + ph * 0.2,
        w: pw * 0.6,
        h: ph * 0.6,
        color: PU_BUDDY,
      });
    } else {
      // lightning bolt
      ops.push({
        k: "poly",
        key,
        points: [
          lx + pw * 0.625,
          ly,
          lx + pw * 0.125,
          ly + ph * 0.542,
          lx + pw * 0.458,
          ly + ph * 0.542,
          lx + pw * 0.375,
          ly + ph,
          lx + pw * 0.875,
          ly + ph * 0.458,
          lx + pw * 0.542,
          ly + ph * 0.458,
        ],
        color: 0xffffee00,
      });
    }
  }

  // #2486/#2573 Asteroids — one of 4 Kenney meteor sprites, spun by `rotation`, or the
  // procedural outline (filled then stroked) while sprites load
  for (const a of state.asteroids) {
    const key = dbg ? `rock-${a.id}` : undefined;
    const sprite = asteroidSprite(a.id);
    if (loaded[sprite]) {
      const size = a.radius * 2;
      ops.push({
        k: "image",
        key,
        sprite,
        x: a.x - a.radius,
        y: a.y - a.radius,
        w: size,
        h: size,
        fit: "fill",
        rotate: a.rotation,
      });
      if (a.hitFlashTimer > 0) {
        const f = hitFlash(size, size, a.hitFlashTimer, ASTEROID_HIT_FLASH_MS);
        ops.push({
          k: "circle",
          key: dbg ? `${key}-flash` : undefined,
          cx: a.x,
          cy: a.y,
          r: f.r,
          color: withAlpha(0xffffff, f.strokeAlpha),
          stroke: 2,
        });
      }
    } else {
      const points = flatRounded(asteroidOutline(a));
      const color = a.hitFlashTimer > 0 ? 0xffe8d3b8 : 0xff8b6a47;
      ops.push({ k: "poly", key, points, color });
      ops.push({
        k: "poly",
        key: dbg ? `${key}-edge` : undefined,
        points,
        color: 0xffc9a27a,
        stroke: 1.5,
      });
    }
  }

  // Explosions — sprite strip, or a procedural burst while frames load
  for (const exp of state.explosions) {
    const key = dbg ? `ex-${exp.id}` : undefined;
    if (loaded.explosion[exp.frame]) {
      const half = EXPLOSION_DRAW_SIZE / 2;
      ops.push({
        k: "image",
        key,
        sprite: "explosion",
        frame: exp.frame,
        x: exp.x - half,
        y: exp.y - half,
        w: EXPLOSION_DRAW_SIZE,
        h: EXPLOSION_DRAW_SIZE,
        fit: "fill",
      });
    } else {
      const progress = exp.frame / EXPLOSION_FRAME_COUNT;
      ops.push({
        k: "circle",
        key,
        cx: exp.x,
        cy: exp.y,
        r: 6 + progress * 18,
        color: progress < 0.4 ? 0xffffcc00 : 0xffff4400,
        opacity: 1 - progress,
      });
    }
  }

  // #1034 Bomb flash — full-screen white fading out
  if (state.bombFlashTimer > 0) {
    ops.push({
      k: "rect",
      key: dbg ? "bomb-flash" : undefined,
      x: 0,
      y: 0,
      w: opts.width,
      h: opts.height,
      color: withAlpha(0xffffff, (state.bombFlashTimer / 300) * 0.75),
    });
  }

  return ops;
}
