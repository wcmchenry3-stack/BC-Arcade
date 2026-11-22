/**
 * #3595: every pickup on the playfield as shared display-list ops — the four timed power-ups
 * (Shield, Lightning, Buddy, Smart Bomb) and the two persistent upgrades (#2488: the salvage
 * crate, guns up, and the hull plate).
 *
 * Both renderers draw the same ops: `buildFrame` (native Skia) appends them, and
 * `GameCanvas.web.tsx` replays them with `drawEnemyOps` (image ops) and `drawPickupOps` (shapes),
 * so the two cannot drift apart.
 *
 * Look (owner pick "C-hex"): each pickup is ONE generated sprite
 * (`tools/assets/draw_starswarm_art.py`, `assets/starswarm/pickup/`) with its glow baked in. The
 * power-ups are a hexagonal data-chip token — silver bevel, coloured face, white glyph — and the
 * upgrades are a gold crate with an up-chevron and a steel-blue armour plate with a plus. The
 * hexagon and its silver rim are what keep the orange Bomb token apart from the round red-orange
 * enemy orbs. The upgrades also sit in a pulsing halo ring (#2847), drawn in code under the
 * sprite: "shiny reward, never a rock", and the cue that a pickup is worth waiting for.
 *
 * The sprite is the pickup's box plus `PICKUP_PAD` on every side, centred on it — for the four
 * tokens a larger draw box, `PICKUP_TOKEN_SIZE` (30 px against the 24 px hitbox); hitboxes are
 * unchanged. While a sprite loads the pickup draws a plain shape in its sprite's colours, the
 * same on both platforms: a face-coloured hexagon with a silver rim, or the crate / plate.
 */
import { cssColor, cssHex, opaque, withAlpha } from "./color";
import type { PackedColor } from "./color";
import type { DrawOp } from "./frame";
import { debugOpKeys } from "./opKeys";
import {
  HULL_BLUE_RGB,
  HULL_EDGE,
  HULL_PLATE,
  PICKUP_BEVEL,
  PICKUP_BOMB_RGB,
  PICKUP_BUDDY_RGB,
  PICKUP_LIGHTNING_RGB,
  PICKUP_SHIELD_RGB,
  SALVAGE_BAND,
  SALVAGE_EDGE,
  SALVAGE_RGB,
  WHITE,
} from "./palette";
import type { PowerUp, PowerUpType } from "../types";

export type UpgradePickupType = Extract<PowerUpType, "salvage" | "hull">;

export function isUpgradePickup(type: PowerUpType): type is UpgradePickupType {
  return type === "salvage" || type === "hull";
}

/** The pickup sprites, by the `StarSwarmImages` keys they load into (the web loads them in this order). */
export const PICKUP_SPRITES = [
  "puShield",
  "puLightning",
  "puBuddy",
  "puBomb",
  "puSalvage",
  "puHull",
] as const;
export type PickupSpriteKey = (typeof PICKUP_SPRITES)[number];

/** Which sprite each pickup draws with. */
export const PICKUP_SPRITE: Readonly<Record<PowerUpType, PickupSpriteKey>> = {
  shield: "puShield",
  lightning: "puLightning",
  buddy: "puBuddy",
  bomb: "puBomb",
  salvage: "puSalvage",
  hull: "puHull",
};

/** The transparent margin around each pickup's art box, game px (the generator's `PICKUP_PAD` / 3). */
export const PICKUP_PAD = 2;

/**
 * The power-up tokens' draw box, game px (the generator's `PICKUP_TOKEN_BOX`): 25% larger than
 * their 24 px hitbox (`POWERUP_W` / `POWERUP_H`, unchanged), so a token reads as big as the crate
 * and plate in their halo (owner audition). Draw size only: collision never reads it. The crate
 * and plate draw at the pickup's own box.
 */
export const PICKUP_TOKEN_SIZE = 30;

/** A power-up token's face colour (the generator's `PICKUP_FACE`), for its loading fallback. */
export const PICKUP_FACE: Readonly<Record<Exclude<PowerUpType, UpgradePickupType>, PackedColor>> = {
  shield: opaque(PICKUP_SHIELD_RGB),
  lightning: opaque(PICKUP_LIGHTNING_RGB),
  buddy: opaque(PICKUP_BUDDY_RGB),
  bomb: opaque(PICKUP_BOMB_RGB),
};

/**
 * Accent colour per upgrade pickup: `rgb` (0xRRGGBB) for the halo's computed alphas, `color`
 * (packed, opaque) for the display list, `hex` for the collection cue's React Native text.
 */
export const PICKUP_ACCENT: Record<
  UpgradePickupType,
  { rgb: number; color: PackedColor; hex: string }
