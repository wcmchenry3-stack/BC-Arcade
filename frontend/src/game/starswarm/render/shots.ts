/**
 * #3594: every projectile as shared display-list ops — one op per shot.
 *
 * Both renderers draw the same ops: `buildFrame` (native Skia) appends them, and
 * `GameCanvas.web.tsx` replays them with `drawEnemyOps` (image ops turn about their centre there
 * as `canvas.rotate` does on native), so the two cannot drift apart.
 *
 * Shape language (owner-approved): friendly fire is an elongated cool bolt — the player's cyan,
 * Buddy's shorter mint one — and danger is warm: a red-orange plasma orb, the Carrier's twin
 * lasers as hive-pink orbs, and flak at rocks as an amber shard. Each is one tiny generated
 * sprite (`tools/assets/draw_starswarm_art.py`) with its glow baked in, so a shot is ONE image op
 * — no glow shapes per shot, projectiles being the most numerous things on screen.
 *
 * The sprite is the art's box plus `SHOT_PAD` on every side, centred on the shot. Hitboxes are
 * unchanged: the box is the art's size, not the hitbox (a player bolt is drawn at its own size,
 * so a charged bolt restored from an older save keeps its width). Bolts and shards turn along
 * their travel (`rotate`, from vx/vy — render-only; a shot flying straight up is not turned);
 * orbs are round and never turn. While a sprite loads, the shot draws one plain shape in its
 * colour (a rect, or a circle for an orb), the same on both platforms.
 */
import type { Bullet } from "../types";
import { opaque } from "./color";
import type { PackedColor } from "./color";
import type { DrawOp } from "./frame";
import { debugOpKeys } from "./opKeys";
import {
  SHOT_BUDDY_RGB,
  SHOT_CARRIER_RGB,
  SHOT_ENEMY_RGB,
  SHOT_FLAK_RGB,
  SHOT_PLAYER_RGB,
} from "./palette";

/** The shot sprites, by the `StarSwarmImages` keys they load into (the web loads them in this order). */
export const SHOT_SPRITES = [
  "shotPlayer",
  "shotBuddy",
  "shotEnemy",
  "shotFlak",
  "shotCarrier",
] as const;
export type ShotSpriteKey = (typeof SHOT_SPRITES)[number];

/** The transparent margin around each shot's art box, game px (the generator's `SHOT_PAD` / 3). */
export const SHOT_PAD = 2;

interface ShotLook {
  /** The art's box, game px (the generator's `SHOT_BOXES`). */
  readonly w: number;
  readonly h: number;
  /** Turned along its travel (bolts, shards); orbs are round. */
  readonly turns: boolean;
  /** The loading fallback: a circle (orbs) or a rect, in `color`. */
  readonly round: boolean;
  readonly color: PackedColor;
}

/** Each kind's look. The player's bolt box is the shot's own (5 x 14, its hitbox). */
export const SHOT_LOOKS: Readonly<Record<ShotSpriteKey, ShotLook>> = {
  shotPlayer: { w: 5, h: 14, turns: true, round: false, color: opaque(SHOT_PLAYER_RGB) },
  shotBuddy: { w: 4, h: 10, turns: true, round: false, color: opaque(SHOT_BUDDY_RGB) },
  shotEnemy: { w: 7, h: 7, turns: false, round: true, color: opaque(SHOT_ENEMY_RGB) },
  shotFlak: { w: 5, h: 8, turns: true, round: false, color: opaque(SHOT_FLAK_RGB) },
  shotCarrier: { w: 8, h: 8, turns: false, round: true, color: opaque(SHOT_CARRIER_RGB) },
};

/**
 * Which sprite a shot draws with: a player-owned shot is Buddy's (`source: "buddy"`) or the
 * player's; an enemy shot is flak (aimed at a rock, whoever fired it), the Carrier's twin lasers
 * (`source: "carrier"`), or an ordinary plasma orb.
 */
export function shotSprite(b: Pick<Bullet, "owner" | "flak" | "source">): ShotSpriteKey {
  if (b.owner === "player") return b.source === "buddy" ? "shotBuddy" : "shotPlayer";
  if (b.flak) return "shotFlak";
  return b.source === "carrier" ? "shotCarrier" : "shotEnemy";
}

/**
 * The turn (radians, clockwise) that points an up-facing sprite along (vx, vy); undefined for a
 * shot flying straight up, so most player bolts draw with no transform at all.
 */
export function shotTurn(vx: number, vy: number): number | undefined {
  if (vx === 0 && vy < 0) return undefined;
  return Math.atan2(vx, -vy);
}

function pushShot(
  b: Bullet,
  loaded: Readonly<Record<ShotSpriteKey, boolean>>,
  key: string | undefined,
  ops: DrawOp[]
): void {
  const sprite = shotSprite(b);
  const look = SHOT_LOOKS[sprite];
  const w = sprite === "shotPlayer" ? b.width : look.w;
  const h = sprite === "shotPlayer" ? b.height : look.h;
  if (loaded[sprite]) {
    ops.push({
      k: "image",
      key,
      sprite,
      x: b.x - w / 2 - SHOT_PAD,
      y: b.y - h / 2 - SHOT_PAD,
      w: w + 2 * SHOT_PAD,
      h: h + 2 * SHOT_PAD,
      fit: "fill",
      rotate: look.turns ? shotTurn(b.vx, b.vy) : undefined,
    });
  } else if (look.round) {
    ops.push({ k: "circle", key, cx: b.x, cy: b.y, r: w / 2, color: look.color });
  } else {
    ops.push({ k: "rect", key, x: b.x - w / 2, y: b.y - h / 2, w, h, color: look.color });
  }
}

/**
 * Every shot in flight, enemy fire first (under the player's), one op each — appended to `ops`
 * and returned. #2842: every enemy shot in flight is live, so none is dimmed.
 */
export function shotOps(
  enemyBullets: readonly Bullet[],
  playerBullets: readonly Bullet[],
  loaded: Readonly<Record<ShotSpriteKey, boolean>>,
  ops: DrawOp[] = []
): DrawOp[] {
  const dbg = debugOpKeys();
  for (const b of enemyBullets) pushShot(b, loaded, dbg ? `eb-${b.id}` : undefined, ops);
  for (const b of playerBullets) pushShot(b, loaded, dbg ? `pb-${b.id}` : undefined, ops);
  return ops;
}
