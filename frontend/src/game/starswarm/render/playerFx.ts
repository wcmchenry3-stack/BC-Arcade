/**
 * #3592: the code-drawn effects around the player ship, restyled in style B, as shared
 * display-list geometry: the shield bubble, the hull-plating flash and the Lightning aura.
 *
 * Both renderers replay these: `buildFrame` (native Skia) appends the ops, and
 * `GameCanvas.web.tsx` replays the same `circle` / `poly` ops with `drawPickupOps`, so the two
 * cannot drift apart. Timings are unchanged: the plating flash still runs `HIT_FLASH_DURATION`
 * and the bubble and aura show while their power-up is active.
 */
import { HIT_FLASH_DURATION } from "../engine";
import { withAlpha } from "./color";
import type { DrawOp } from "./frame";
import { debugOpKeys } from "./opKeys";
import {
  ARMOR_BLUE_RGB,
  ARMOR_PALE_RGB,
  LIGHTNING_AURA_RGB,
  LIGHTNING_SPARK_RGB,
  SHIELD_BUBBLE_RGB,
  SHIELD_RIM_RGB,
} from "./palette";
import type { StarSwarmState } from "../types";

const SHIELD_BODY = withAlpha(SHIELD_BUBBLE_RGB, 0.1);
const SHIELD_EDGE_BAND = withAlpha(SHIELD_BUBBLE_RGB, 0.18);
const SHIELD_RIM = withAlpha(SHIELD_RIM_RGB, 0.85);
const SHIELD_HEX = withAlpha(SHIELD_RIM_RGB, 0.3);
const LIGHTNING_HALO = withAlpha(LIGHTNING_AURA_RGB, 0.14);
const LIGHTNING_RING = withAlpha(LIGHTNING_SPARK_RGB, 0.5);
const LIGHTNING_SPARK = withAlpha(LIGHTNING_SPARK_RGB, 0.9);

/** The bubble's radius as a multiple of the ship's width (as before the restyle). */
const SHIELD_RADIUS = 0.8;
/** The hexagon hint's radius as a fraction of the bubble's. */
const HEX_RADIUS = 0.6;
/** Lightning sparks: how many, and how often they jump to a new angle, ms. */
const SPARKS = 4;
const SPARK_STEP_MS = 90;

/** A hexagon's corners as unit offsets, flat sides up. */
const HEX_UNIT: readonly number[] = Array.from({ length: 12 }, (_, i) => {
  const a = (Math.floor(i / 2) * Math.PI) / 3;
  return i % 2 === 0 ? Math.cos(a) : Math.sin(a);
});

/**
 * Draw ops for the shield bubble, plating flash and Lightning aura around the player, in that
 * order (back to front). Appends to `ops` when given and returns the list.
 */
export function playerEffectOps(state: StarSwarmState, ops: DrawOp[] = []): DrawOp[] {
  const dbg = debugOpKeys();
  const { player } = state;
  const cx = player.x;
  const cy = player.y;
  const power = state.activePowerUp;

  // #1033 shield: a soft cyan-blue energy bubble with a brighter rim and a faint hex hint
  if (power?.type === "shield") {
    const r = player.width * SHIELD_RADIUS;
    ops.push({ k: "circle", key: dbg ? "shield" : undefined, cx, cy, r, color: SHIELD_BODY });
    ops.push({
      k: "circle",
      key: dbg ? "shield-edge" : undefined,
      cx,
      cy,
      r: r - 3,
      color: SHIELD_EDGE_BAND,
      stroke: 6,
    });
    const hr = r * HEX_RADIUS;
    const points: number[] = [];
    for (let i = 0; i < 12; i += 2) points.push(cx + HEX_UNIT[i]! * hr, cy + HEX_UNIT[i + 1]! * hr);
    ops.push({
      k: "poly",
      key: dbg ? "shield-hex" : undefined,
      points,
      color: SHIELD_HEX,
      stroke: 1,
    });
    ops.push({
      k: "circle",
      key: dbg ? "shield-ring" : undefined,
      cx,
      cy,
      r,
      color: SHIELD_RIM,
      stroke: 2,
    });
  }

  // #2488 hull plating flash: the plating that just took a hit, in armour blue with a pale core
  if (player.hullFlashTimer > 0) {
    const t = player.hullFlashTimer;
    const a = t / HIT_FLASH_DURATION;
    const r = player.width * (0.6 + 0.4 * (1 - a));
    ops.push({
      k: "circle",
      key: dbg ? "hull-flash" : undefined,
      cx,
      cy,
      r,
      color: withAlpha(ARMOR_BLUE_RGB, 0.75 * a),
      stroke: 3,
    });
    ops.push({
      k: "circle",
      key: dbg ? "hull-flash-core" : undefined,
      cx,
      cy,
      r,
      color: withAlpha(ARMOR_PALE_RGB, 0.9 * a),
      stroke: 1,
    });
  }

  // Lightning super-state: an electric halo and sparks that jump around the ship. The sparks'
  // angles step with the power-up's own countdown, so no clock or random numbers are needed.
  if (power?.type === "lightning") {
    const ringR = player.width * 0.7;
    ops.push({
      k: "circle",
      key: dbg ? "lightning" : undefined,
      cx,
      cy,
      r: player.width * 0.75,
      color: LIGHTNING_HALO,
    });
    ops.push({
      k: "circle",
      key: dbg ? "lightning-ring" : undefined,
      cx,
      cy,
      r: ringR,
      color: LIGHTNING_RING,
      stroke: 1.5,
    });
    const step = Math.floor(power.remainingMs / SPARK_STEP_MS);
    for (let i = 0; i < SPARKS; i++) {
      const a = ((i + 0.37 * (step % 7)) * 2 * Math.PI) / SPARKS;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const inner = ringR - 3;
      const tip = ringR + 5 + (step % 3) * 1.5;
      // a thin triangle: a base on the ring and a tip pointing outward
      ops.push({
        k: "poly",
        key: dbg ? `lightning-spark-${i}` : undefined,
        points: [
          cx + ca * inner - sa * 1.6,
          cy + sa * inner + ca * 1.6,
          cx + ca * tip,
          cy + sa * tip,
          cx + ca * inner + sa * 1.6,
          cy + sa * inner - ca * 1.6,
        ],
        color: LIGHTNING_SPARK,
      });
    }
  }
  return ops;
}
