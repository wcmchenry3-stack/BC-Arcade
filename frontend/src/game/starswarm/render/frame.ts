/**
 * #2564 (epic #2562, phase 2): every "what do we draw for this state" decision for the native
 * canvas, as a pure function returning a flat, ordered display list of primitive draw ops.
 *
 * The ops are plain data — numbers, strings and sprite keys, no Skia objects and no functions —
 * so the list can be replayed on the UI thread (#2565) by `drawFrame.ts`, a worklet that makes no
 * decisions of its own. Draw order is list order (painter's algorithm), so the order below is the
 * z-order on screen.
 *
 * The web renderer (`GameCanvas.web.tsx`, unmaintained) still derives the same rules itself.
 */
import {
  BULLET_C_W,
  HIT_FLASH_DURATION,
  BEAM_HALF_WIDTH,
  isCarrierArmored,
  carrierBeam,
  asteroidOutline,
} from "../engine";
import { HARMLESS_BULLET_OPACITY } from "../constants";
import type { StarfieldState } from "../starfield";
import type { EnemyTier, PowerUpType, StarSwarmState } from "../types";

/** Explosion sprite draw size, px. */
export const EXPLOSION_DRAW_SIZE = 48;
/** The player ship blinks on this interval while invincible, ms. */
export const INVINCIBLE_BLINK_INTERVAL = 120;
/** Buddy ship sprite size, px (square, centred on the ship). */
export const BUDDY_SIZE = 34;
/** Explosion strip length — the procedural fallback's progress runs over this many frames. */
export const EXPLOSION_FRAME_COUNT = 20;

/** Sprite names — identical to the `StarSwarmImages` fields they resolve to. */
export type SpriteKey =
  | "playerShip"
  | "buddyShip"
  | "enemyGrunt"
  | "enemyElite"
  | "enemyBoss"
  | "enemyCarrier"
  | "bulletPlayer"
  | "puShield"
  | "puBomb"
  | "puBuddy"
  | "puLightning"
  | "explosion";

/** Which sprites have finished loading; a missing one draws its procedural fallback instead. */
export type LoadedSprites = Readonly<Record<Exclude<SpriteKey, "explosion">, boolean>> & {
  /** One flag per explosion frame. */
  readonly explosion: readonly boolean[];
};

/** A primitive draw op. `key` is stable per entity — tests and debugging use it to find an op. */
export type DrawOp =
  | { readonly k: "fill"; readonly key: string; readonly color: string }
  | {
      readonly k: "rect";
      readonly key: string;
      readonly x: number;
      readonly y: number;
      readonly w: number;
      readonly h: number;
      readonly color: string;
      readonly opacity?: number;
    }
  | {
      readonly k: "circle";
      readonly key: string;
      readonly cx: number;
      readonly cy: number;
      readonly r: number;
      readonly color: string;
      readonly opacity?: number;
      /** Stroke width; absent = filled. */
      readonly stroke?: number;
    }
  | {
      readonly k: "image";
      readonly key: string;
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
    }
  | {
      readonly k: "poly";
      readonly key: string;
      /** Closed polygon, flat [x0, y0, x1, y1, …]. */
      readonly points: readonly number[];
      readonly color: string;
      /** Stroke width; absent = filled. */
      readonly stroke?: number;
    };

export interface FrameOptions {
  readonly loaded: LoadedSprites;
  /** Canvas size in logical px (the bomb flash covers it). */
  readonly width: number;
  readonly height: number;
}

const BACKGROUND = "#000010";

const TIER_SPRITE: Record<EnemyTier, Exclude<SpriteKey, "explosion">> = {
  Grunt: "enemyGrunt",
  Elite: "enemyElite",
  Boss: "enemyBoss",
  Carrier: "enemyCarrier",
};
const TIER_FALLBACK: Record<EnemyTier, string> = {
  Grunt: "#8888ff",
  Elite: "#ff88ff",
  Boss: "#ffff44",
  Carrier: "#b06cff",
};
const POWERUP_SPRITE: Partial<Record<PowerUpType, Exclude<SpriteKey, "explosion">>> = {
  shield: "puShield",
  bomb: "puBomb",
  buddy: "puBuddy",
  lightning: "puLightning",
};

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

