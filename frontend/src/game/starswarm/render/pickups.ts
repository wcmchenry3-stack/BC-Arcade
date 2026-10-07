/**
 * #2847: the look of the two persistent in-run upgrade pickups (#2488) — Salvage crate (guns) and
 * Hull plating — as shared display-list geometry.
 *
 * Both renderers replay this: `buildFrame` (native Skia) appends the ops as-is, and
 * `GameCanvas.web.tsx` replays the same `rect` / `circle` / `poly` ops on its 2D context, so the
 * two cannot drift apart.
 *
 * Visual language: timed power-ups are round Kenney sprites with no halo. Upgrade pickups are
 * angular (a crate, a hex plate), carry a bright glyph (up-chevron / plus) and sit inside a
 * pulsing halo ring — "shiny reward", never a rock — while the crate's amber and the plate's cyan
 * keep them apart from each other and from the grey-brown asteroids.
 */
import { cssColor, withAlpha } from "./color";
import type { PackedColor } from "./color";
import type { DrawOp } from "./frame";
import { debugOpKeys } from "./opKeys";
import type { PowerUp, PowerUpType } from "../types";

export type UpgradePickupType = Extract<PowerUpType, "salvage" | "hull">;

export function isUpgradePickup(type: PowerUpType): type is UpgradePickupType {
  return type === "salvage" || type === "hull";
}

/**
 * Accent colour per pickup: `rgb` (0xRRGGBB) for the halo's computed alphas, `color` (packed,
 * opaque) for the display list, `hex` for the collection cue's React Native text.
 */
export const PICKUP_ACCENT: Record<
  UpgradePickupType,
  { rgb: number; color: PackedColor; hex: string }
> = {
  salvage: { rgb: 0xffb020, color: 0xffffb020, hex: "#ffb020" },
  hull: { rgb: 0x00aaff, color: 0xff00aaff, hex: "#00aaff" },
};

/** Halo pulse period, ms — phase comes from the pickup's own countdown, so it needs no clock. */
export const PICKUP_PULSE_MS = 900;

/** 0–1 halo pulse for a pickup with `despawnTimer` ms left. */
export function pickupPulse(despawnTimer: number): number {
  const m = ((despawnTimer % PICKUP_PULSE_MS) + PICKUP_PULSE_MS) % PICKUP_PULSE_MS;
  return 0.5 + 0.5 * Math.sin((m / PICKUP_PULSE_MS) * Math.PI * 2);
}

/**
 * Draw ops for one falling salvage crate or hull plating, back to front — appended to `ops` when
 * given (#2963: `buildFrame` passes its own list), and returned.
 */
export function upgradePickupOps(
  pu: PowerUp & { type: UpgradePickupType },
  ops: DrawOp[] = []
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

  if (pu.type === "salvage") {
    const bx = lx + pw * 0.15;
    const by = ly + ph * 0.15;
    const bw = pw * 0.7;
    const bh = ph * 0.7;
    ops.push({ k: "rect", key, x: bx, y: by, w: bw, h: bh, color: accent.color });
    ops.push({
      k: "rect",
      key: key && `${key}-band`,
      x: bx,
      y: ly + ph * 0.55,
      w: bw,
      h: ph * 0.1,
      color: 0xff7a4d08,
    });
    ops.push({
      k: "poly",
      key: key && `${key}-edge`,
      points: [bx, by, bx + bw, by, bx + bw, by + bh, bx, by + bh],
      color: 0xfffff2c0,
      stroke: 1.5,
    });
    // up-chevron: "more guns"
    ops.push({
      k: "poly",
      key: key && `${key}-glyph`,
      points: [cx, ly + ph * 0.22, cx + pw * 0.17, ly + ph * 0.46, cx - pw * 0.17, ly + ph * 0.46],
      color: 0xffffffff,
    });
  } else {
    const hex = [
      cx,
      ly,
      lx + pw,
      ly + ph * 0.25,
      lx + pw,
      ly + ph * 0.75,
      cx,
      ly + ph,
      lx,
      ly + ph * 0.75,
      lx,
      ly + ph * 0.25,
    ];
    ops.push({ k: "poly", key, points: hex, color: accent.color });
    ops.push({
      k: "poly",
      key: key && `${key}-edge`,
      points: hex,
      color: 0xffd8f4ff,
      stroke: 1.5,
    });
    // plus: "more plating"
    const arm = pw * 0.2;
    const th = pw * 0.09;
    ops.push({
      k: "rect",
      key: key && `${key}-glyph-h`,
      x: cx - arm,
      y: cy - th,
      w: arm * 2,
      h: th * 2,
      color: 0xffffffff,
    });
    ops.push({
      k: "rect",
      key: key && `${key}-glyph-v`,
      x: cx - th,
      y: cy - arm,
      w: th * 2,
      h: arm * 2,
      color: 0xffffffff,
    });
  }
  return ops;
}

/**
 * Replay ops from `upgradePickupOps` on a 2D canvas context (web renderer). Only rect / circle /
 * poly ops appear in pickup geometry.
 */
export function drawPickupOps(ctx: CanvasRenderingContext2D, ops: readonly DrawOp[]): void {
  for (const op of ops) {
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
  ctx.lineWidth = 1;
}
