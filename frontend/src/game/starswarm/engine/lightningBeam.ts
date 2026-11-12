/**
 * Star Swarm engine — the Lightning beam (#3562).
 *
 * While Lightning is active the ship fires one continuous beam per gun instead of bolts: L1 one
 * beam, L2 the twin pair, L3 the pair plus the spread pair (the same guns as `playerVolley`, see
 * `GUN_LAYOUT`). A spread beam is a straight line at the spread pair's angle. Each beam runs from
 * the gun on the ship's nose to the top of the screen, or stops at the first rock on its line
 * (rocks are cover, as they are for every shot).
 *
 * Damage is pulsed on the Lightning fire clock: `player.shootCooldown`, re-armed to
 * `SUPER_SHOOT_COOLDOWN` (70 ms) on each pulse exactly as a Lightning volley re-armed it, so the
 * cadence (and the 5 s total) is today's. A pulse deals `SUPER_DAMAGE` to the rock that stops each
 * beam and to every ship that beam crossed since the previous pulse; `tickCollisions` resolves it
 * (`resolveLightningPulse`). The beams themselves are derived from the player, its guns and the
 * rocks; the one stored field is `lightningPulseX`.
 *
 * #3709, the swept hit test. The ship's x follows the finger, so a fast sweep could cross a ship
 * between two pulses (about 83 ms apart at 60 Hz) and never touch it. Each pulse now sweeps each
 * beam horizontally from where it was at the last pulse (`lightningPulseX` + the gun's offset) to
 * where it is now, keeping the beam's current width and length (`lightningSweepDx`,
 * `beamSweepHitsAabb`):
 * - The span is the ship's own travel, so every gun's beam (L3's spread pair included) is swept
 *   by the same `dx` from its own position: each beam sweeps its own span.
 * - Rocks are judged at the pulse instant, as before: the first rock on a beam's line now stops
 *   it along the whole span and alone takes the pulse; a rock the span crossed but the beam does
 *   not touch now neither blocks nor is hit.
 * - With no previous pulse (the beam's first, after a release, after the beam was off, after a
 *   resume) or a move longer than `LIGHTNING_SWEEP_MAX_PX` (a jump, not a sweep), `dx` is 0:
 *   the beam's instant overlap, exactly the #3562 test. A held beam also has `dx` 0.
 * - `withLightningPulseX` keeps the field after each tick: set on a pulse, kept while the beam is
 *   on and the trigger held, removed otherwise.
 *
 * The geometry is written into a caller-owned scratch (`lightningBeamAt`), so neither the engine
 * nor the two renderers (`render/lightningBeam.ts`) allocate for it per tick or per frame.
 */
import type { Asteroid, GunsLevel, StarSwarmInput, StarSwarmState } from "../types";
import { playerFireAllowed } from "./extraction";
import { beamHitsAabb, circleAlongBeam, type BeamRect } from "./geometry";
import {
  BULLET_C_W,
  BULLET_P_VY,
  LIGHTNING_SWEEP_MAX_PX,
  SPREAD_OFFSET,
  SPREAD_VX,
  TWIN_OFFSET,
} from "./tuning";

/** A gun on the ship's nose: its offset from the centre, and its shots' sideways drift (px/ms). */
export interface Gun {
  readonly dx: number;
  readonly vx: number;
}

/**
 * #2488/#3562: the guns at each level, in volley order. `playerVolley` fires one bolt from each;
 * Lightning fires one beam from each.
 */
export const GUN_LAYOUT: Readonly<Record<GunsLevel, readonly Gun[]>> = {
  1: [{ dx: 0, vx: 0 }],
  2: [
    { dx: -TWIN_OFFSET, vx: 0 },
    { dx: TWIN_OFFSET, vx: 0 },
  ],
  3: [
    { dx: -TWIN_OFFSET, vx: 0 },
    { dx: TWIN_OFFSET, vx: 0 },
    { dx: -SPREAD_OFFSET, vx: -SPREAD_VX },
    { dx: SPREAD_OFFSET, vx: SPREAD_VX },
  ],
};

/** The beam's half-width: as wide as the Lightning bolt it replaced (`BULLET_C_W`). */
export const LIGHTNING_BEAM_HALF_W = BULLET_C_W / 2;

/** One beam's geometry; `rock` is the index (in the rock list given) of the rock that stops it, or -1. */
export interface LightningBeam extends BeamRect {
  ox: number;
  oy: number;
  ux: number;
  uy: number;
  len: number;
  halfW: number;
  rock: number;
}

/** A fresh scratch beam for `lightningBeamAt` to fill. */
export function newLightningBeam(): LightningBeam {
  return { ox: 0, oy: 0, ux: 0, uy: -1, len: 0, halfW: LIGHTNING_BEAM_HALF_W, rock: -1 };
}

/**
 * Is the beam on? Lightning is active and the player may fire: combat or the pickup wait
 * (`playerFireAllowed`, #3568; never swoop-in, the extraction or game over), and the dev panel's
 * "Player missiles off" is not set. Banked Lightning (#3512) is not active, so it has no beam.
 * The screens always hold the trigger, so this is also what they draw and what the loop plays.
 */