> = {
  salvage: { rgb: SALVAGE_RGB, color: opaque(SALVAGE_RGB), hex: cssHex(SALVAGE_RGB) },
  hull: { rgb: HULL_BLUE_RGB, color: opaque(HULL_BLUE_RGB), hex: cssHex(HULL_BLUE_RGB) },
};

/** Halo pulse period, ms — phase comes from the pickup's own countdown, so it needs no clock. */
export const PICKUP_PULSE_MS = 900;

/** 0–1 halo pulse for a pickup with `despawnTimer` ms left. */
export function pickupPulse(despawnTimer: number): number {
  const m = ((despawnTimer % PICKUP_PULSE_MS) + PICKUP_PULSE_MS) % PICKUP_PULSE_MS;
  return 0.5 + 0.5 * Math.sin((m / PICKUP_PULSE_MS) * Math.PI * 2);
}

/** A hexagon with points left and right in the box (the token's shape; the generator's bevel is r = 0.47 w). */
function hexagon(cx: number, cy: number, r: number): number[] {
  const h = r * 0.8660254037844386; // sin 60°
  return [
    cx + r,
    cy,
    cx + r / 2,
    cy + h,
    cx - r / 2,
    cy + h,
    cx - r,
    cy,
    cx - r / 2,
    cy - h,
    cx + r / 2,
    cy - h,
  ];
}

/**
 * The pickup's sprite op, one per pickup, centred on it: a token's `PICKUP_TOKEN_SIZE` box, or an
 * upgrade's own box, plus `PICKUP_PAD`.
 */
function spriteOp(pu: PowerUp, key: string | undefined): DrawOp {
  const upgrade = isUpgradePickup(pu.type);
  const w = (upgrade ? pu.width : PICKUP_TOKEN_SIZE) + 2 * PICKUP_PAD;
  const h = (upgrade ? pu.height : PICKUP_TOKEN_SIZE) + 2 * PICKUP_PAD;
  return {
    k: "image",
    key,
    sprite: PICKUP_SPRITE[pu.type],
    x: pu.x - w / 2,
    y: pu.y - h / 2,
    w,
    h,
    fit: "fill",
  };
}

/**
 * Draw ops for one falling salvage crate or hull plate, back to front: the pulsing halo, then the
 * sprite — or, while it loads (`loaded` false, the default), the crate / plate in code. Appended
 * to `ops` when given (#2963: `buildFrame` passes its own list), and returned.
 */
export function upgradePickupOps(
  pu: PowerUp & { type: UpgradePickupType },
  ops: DrawOp[] = [],
  loaded = false
): DrawOp[] {
  const { x: cx, y: cy, width: pw, height: ph } = pu;
  const lx = cx - pw / 2;
  const ly = cy - ph / 2;
  const key = debugOpKeys() ? `pu-${pu.id}` : undefined;
  const accent = PICKUP_ACCENT[pu.type];
  const pulse = pickupPulse(pu.despawnTimer);
  const r = pw * 0.7 * (1 + 0.12 * pulse);
  ops.push(
    {
      k: "circle",
      key: key && `${key}-halo`,
      cx,
      cy,
      r,
      color: withAlpha(accent.rgb, 0.16 + 0.14 * pulse),
    },
    {
      k: "circle",
      key: key && `${key}-halo-ring`,
      cx,
      cy,
      r,
      color: withAlpha(accent.rgb, 0.55 + 0.35 * pulse),
      stroke: 1.5,
    }
  );
  if (loaded) {
    ops.push(spriteOp(pu, key));
    return ops;
  }

  if (pu.type === "salvage") {
    // the generator's crate: 0.76 x 0.64 of the box, a dark band across its middle
    const bx = lx + pw * 0.12;
    const by = ly + ph * 0.18;
    const bw = pw * 0.76;
    const bh = ph * 0.64;
    ops.push({ k: "rect", key, x: bx, y: by, w: bw, h: bh, color: accent.color });
    ops.push({
      k: "rect",
      key: key && `${key}-band`,
      x: bx,
      y: ly + ph * 0.44,
      w: bw,
      h: ph * 0.12,
      color: SALVAGE_BAND,
    });
    ops.push({
      k: "poly",
      key: key && `${key}-edge`,
      points: [bx, by, bx + bw, by, bx + bw, by + bh, bx, by + bh],
      color: SALVAGE_EDGE,
      stroke: 1,
    });
    // up-chevron: "more guns"
    ops.push({
      k: "poly",
      key: key && `${key}-glyph`,
      points: [cx, ly + ph * 0.22, cx + pw * 0.17, ly + ph * 0.46, cx - pw * 0.17, ly + ph * 0.46],
      color: WHITE,
    });
  } else {
    // the generator's armour plate: a bevelled shield shape
    const plate = [
      cx,
      ly + ph * 0.06,
      lx + pw * 0.9,
      ly + ph * 0.22,
      lx + pw * 0.86,
      ly + ph * 0.66,
      cx,
      ly + ph * 0.94,
      lx + pw * 0.14,
      ly + ph * 0.66,
      lx + pw * 0.1,
      ly + ph * 0.22,
    ];
    ops.push({ k: "poly", key, points: plate, color: HULL_PLATE });
    ops.push({
      k: "poly",
      key: key && `${key}-edge`,
      points: plate,
      color: HULL_EDGE,
      stroke: 1,
    });
    // plus: "more plating"
    const arm = pw * 0.11;
    const th = pw * 0.03;
    const gy = ly + ph * 0.48;
    ops.push({
      k: "rect",
      key: key && `${key}-glyph-h`,
      x: cx - arm,
      y: gy - th,
      w: arm * 2,
      h: th * 2,
      color: WHITE,
    });
    ops.push({
      k: "rect",
      key: key && `${key}-glyph-v`,
      x: cx - th,
      y: gy - arm,
      w: th * 2,
      h: arm * 2,
      color: WHITE,
    });
  }
  return ops;
}

