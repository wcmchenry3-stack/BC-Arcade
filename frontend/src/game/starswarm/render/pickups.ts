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
import type { DrawOp } from "./frame";
import type { PowerUp, PowerUpType } from "../types";

export type UpgradePickupType = Extract<PowerUpType, "salvage" | "hull">;

export function isUpgradePickup(type: PowerUpType): type is UpgradePickupType {
  return type === "salvage" || type === "hull";
}

/** Accent colour per pickup — also the colour of its collection cue. */
export const PICKUP_ACCENT: Record<UpgradePickupType, { rgb: string; hex: string }> = {
  salvage: { rgb: "255,176,32", hex: "#ffb020" },
  hull: { rgb: "0,170,255", hex: "#00aaff" },
};

/** Halo pulse period, ms — phase comes from the pickup's own countdown, so it needs no clock. */
export const PICKUP_PULSE_MS = 900;

/** 0–1 halo pulse for a pickup with `despawnTimer` ms left. */
export function pickupPulse(despawnTimer: number): number {
  const m = ((despawnTimer % PICKUP_PULSE_MS) + PICKUP_PULSE_MS) % PICKUP_PULSE_MS;
  return 0.5 + 0.5 * Math.sin((m / PICKUP_PULSE_MS) * Math.PI * 2);
}

/** Draw ops for one falling salvage crate or hull plating, back to front. */
export function upgradePickupOps(pu: PowerUp & { type: UpgradePickupType }): DrawOp[] {
  const { x: cx, y: cy, width: pw, height: ph } = pu;
  const lx = cx - pw / 2;
  const ly = cy - ph / 2;
  const key = `pu-${pu.id}`;
  const accent = PICKUP_ACCENT[pu.type];
  const pulse = pickupPulse(pu.despawnTimer);
  const r = pw * 0.7 * (1 + 0.12 * pulse);
  const ops: DrawOp[] = [
    {
      k: "circle",
      key: `${key}-halo`,
      cx,
      cy,
      r,
      color: `rgba(${accent.rgb},${(0.16 + 0.14 * pulse).toFixed(3)})`,
    },
    {
      k: "circle",
      key: `${key}-halo-ring`,
      cx,
      cy,
      r,
      color: `rgba(${accent.rgb},${(0.55 + 0.35 * pulse).toFixed(3)})`,
      stroke: 1.5,
    },
  ];

  if (pu.type === "salvage") {
    const bx = lx + pw * 0.15;
    const by = ly + ph * 0.15;
    const bw = pw * 0.7;
    const bh = ph * 0.7;
    ops.push({ k: "rect", key, x: bx, y: by, w: bw, h: bh, color: accent.hex });
    ops.push({
      k: "rect",
      key: `${key}-band`,
      x: bx,
      y: ly + ph * 0.55,
      w: bw,
      h: ph * 0.1,
      color: "#7a4d08",
    });
    ops.push({
      k: "poly",
      key: `${key}-edge`,
      points: [bx, by, bx + bw, by, bx + bw, by + bh, bx, by + bh],
      color: "#fff2c0",
      stroke: 1.5,
    });
    // up-chevron: "more guns"
    ops.push({
      k: "poly",
      key: `${key}-glyph`,
      points: [cx, ly + ph * 0.22, cx + pw * 0.17, ly + ph * 0.46, cx - pw * 0.17, ly + ph * 0.46],
      color: "#ffffff",
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
    ops.push({ k: "poly", key, points: hex, color: accent.hex });
    ops.push({ k: "poly", key: `${key}-edge`, points: hex, color: "#d8f4ff", stroke: 1.5 });
    // plus: "more plating"
    const arm = pw * 0.2;
    const th = pw * 0.09;
    ops.push({
      k: "rect",
      key: `${key}-glyph-h`,
      x: cx - arm,
      y: cy - th,
      w: arm * 2,
      h: th * 2,
      color: "#ffffff",
    });
    ops.push({
      k: "rect",
      key: `${key}-glyph-v`,
      x: cx - th,
      y: cy - arm,
      w: th * 2,
      h: arm * 2,
      color: "#ffffff",
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
      ctx.fillStyle = op.color;
      ctx.fillRect(op.x, op.y, op.w, op.h);
    } else if (op.k === "circle") {
      ctx.beginPath();
      ctx.arc(op.cx, op.cy, op.r, 0, Math.PI * 2);
      if (op.stroke !== undefined) {
        ctx.strokeStyle = op.color;
        ctx.lineWidth = op.stroke;
        ctx.stroke();
      } else {
        ctx.fillStyle = op.color;
        ctx.fill();
      }
    } else if (op.k === "poly") {
      const p = op.points;
      ctx.beginPath();
      ctx.moveTo(p[0]!, p[1]!);
      for (let i = 2; i + 1 < p.length; i += 2) ctx.lineTo(p[i]!, p[i + 1]!);
      ctx.closePath();
      if (op.stroke !== undefined) {
        ctx.strokeStyle = op.color;
        ctx.lineWidth = op.stroke;
        ctx.stroke();
      } else {
        ctx.fillStyle = op.color;
        ctx.fill();
      }
    }
  }
  ctx.lineWidth = 1;
}