export function lightningBeamOn(state: StarSwarmState): boolean {
  return (
    state.activePowerUp?.type === "lightning" &&
    playerFireAllowed(state) &&
    !state.playerFireDisabled
  );
}

/** How many beams are on: one per gun while `lightningBeamOn`, else 0. */
export function lightningBeamCount(state: StarSwarmState): number {
  return lightningBeamOn(state) ? GUN_LAYOUT[state.player.guns].length : 0;
}

/**
 * Does a pulse land this tick? The trigger is held, the beam is on, and the Lightning fire clock
 * (`shootCooldown`, after this tick's `dtMs`) has run out — the same test that fired a Lightning
 * volley before #3562.
 */
export function lightningPulseDue(
  state: StarSwarmState,
  dtMs: number,
  input: StarSwarmInput
): boolean {
  return (
    input.fire && lightningBeamOn(state) && Math.max(0, state.player.shootCooldown - dtMs) === 0
  );
}

/**
 * Beam `i` (`0 ≤ i < lightningBeamCount`) written into `out`: from gun `i` on the ship's nose,
 * along that gun's line (straight up, or the spread angle), to the top of the screen (`y = 0`),
 * or to the centre of the nearest unbroken rock on that line when one is. Returns `out`.
 */
export function lightningBeamAt(
  state: StarSwarmState,
  i: number,
  rocks: readonly Asteroid[],
  out: LightningBeam
): LightningBeam {
  const { player } = state;
  const gun = GUN_LAYOUT[player.guns][i]!;
  const speed = Math.hypot(gun.vx, BULLET_P_VY);
  out.ox = player.x + gun.dx;
  out.oy = player.y - player.height / 2;
  out.ux = gun.vx / speed;
  out.uy = BULLET_P_VY / speed;
  out.halfW = LIGHTNING_BEAM_HALF_W;
  out.len = Math.max(0, out.oy / -out.uy);
  out.rock = -1;
  let nearest = Infinity;
  for (let r = 0; r < rocks.length; r++) {
    const rock = rocks[r]!;
    if (rock.hp <= 0) continue; // already broken this tick: it no longer stops anything
    const along = circleAlongBeam(out, rock.x, rock.y, rock.radius);
    if (along !== null && along < nearest) {
      nearest = along;
      out.rock = r;
    }
  }
  if (out.rock >= 0) out.len = Math.max(0, Math.min(out.len, nearest));
  return out;
}

/**
 * #3709: how far the beams moved since the last pulse (px; + is rightwards): the ship's x now
 * less its x at that pulse. 0 with no previous pulse, or for a move longer than
 * `LIGHTNING_SWEEP_MAX_PX` (a jump): that pulse uses the beams' instant overlap.
 */
export function lightningSweepDx(state: StarSwarmState): number {
  const last = state.lightningPulseX;
  if (last === undefined) return 0;
  const dx = state.player.x - last;
  return Math.abs(dx) <= LIGHTNING_SWEEP_MAX_PX ? dx : 0;
}

/**
 * #3709: did the beam cross an AABB (centre `(bx, by)`, extents `bw × bh`) while it slid
 * horizontally to where it is now from `dx` px back? Sliding the beam by `-u` (u from 0 to `dx`)
 * over a box is sliding the box by `+u` under the beam, and those boxes together are one box,
 * `|dx|` wider and centred `dx / 2` along: so this is exact, and with `dx` 0 it is `beamHitsAabb`.
 */
export function beamSweepHitsAabb(
  b: BeamRect,
  dx: number,
  bx: number,
  by: number,
  bw: number,
  bh: number
): boolean {
  return beamHitsAabb(b, bx + dx / 2, by, bw + Math.abs(dx), bh);
}

/**
 * #3709: the state after a tick, with `lightningPulseX` kept up: the ship's x when a pulse
 * landed this tick, unchanged while the beam stays on with the trigger held, and removed (the
 * key itself, so a state without Lightning is as before #3709) once either stops.
 */
export function withLightningPulseX(
  state: StarSwarmState,
  pulsed: boolean,
  input: StarSwarmInput
): StarSwarmState {
  if (input.fire && lightningBeamOn(state)) {
    if (!pulsed || state.lightningPulseX === state.player.x) return state;
    return { ...state, lightningPulseX: state.player.x };
  }
  if (state.lightningPulseX === undefined) return state;
  const { lightningPulseX: _dropped, ...rest } = state;
  return rest;
}

/**
 * #3709 (review): forget the sweep origin. The canvases call this when a paused game resumes: while
 * paused no tick runs, but the commanded ship x can still move (arrow keys), and the ship jumps to
 * it on the first tick, so the first pulse after a resume must fall back to the instant overlap
 * instead of sweeping that jump.
 */
export function clearLightningSweep(state: StarSwarmState): StarSwarmState {
  if (state.lightningPulseX === undefined) return state;
  const { lightningPulseX: _dropped, ...rest } = state;
  return rest;
}
