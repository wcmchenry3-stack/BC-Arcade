/**
 * #2847: the short "GUNS +1" / "HULL +1" (or "GUNS MAX") toast shown when an upgrade pickup is
 * collected; #3512 adds "SHIELD → NEXT WAVE" (a power-up banked after the last kill) and
 * "SHIELD UP!" (it takes effect as the next wave's combat starts), in the same toast slot. Pure and React-free: `pickupCues` decides when one fires, `pickupCueFrame` how it
 * animates, so native and web share both and the lifecycle is unit-tested. Mechanics untouched —
 * this only reads two consecutive states, like `upgradeEvents`.
 */
import { GUNS_MAX, HULL_MAX } from "../engine";
import { cssHex } from "./color";
import { BOMB_RGB, BUDDY_POWERUP_RGB, HULL_BLUE_RGB, LIGHTNING_RGB } from "./palette";
import { PICKUP_ACCENT } from "./pickups";
import type { BankablePowerUp, StarSwarmState } from "../types";

export type PickupCueKind = "guns" | "hull";

/** An upgrade ladder's toast: "GUNS +1", "HULL +1" or the MAX variant (#2847). */
export interface UpgradeCue {
  readonly kind: PickupCueKind;
  /** The ladder was already full — the pickup was collected but changed nothing. */
  readonly max: boolean;
  /** Ladder level after the pickup. */
  readonly level: number;
}

/**
 * #3512: a banked power-up's toast — "SHIELD → NEXT WAVE" when it is collected after the last
 * kill (`banked`), "SHIELD UP!" when it takes effect on the next wave's first combat tick
 * (`applied`).
 */
export interface BankedCue {
  readonly kind: "banked" | "applied";
  readonly powerUp: BankablePowerUp;
}

export type PickupCue = UpgradeCue | BankedCue;

/**
 * #3187: where the "collect the power-ups" line sits, from the canvas top. The toast above is
 * drawn ~66 px down (web centre; native ~80-105 px with its margin) and rises 18 px, and the
 * HUD stack above it (score row, difficulty, GUNS/HULL) ends near 45-60 px. The line starts below
 * all of that, and on tall canvases at 24% of the height.
 */
export const COLLECT_CUE_MIN_TOP = 112;
/** The centred MISSION COMPLETE / ROUT line is ~28 px tall; the cue is one ~22 px line. */
const BANNER_HALF_H = 14;
const CUE_H = 22;
const CUE_GAP = 4;

/**
 * `canvasHeight` is in the units the cue is drawn in: the DISPLAYED height on native (the HUD
 * overlay is not scaled, so pass round(height * scale)), the engine height on web (its drawing
 * is scaled as a whole). If there is no room between the toast zone and the centred banner
 * (canvas shorter than ~304), the cue goes just below the banner instead of overlapping it.
 */
export function collectCueTop(canvasHeight: number): number {
  const preferred = Math.max(canvasHeight * 0.24, COLLECT_CUE_MIN_TOP);
  const lastAboveBanner = canvasHeight / 2 - BANNER_HALF_H - CUE_GAP - CUE_H;
  return preferred <= lastAboveBanner ? preferred : canvasHeight / 2 + BANNER_HALF_H + CUE_GAP;
}

/** How long a cue stays on screen, ms. */
export const PICKUP_CUE_MS = 1300;

/**
 * Cues fired between two ticks: a ladder rise, a pickup collected at the top of its ladder, or
 * (#3512) a power-up banked after the last kill or applied as the next wave's combat starts. Read
 * from two states the screen already has (a field compare), never stored.
 */
export function pickupCues(prev: StarSwarmState, next: StarSwarmState): PickupCue[] {
  const a = prev.player;
  const b = next.player;
  const out: PickupCue[] = [];
  const banked = next.bankedPowerUp;
  if (banked !== null && banked !== prev.bankedPowerUp) {
    out.push({ kind: "banked", powerUp: banked });
  } else if (prev.bankedPowerUp !== null && banked === null && next.phase === "Playing") {
    out.push({ kind: "applied", powerUp: prev.bankedPowerUp });
  }
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

const isBankedCue = (cue: PickupCue): cue is BankedCue =>
  cue.kind === "banked" || cue.kind === "applied";

/** #3512: the key suffix for a banked power-up ("SHIELD", "BOMB", …). */
const POWER_UP_KEY: Readonly<Record<BankablePowerUp, string>> = {
  shield: "Shield",
  lightning: "Lightning",
  buddy: "Buddy",
  bomb: "Bomb",
};

/** i18n key of a cue's label. */
export function pickupCueLabelKey(cue: PickupCue): string {
  if (isBankedCue(cue)) {
    return `hud.cue${cue.kind === "banked" ? "Banked" : "Applied"}${POWER_UP_KEY[cue.powerUp]}`;
  }
  const base = cue.kind === "guns" ? "hud.cueGuns" : "hud.cueHull";
  return cue.max ? `${base}Max` : base;
}

/**
 * The i18n key a screen reader hears for a cue, or null when it is spoken elsewhere: a ladder
 * rise is spoken by `onUpgrade`, so only its MAX variant (no upgrade event) is announced here;
 * #3512's banked and applied cues are announced once each, in words rather than the toast's arrow.
 */
export function pickupCueA11yKey(cue: PickupCue): string | null {
  if (isBankedCue(cue)) {
    return `a11y.${cue.kind === "banked" ? "banked" : "applied"}${POWER_UP_KEY[cue.powerUp]}`;
  }
  return cue.max ? pickupCueLabelKey(cue) : null;
}

export function pickupCueColor(kind: PickupCueKind): string {
  return PICKUP_ACCENT[kind === "guns" ? "salvage" : "hull"].hex;
}

/** #3512: a banked power-up's toast takes the colour its pickup is known by. */
const BANKED_CUE_HEX: Readonly<Record<BankablePowerUp, string>> = {
  shield: cssHex(HULL_BLUE_RGB),
  lightning: cssHex(LIGHTNING_RGB),
  buddy: cssHex(BUDDY_POWERUP_RGB),
  bomb: cssHex(BOMB_RGB),
};

/** Any cue's colour: an upgrade's accent, or a banked power-up's own colour. */
export function cueColor(cue: PickupCue): string {
  return isBankedCue(cue) ? BANKED_CUE_HEX[cue.powerUp] : pickupCueColor(cue.kind);
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