/**
 * Every pickup on the playfield, back to front, appended to `ops` and returned. A timed power-up
 * is ONE op: its sprite, or while that loads a face-coloured hexagon with a silver rim (two). An
 * upgrade is its halo and ring plus its sprite (`upgradePickupOps`).
 */
export function pickupOps(
  powerUps: readonly PowerUp[],
  loaded: Readonly<Record<PickupSpriteKey, boolean>>,
  ops: DrawOp[] = []
): DrawOp[] {
  const dbg = debugOpKeys();
  for (const pu of powerUps) {
    const sprite = loaded[PICKUP_SPRITE[pu.type]];
    if (isUpgradePickup(pu.type)) {
      upgradePickupOps(pu as PowerUp & { type: UpgradePickupType }, ops, sprite);
      continue;
    }
    const key = dbg ? `pu-${pu.id}` : undefined;
    if (sprite) {
      ops.push(spriteOp(pu, key));
    } else {
      const points = hexagon(pu.x, pu.y, PICKUP_TOKEN_SIZE * 0.47);
      ops.push({ k: "poly", key, points, color: PICKUP_FACE[pu.type] });
      ops.push({ k: "poly", key: key && `${key}-rim`, points, color: PICKUP_BEVEL, stroke: 1.5 });
    }
  }
  return ops;
}

/**
 * Replay the shape ops of `pickupOps` (halos, rings and load fallbacks) on a 2D canvas context
 * (web renderer; `drawEnemyOps` passes them here and draws the image ops itself). Only rect /
 * circle / poly / line ops are drawn; any other kind is skipped.
 */
export function drawPickupOps(ctx: CanvasRenderingContext2D, ops: readonly DrawOp[]): void {
  for (const op of ops) drawShapeOp(ctx, op);
  ctx.lineWidth = 1;
}

/** One rect / circle / line / poly op on a 2D context (#3596: shared with `drawRockOps`). */
export function drawShapeOp(ctx: CanvasRenderingContext2D, op: DrawOp): void {
  if (op.k === "rect") {
    ctx.fillStyle = cssColor(op.color);
    ctx.fillRect(op.x, op.y, op.w, op.h);
  } else if (op.k === "circle") {
    ctx.beginPath();
    ctx.arc(op.cx, op.cy, op.r, 0, Math.PI * 2);
    if (op.stroke !== undefined) {
      ctx.strokeStyle = cssColor(op.color);
      ctx.lineWidth = op.stroke;
      ctx.stroke();
    } else {
      ctx.fillStyle = cssColor(op.color);
      ctx.fill();
    }
  } else if (op.k === "line") {
    ctx.beginPath();
    ctx.moveTo(op.x0, op.y0);
    ctx.lineTo(op.x1, op.y1);
    ctx.strokeStyle = cssColor(op.color);
    ctx.lineWidth = op.stroke;
    ctx.stroke();
  } else if (op.k === "poly") {
    const p = op.points;
    ctx.beginPath();
    ctx.moveTo(p[0]!, p[1]!);
    for (let i = 2; i + 1 < p.length; i += 2) ctx.lineTo(p[i]!, p[i + 1]!);
    ctx.closePath();
    if (op.stroke !== undefined) {
      ctx.strokeStyle = cssColor(op.color);
      ctx.lineWidth = op.stroke;
      ctx.stroke();
    } else {
      ctx.fillStyle = cssColor(op.color);
      ctx.fill();
    }
  }
}
