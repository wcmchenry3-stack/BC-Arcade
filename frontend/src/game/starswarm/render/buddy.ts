/**
 * #2845: Buddy's durability read-out as shared display-list geometry — a segmented HP bar over
 * the ship and a hit-flash ring when it takes damage.
 *
 * Both renderers replay the same ops: `buildFrame` (native Skia) appends them right after each
 * Buddy sprite, and `GameCanvas.web.tsx` replays them with `drawPickupOps`, so the two cannot
 * drift apart. Only `rect` and `circle` ops appear here.
 *
 * Readability: one pip per hit point on a dark track, green while healthy, amber at half, red
 * when one more volley could finish it. The bar sits above the ship so it never hides behind
 * Buddy's own sprite or its shots.
 */
import { BUDDY_HP, HIT_FLASH_DURATION } from "../engine";
import type { DrawOp } from "./frame";
import type { BuddyShip } from "../types";

/** Width of the whole HP bar, px. */
export const BUDDY_HP_BAR_W = 30;
export const BUDDY_HP_BAR_H = 4;
/** Gap between the bar and the top of the ship sprite, px. */
const BAR_GAP = 5;
const PIP_GAP = 1;

/** The bar colour for this much HP left (fraction of BUDDY_HP). */
export function buddyHpColor(hp: number): string {
  const f = hp / BUDDY_HP;
  if (f > 0.5) return "#4dff88";
  if (f > 0.25) return "#ffc233";
  return "#ff4a3d";
}

/** Draw ops for one Buddy's HP bar (and hit flash). `size` is the sprite's drawn size. */
export function buddyOps(b: BuddyShip, size: number): DrawOp[] {
  const key = `buddy-${b.id}`;
  const x0 = b.x - BUDDY_HP_BAR_W / 2;
  const y0 = b.y - size / 2 - BAR_GAP - BUDDY_HP_BAR_H;
  const ops: DrawOp[] = [
    {
      k: "rect",
      key: `${key}-hp-track`,
      x: x0 - 1,
      y: y0 - 1,
      w: BUDDY_HP_BAR_W + 2,
      h: BUDDY_HP_BAR_H + 2,
      color: "rgba(0,0,0,0.65)",
    },
  ];
  const pipW = (BUDDY_HP_BAR_W - PIP_GAP * (BUDDY_HP - 1)) / BUDDY_HP;
  const hp = Math.max(0, Math.min(BUDDY_HP, Math.ceil(b.hp)));
  const color = buddyHpColor(hp);
  for (let i = 0; i < hp; i++) {
    ops.push({
      k: "rect",
      key: `${key}-hp-${i}`,
      x: x0 + i * (pipW + PIP_GAP),
      y: y0,
      w: pipW,
      h: BUDDY_HP_BAR_H,
      color,
    });
  }
  if (b.hitFlashTimer > 0) {
    const a = b.hitFlashTimer / HIT_FLASH_DURATION;
    ops.push({
      k: "circle",
      key: `${key}-flash`,
      cx: b.x,
      cy: b.y,
      r: size * (0.55 + 0.25 * (1 - a)),
      color: `rgba(255,120,90,${(0.8 * a).toFixed(3)})`,
      stroke: 2,
    });
  }
  return ops;
}
