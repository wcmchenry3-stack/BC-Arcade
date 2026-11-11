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
 * The web renderer (`GameCanvas.web.tsx`, secondary platform) still derives the same rules itself,
 * except for the shared op builders it replays (`enemyOps`, `carrierOps`, `lightningBeamOps`,
 * `buddyOps`, `pickupOps`, `playerEffectOps`, `asteroidOps`, `effectOps`, `shotOps`).
 */
import { isCarrierArmored } from "../engine";
import { asteroidOps } from "./asteroids";
import type { RockSpriteKey } from "./asteroids";
import { buddyOps } from "./buddy";
import { carrierOps } from "./carrier";
import { lightningBeamOps } from "./lightningBeam";
import { withAlpha } from "./color";
import type { PackedColor } from "./color";
import { enemyOps } from "./enemies";
import { effectOps } from "./explosions";
import type { EnemySpriteKey } from "./enemies";
import { playerEffectOps } from "./playerFx";
import { shotOps } from "./shots";
import type { ShotSpriteKey } from "./shots";
import { BUDDY_SHIP_RGB } from "./palette";
import { debugOpKeys } from "./opKeys";
import { pickupOps } from "./pickups";
import type { PickupSpriteKey } from "./pickups";
import {
  armourLevel,
  DEFAULT_SHIP_ID,
  playerFallbackOp,
  shipGlowKey,
  shipStack,
  SHIP_BASE_SPRITE,
  SHIP_SPRITE_PAD,
} from "./ship";
import type { ShipId, ShipSpriteKey } from "./ship";
import type { StarSwarmState } from "../types";

/** The player ship blinks on this interval while invincible, ms. */
export const INVINCIBLE_BLINK_INTERVAL = 120;
/** Buddy ship box, px (square, centred on the ship). The sprite adds its transparent margin. */
export const BUDDY_SIZE = 34;

/** Sprite names — identical to the `StarSwarmImages` fields they resolve to. */
export type SpriteKey =
  ShipSpriteKey | EnemySpriteKey | "buddyShip" | ShotSpriteKey | PickupSpriteKey | RockSpriteKey;

/** Which sprites have finished loading; a missing one draws its procedural fallback instead. */
export type LoadedSprites = Readonly<Record<SpriteKey, boolean>>;

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
      /**
       * #3596: tint the (neutral) image into rock palette `tint` (`rockTint.ts`); native draws
       * it with that palette's cached paint, web with its prebuilt tinted canvas.
       */
      readonly tint?: number;
    }
  | {
      readonly k: "ship";
      readonly key?: string;
      /** The ship's layers, bottom to top; a layer that has not loaded is skipped. */
      readonly sprites: readonly ShipSpriteKey[];
      /** The sprite rect (the box plus its transparent margin). */
      readonly x: number;
      readonly y: number;
      readonly w: number;
      readonly h: number;
      /** The code-drawn armour outline around the composed silhouette, under the layers. */
      readonly outline?: 1 | 2;
      /** The cache slot of that outline's glow (`shipGlowKey`); native builds the glow on first use. */
      readonly outlineKey?: number;
    }
  | {
      readonly k: "poly";
      readonly key?: string;
      /** Closed polygon, flat [x0, y0, x1, y1, …]. */
      readonly points: readonly number[];
      readonly color: PackedColor;
      /** Stroke width; absent = filled. */
      readonly stroke?: number;
    }
  | {
      /**
       * #3597: a stroked segment (explosion debris). No path and no points array: native draws
       * it with `drawLine` on the shared paint, web with one moveTo/lineTo.
       */
      readonly k: "line";
      readonly key?: string;
      readonly x0: number;
      readonly y0: number;
      readonly x1: number;
      readonly y1: number;
      readonly color: PackedColor;
      readonly stroke: number;
    };

