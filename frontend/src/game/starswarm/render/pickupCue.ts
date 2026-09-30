/**
 * #2847: the short "GUNS +1" / "HULL +1" (or "GUNS MAX") toast shown when an upgrade pickup is
 * collected. Pure and React-free: `pickupCues` decides when one fires, `pickupCueFrame` how it
 * animates, so native and web share both and the lifecycle is unit-tested. Mechanics untouched —
 * this only reads two consecutive states, like `upgradeEvents`.
 */
import { GUNS_MAX, HULL_MAX } from "../engine";
import { PICKUP_ACCENT } from "./pickups";
import type { StarSwarmState } from "../types";

export type PickupCueKind = "guns" | "hull";

export interface PickupCue {
  readonly kind: PickupCueKind;
  /** The ladder was already full — the pickup was collected but changed nothing. */
  readonly max: boolean;
  /** Ladder level after the pickup. */
  readonly level: number;
}

/** How long a cue stays on screen, ms. */
export const PICKUP_CUE_MS = 1300;

/** Cues fired between two ticks: a ladder rise, or a pickup collected at the top of its ladder. */
export function pickupCues(prev: StarSwarmState, next: StarSwarmState): PickupCue[] {
  const a = prev.player;
  const b = next.player;
  const out: PickupCue[] = [];
  if (b.guns > a.guns) out.push({ kind: "guns", max: false, level: b.guns });
  if (b.hull > a.hull) out.push({ kind: "hull", max: false, level: b.hull });
  // A maxed ladder doesn't move, so spot the pickup that vanished onto the ship instead.
  const nextIds = new Set(next.powerUps.map((p) => p.id));
  for (const pu of prev.powerUps) {
    if (nextIds.has(pu.id)) continue;
    const kind: PickupCueKind | null =
      pu.type === "salvage" ? "guns" : pu.type === "hull" ? "hull" : null;
    if (!kind) continue;
    const full =
      kind === "guns"
        ? a.guns >= GUNS_MAX && b.guns >= GUNS_MAX
        : a.hull >= HULL_MAX && b.hull >= HULL_MAX;
    if (!full) continue;
    const margin = 8;
    const touching =
      Math.abs(pu.x - b.x) <= (pu.width + b.width) / 2 + margin &&
      Math.abs(pu.y - b.y) <= (pu.height + b.height) / 2 + margin;
    if (touching) out.push({ kind, max: true, level: kind === "guns" ? b.guns : b.hull });
  }
  return out;
}

/** i18n key of a cue's label. */
export function pickupCueLabelKey(cue: PickupCue): string {
  const base = cue.kind === "guns" ? "hud.cueGuns" : "hud.cueHull";
  return cue.max ? `${base}Max` : base;
}

export function pickupCueColor(kind: PickupCueKind): string {
  return PICKUP_ACCENT[kind === "guns" ? "salvage" : "hull"].hex;
}

export interface PickupCueFrame {
  readonly opacity: number;
  /** Vertical drift, px (negative = up). */
  readonly offsetY: number;
  readonly scale: number;
}

/** Pop in, hold, drift up and fade; null once the cue has expired. */
export function pickupCueFrame(elapsedMs: number): PickupCueFrame | null {
  "worklet";
  if (elapsedMs < 0 || elapsedMs >= PICKUP_CUE_MS) return null;
  const t = elapsedMs / PICKUP_CUE_MS;
  const fadeIn = Math.min(1, elapsedMs / 120);
  const fadeOut = t > 0.65 ? 1 - (t - 0.65) / 0.35 : 1;
  return {
    opacity: Math.max(0, Math.min(1, Math.min(fadeIn, fadeOut))),
    offsetY: -18 * t,
    scale: 1 + 0.25 * Math.max(0, 1 - elapsedMs / 200),
  };
}