/** Hit-flash burst ring for a ship `timer` ms into its flash (#1310/#974). */
export function hitFlash(
  w: number,
  h: number,
  timer: number
): { r: number; fillAlpha: number; strokeAlpha: number } {
  const progress = 1 - timer / HIT_FLASH_DURATION;
  const r = Math.max(w, h) * 1.2 * (0.6 + 0.5 * progress);
  const a = timer / HIT_FLASH_DURATION; // 1 → 0 as the burst plays
  return { r, fillAlpha: a * 0.25, strokeAlpha: a * 0.75 };
}

/** Flatten points, rounded to 0.1 px — what the asteroid path used before #2564. */
function flatRounded(points: readonly { x: number; y: number }[]): number[] {
  const out: number[] = [];
  for (const p of points) out.push(Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10);
  return out;
}

/** The whole native-canvas scene for one frame, back to front. */
export function buildFrame(
  state: StarSwarmState,
  sf: StarfieldState,
  opts: FrameOptions
): DrawOp[] {
  const { loaded } = opts;
  const ops: DrawOp[] = [{ k: "fill", key: "bg", color: BACKGROUND }];

  // Starfield
  for (const star of sf.stars) {
    ops.push({
      k: "circle",
      key: `star-${star.id}`,
      cx: star.x,
      cy: star.y,
      r: star.r,
      color: `rgba(255,255,255,${star.opacity})`,
    });
  }

  // Enemy bullets — harmless carry-overs from a cleared wave are dimmed; #2487 flak is amber
  for (const b of state.enemyBullets) {
    ops.push({
      k: "rect",
      key: `eb-${b.id}`,
      x: b.x - b.width / 2,
      y: b.y - b.height / 2,
      w: b.width,
      h: b.height,
      color: b.flak ? "#ffd27a" : "#ff4422",
      opacity: b.harmless ? HARMLESS_BULLET_OPACITY : 1,
    });
  }

  // Player bullets — charge bullets (wider) as a distinct cyan beam
  for (const b of state.playerBullets) {
    const rect = { x: b.x - b.width / 2, y: b.y - b.height / 2, w: b.width, h: b.height };
    if (b.width >= BULLET_C_W) {
      ops.push({ k: "rect", key: `pb-${b.id}`, ...rect, color: "#00f0ff" });
    } else if (loaded.bulletPlayer) {
      ops.push({ k: "image", key: `pb-${b.id}`, sprite: "bulletPlayer", ...rect, fit: "fill" });
    } else {
      ops.push({ k: "rect", key: `pb-${b.id}`, ...rect, color: "#00ffcc" });
    }
  }

  // Enemies — sprite, #2484 armor ring, hit-flash burst
  const armored = isCarrierArmored(state);
  for (const e of state.enemies) {
    if (!e.isAlive) continue;
    const rect = { x: e.x - e.width / 2, y: e.y - e.height / 2, w: e.width, h: e.height };
    const sprite = TIER_SPRITE[e.tier];
    if (loaded[sprite]) {
      ops.push({ k: "image", key: `en-${e.id}`, sprite, ...rect, fit: "fill" });
    } else {
      ops.push({ k: "rect", key: `en-${e.id}`, ...rect, color: TIER_FALLBACK[e.tier] });
    }
    if (e.tier === "Carrier" && armored) {
      ops.push({
        k: "circle",
        key: `en-${e.id}-ring`,
        cx: e.x,
        cy: e.y,
        r: Math.max(e.width, e.height) * 0.62,
        color: "rgba(0,170,255,0.45)",
        stroke: 2,
      });
    }
    if (e.hitFlashTimer > 0) {
      const f = hitFlash(e.width, e.height, e.hitFlashTimer);
      ops.push({
        k: "circle",
        key: `en-${e.id}-flash`,
        cx: e.x,
        cy: e.y,
        r: f.r,
        color: `rgba(0,170,255,${f.fillAlpha.toFixed(3)})`,
      });
      ops.push({
        k: "circle",
        key: `en-${e.id}-flash-ring`,
        cx: e.x,
        cy: e.y,
        r: f.r,
        color: `rgba(0,170,255,${f.strokeAlpha.toFixed(3)})`,
        stroke: 3,
      });
    }
  }

  // #2485 Carrier sweep beam — telegraph, then the beam
  const beam = carrierBeam(state);
  if (beam?.phase === "charge") {
    ops.push({
      k: "rect",
      key: "beam-telegraph",
      x: beam.x - 2,
      y: beam.y,
      w: 4,
      h: state.canvasH,
      color: `rgba(176,108,255,${(0.1 + beam.progress * 0.35).toFixed(3)})`,
    });
    ops.push({
      k: "circle",
      key: "beam-charge",
      cx: beam.x,
      cy: beam.y + 6,
      r: 4 + beam.progress * 8,
      color: `rgba(176,108,255,${(0.4 + beam.progress * 0.5).toFixed(3)})`,
    });
  } else if (beam?.phase === "fire") {
    ops.push({
      k: "rect",
      key: "beam-glow",
      x: beam.x - BEAM_HALF_WIDTH - 4,
      y: beam.y,
      w: BEAM_HALF_WIDTH * 2 + 8,
      h: state.canvasH,
      color: "rgba(176,108,255,0.35)",
    });
    ops.push({
      k: "rect",
      key: "beam-core",
      x: beam.x - BEAM_HALF_WIDTH * 0.5,
      y: beam.y,
      w: BEAM_HALF_WIDTH,
      h: state.canvasH,
      color: "rgba(230,205,255,0.9)",
    });
  }

  // Player and its overlays — one visibility rule for all of them
  const { player } = state;
  if (playerVisible(state)) {
    const rect = {
      x: player.x - player.width / 2,
      y: player.y - player.height / 2,
      w: player.width,
      h: player.height,
    };
    if (loaded.playerShip) {
      ops.push({ k: "image", key: "player", sprite: "playerShip", ...rect, fit: "fill" });
    } else {
      ops.push({ k: "rect", key: "player", ...rect, color: "#00ffcc" });
    }
    // #1033 shield aura
    if (state.activePowerUp?.type === "shield") {
      const r = player.width * 0.8;
      ops.push({
        k: "circle",
        key: "shield",
        cx: player.x,
        cy: player.y,
        r,
        color: "rgba(0,170,255,0.25)",
      });
      ops.push({
        k: "circle",
        key: "shield-ring",
        cx: player.x,
        cy: player.y,
        r,
        color: "rgba(0,170,255,0.75)",
        stroke: 2,
      });
    }
    // #2488 hull plating flash — the plating that just took a hit
    if (player.hullFlashTimer > 0) {
      const t = player.hullFlashTimer;
      ops.push({
        k: "circle",
        key: "hull-flash",
        cx: player.x,
        cy: player.y,
        r: player.width * (0.6 + 0.4 * (1 - t / HIT_FLASH_DURATION)),
        color: `rgba(0,170,255,${((0.75 * t) / HIT_FLASH_DURATION).toFixed(3)})`,
        stroke: 3,
      });
    }
    // Lightning super-state tint
    if (state.activePowerUp?.type === "lightning") {
      ops.push({ k: "rect", key: "lightning", ...rect, color: "rgba(255,238,0,0.45)" });
    }
  }

  // #1035 Buddy ships — the sprite faces its direction of travel
  for (const buddy of state.buddyShips) {
    const rect = {
      x: buddy.x - BUDDY_SIZE / 2,
      y: buddy.y - BUDDY_SIZE / 2,
      w: BUDDY_SIZE,
      h: BUDDY_SIZE,
    };
    if (loaded.buddyShip) {
      ops.push({
        k: "image",
        key: `buddy-${buddy.id}`,
        sprite: "buddyShip",
        ...rect,
        fit: "fill",
        flipX: !buddy.fromLeft,
      });
    } else {
      ops.push({ k: "rect", key: `buddy-${buddy.id}`, ...rect, color: "rgba(0,120,255,0.8)" });
    }
  }

  // Power-ups — sprites with procedural fallbacks; #2488 salvage and hull are procedural
  for (const pu of state.powerUps) {
    const lx = pu.x - pu.width / 2;
    const ly = pu.y - pu.height / 2;
    const pw = pu.width;
    const ph = pu.height;
    const key = `pu-${pu.id}`;
    const sprite = POWERUP_SPRITE[pu.type];
    if (sprite && loaded[sprite]) {
      ops.push({ k: "image", key, sprite, x: lx, y: ly, w: pw, h: ph, fit: "contain" });
    } else if (pu.type === "salvage") {
      ops.push({
        k: "rect",
        key,
        x: lx + pw * 0.15,
        y: ly + ph * 0.15,
        w: pw * 0.7,
        h: ph * 0.7,
        color: "#ffb020",
      });
      ops.push({
        k: "rect",
        key: `${key}-band`,
        x: lx + pw * 0.15,
        y: ly + ph * 0.45,
        w: pw * 0.7,
        h: ph * 0.1,
        color: "#7a4d08",
      });
    } else if (pu.type === "hull") {
      ops.push({
        k: "poly",
        key,
        points: [
          pu.x,
          ly,
          lx + pw,
          ly + ph * 0.25,
          lx + pw,
          ly + ph * 0.75,
          pu.x,
          ly + ph,
          lx,
          ly + ph * 0.75,
          lx,
          ly + ph * 0.25,
        ],
        color: "#00aaff",
      });
    } else if (pu.type === "shield") {
      ops.push({ k: "circle", key, cx: pu.x, cy: pu.y, r: pw * 0.4, color: "rgba(0,170,255,0.9)" });
    } else if (pu.type === "bomb") {
      ops.push({ k: "circle", key, cx: pu.x, cy: pu.y, r: pw * 0.4, color: "rgba(255,80,0,0.9)" });
    } else if (pu.type === "buddy") {
      ops.push({
        k: "rect",
        key,
        x: lx + pw * 0.2,
        y: ly + ph * 0.2,
        w: pw * 0.6,
        h: ph * 0.6,
        color: "rgba(0,255,200,0.9)",
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
        color: "#ffee00",
      });
    }
  }

  // #2486 Asteroids — shared procedural outline, filled then stroked
  for (const a of state.asteroids) {
    const points = flatRounded(asteroidOutline(a));
    ops.push({
      k: "poly",
      key: `rock-${a.id}`,
      points,
      color: a.hitFlashTimer > 0 ? "#e8d3b8" : "#8b6a47",
    });
    ops.push({ k: "poly", key: `rock-${a.id}-edge`, points, color: "#c9a27a", stroke: 1.5 });
  }

  // Explosions — sprite strip, or a procedural burst while frames load
  for (const exp of state.explosions) {
    if (loaded.explosion[exp.frame]) {
      const half = EXPLOSION_DRAW_SIZE / 2;
      ops.push({
        k: "image",
        key: `ex-${exp.id}`,
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
        key: `ex-${exp.id}`,
        cx: exp.x,
        cy: exp.y,
        r: 6 + progress * 18,
        color: progress < 0.4 ? "#ffcc00" : "#ff4400",
        opacity: 1 - progress,
      });
    }
  }

  // #1034 Bomb flash — full-screen white fading out
  if (state.bombFlashTimer > 0) {
    ops.push({
      k: "rect",
      key: "bomb-flash",
      x: 0,
      y: 0,
      w: opts.width,
      h: opts.height,
      color: `rgba(255,255,255,${(state.bombFlashTimer / 300) * 0.75})`,
    });
  }

  return ops;
}