export interface FrameOptions {
  readonly loaded: LoadedSprites;
  /** Canvas size in logical px (the bomb flash covers it and its shockwave reaches the corners). */
  readonly width: number;
  readonly height: number;
  /** Which ship the player flies (#3600's picker); defaults to P1. */
  readonly ship?: ShipId;
}

const BUDDY_FALLBACK = withAlpha(BUDDY_SHIP_RGB, 0.8);

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

/** The whole native-canvas scene for one frame (above the starfield), back to front. */
export function buildFrame(state: StarSwarmState, opts: FrameOptions): DrawOp[] {
  const { loaded } = opts;
  const ship = opts.ship ?? DEFAULT_SHIP_ID;
  const dbg = debugOpKeys(); // #2963: keys only for tests and debugging
  const ops: DrawOp[] = [];

  // #3594 Shots (shared with web): enemy fire, then the player's and Buddy's — one sprite each,
  // bolts turned along their travel; a plain shape in the shot's colour while the art loads
  shotOps(state.enemyBullets, state.playerBullets, loaded, ops);

  // Enemies (#3593, shared with web): sprites by tier, HP and phase, leaning into their travel,
  // the #2484 armour ring, the hit flash and the damage effects
  enemyOps(
    {
      enemies: state.enemies,
      carrierArmored: isCarrierArmored(state),
      clock: state.nextDiveTimer,
      loaded,
    },
    ops
  );

  // #2485/#2843 Carrier telegraphs (beam charge, attack-run brace) and released beams
  carrierOps(state, ops);

  // #3562 Lightning's beams, one per gun — under the ship, over the enemies they cut through
  lightningBeamOps(state, ops);

  // Player and its overlays — one visibility rule for all of them
  const { player } = state;
  if (playerVisible(state)) {
    const x = player.x - player.width / 2;
    const y = player.y - player.height / 2;
    const w = player.width;
    const h = player.height;
    if (loaded[SHIP_BASE_SPRITE[ship]]) {
      // #3592: the layers of the held gun and hull level, each the box plus its margin
      ops.push({
        k: "ship",
        key: dbg ? "player" : undefined,
        sprites: shipStack(ship, player.guns, player.hull),
        x: x - SHIP_SPRITE_PAD,
        y: y - SHIP_SPRITE_PAD,
        w: w + 2 * SHIP_SPRITE_PAD,
        h: h + 2 * SHIP_SPRITE_PAD,
        outline: armourLevel(player.hull),
        outlineKey: shipGlowKey(ship, player.guns, player.hull),
      });
    } else {
      ops.push(playerFallbackOp(x, y, w, h));
    }
    // #1033 shield bubble, #2488 plating flash, Lightning aura (shared with web)
    playerEffectOps(state, ops);
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
      // #3592: the sprite is the box plus its transparent margin (same as the player's)
      const m = SHIP_SPRITE_PAD;
      ops.push({
        k: "image",
        key,
        sprite: "buddyShip",
        x: x - m,
        y: y - m,
        w: w + 2 * m,
        h: h + 2 * m,
        fit: "fill",
        flipX,
      });
    } else {
      ops.push({ k: "rect", key, x, y, w, h, color: BUDDY_FALLBACK });
    }
    buddyOps(buddy, BUDDY_SIZE, ops); // #2845 HP bar + hit flash, shared with web
  }

  // #3595 Pickups (shared with web): one sprite each, the upgrades in their pulsing halo; a plain
  // shape in the sprite's colours while the art loads
  pickupOps(state.powerUps, loaded, ops);

  // #2486/#3596 Asteroids (shared with web): the tinted rock art spun by `rotation`, the ore
  // veins on large ones and the hit flash; the outline while art loads
  asteroidOps(state.asteroids, loaded, ops);

  // #3597 Explosions (code-drawn by size), #3596 a split rock's crack over its dust, then the
  // Smart Bomb flash over everything — shared
  // with web, which draws them at the same place in its order
  effectOps(state, opts.width, opts.height, ops);

  return ops;
}
