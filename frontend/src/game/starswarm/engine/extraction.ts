/**
 * Star Swarm engine — wave lifecycle gates and the extraction autopilot (#2842).
 *
 * The two central gates (`weaponsFree`: may anything new be fired or spawned; `hazardsLive`:
 * does anything in flight resolve), the live-hazard list the autopilot and Buddy dodge, the
 * autopilot itself (hold the lane, chase a pickup (#2945), climb off the top), the extraction
 * start/end and `clearTransientCombat`, the hard wave-boundary reset.
 */
import type { CarrierBeam, Extraction, Player, PowerUp, StarSwarmState } from "../types";
import { WAVE_CLEAR_SOURCE, addScore } from "../scoreLedger";
import {
  EXTRACTION_HOLD_MAX_MS,
  EXTRACTION_HOLD_MIN_MS,
  EXTRACTION_MAX_MS,
  EXTRACTION_PICKUP_HOLD_MAX_MS,
  MISSION_COMPLETE_BANNER_MS,
  PILOT_CLIMB_ACCEL,
  PILOT_CLIMB_MAX,
  PILOT_LOOKAHEAD_MS,
  PILOT_MARGIN,
  PILOT_SPEED,
  PILOT_STEP,
  PLAYER_HURT_RADIUS,
  waveClearBonusPoints,
} from "./tuning";

/** #2843: a released beam as a chain of overlapping circles covering its length. */
export function beamHazards(b: CarrierBeam): Hazard[] {
  const out: Hazard[] = [];
  const step = b.halfWidth * 1.5;
  for (let d = 0; d <= b.length; d += step) {
    out.push({ x: b.x, y: b.y - d, vx: 0, vy: b.vy, r: b.halfWidth });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Wave lifecycle (#2842)
// ---------------------------------------------------------------------------
//
//   SwoopIn ──all arrived──▶ Playing ──last kill──▶ Extraction ──ship out──▶ clearTransientCombat
//      ▲                                                                           │
//      └─────────────────────────────── buildWaveState (wave N+1) ◀────────────────┘
//
// The screen's 3 s countdown runs with the engine frozen before each SwoopIn, so combat begins
// only once both the countdown and the swoop-in are over. Two central gates decide everything:
// weaponsFree (may anything *new* be fired or spawned?) and hazardsLive (does anything already
// in flight resolve — hit, damage, collect?).

/**
 * #2842: may anything new enter play — player or enemy fire, flak, a buddy's burst, the Carrier's
 * beam and twin lasers, a timed or thrown asteroid? Only in combat. Swoop-in is setup time and
 * extraction only lets what is already in flight resolve.
 */
export function weaponsFree(state: StarSwarmState): boolean {
  return state.phase === "Playing";
}

/**
 * #2842: do projectiles, rocks, beams and rams resolve against ships? In combat, and during
 * extraction — shots already fired stay real after the wave's last kill. Never during swoop-in:
 * the player and every enemy are invulnerable until combat starts.
 */
export function hazardsLive(state: StarSwarmState): boolean {
  return state.phase === "Playing" || state.phase === "Extraction";
}

/** #2842: the AI is flying the player ship (input is ignored). */
export function isAutopilot(state: StarSwarmState): boolean {
  return state.phase === "Extraction";
}

/** #2842: true on the tick the wave's last enemy dies (wave-clear sound, haptic, a11y). */
export function waveJustCleared(prev: StarSwarmState, next: StarSwarmState): boolean {
  return prev.phase !== "Extraction" && next.phase === "Extraction";
}

/** #2842: a hostile thing in flight, as a circle, for the extraction autopilot. */
export interface Hazard {
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
  readonly r: number;
}

/**
 * #2842: every hostile hazard still in flight: enemy shots (flak included), rocks and (#2843)
 * released Carrier beams. A new traveling hostile entity must be added here so the autopilot
 * dodges it, and to clearTransientCombat so it cannot outlive its wave.
 */
export function liveHazards(state: StarSwarmState): Hazard[] {
  const hazards: Hazard[] = state.enemyBullets.map((b) => ({
    x: b.x,
    y: b.y,
    vx: b.vx,
    vy: b.vy,
    r: Math.max(b.width, b.height) / 2,
  }));
  for (const a of state.asteroids) {
    if (a.hp > 0) hazards.push({ x: a.x, y: a.y, vx: a.vx, vy: a.vy, r: a.radius });
  }
  // #2843: a beam is a long band, not a circle — cover it with a chain of overlapping circles
  for (const b of state.carrierBeams) hazards.push(...beamHazards(b));
  // #2845: Buddy, and the shots it fires, are allied — never a hazard to the ship. Enemy shots
  // aimed at Buddy are enemy shots like any other and are listed above.
  return hazards;
}

function climbSpeed(climbMs: number): number {
  return Math.min(PILOT_CLIMB_MAX, PILOT_CLIMB_ACCEL * climbMs);
}

/** A hazard that could still reach the ship — anything but one below it and falling away. */
function stillThreatens(h: Hazard, p: Player): boolean {
  return !(h.y - h.r > p.y + PLAYER_HURT_RADIUS && h.vy >= 0);
}

/**
 * How dangerous heading for lane `targetX` is over the next ~700 ms: every sampled moment a
 * hazard would come within reach of the ship counts, near moments weighing more. 0 = clear.
 */
function laneDanger(
  p: Player,
  hazards: readonly Hazard[],
  targetX: number,
  climbMs: number,
  climbing: boolean
): number {
  let danger = 0;
  const dx = targetX - p.x;
  for (const t of PILOT_LOOKAHEAD_MS) {
    const sx = p.x + Math.sign(dx) * Math.min(Math.abs(dx), PILOT_SPEED * t);
    const sy = climbing ? p.y - climbSpeed(climbMs + t / 2) * t : p.y;
    const weight = 1 / (1 + t / 250);
    for (const h of hazards) {
      const reach = h.r + PLAYER_HURT_RADIUS + PILOT_MARGIN;
      const hx = h.x + h.vx * t - sx;
      const hy = h.y + h.vy * t - sy;
      if (hx * hx + hy * hy < reach * reach) danger += weight;
    }
  }
  return danger;
}

/** The safest lane to steer for — the current one unless another is strictly safer. */
function pickLane(
  p: Player,
  hazards: readonly Hazard[],
  canvasW: number,
  climbMs: number,
  climbing: boolean
): number {
  if (hazards.length === 0) return p.x;
  let best = p.x;
  let bestCost = laneDanger(p, hazards, p.x, climbMs, climbing) * 1000;
  if (bestCost === 0) return p.x;
  const hw = p.width / 2;
  for (let x = hw; x <= canvasW - hw; x += PILOT_STEP) {
    const cost = laneDanger(p, hazards, x, climbMs, climbing) * 1000 + Math.abs(x - p.x) * 0.01;
    if (cost < bestCost) {
      bestCost = cost;
      best = x;
    }
  }
  return best;
}

/**
 * #2945: the lane of the persistent pickup (salvage / hull) the ship can still collect, or null.
 * Pickups fall at a fixed
 * speed, so the ship holds its row and meets one: it must arrive before the pickup falls past,
 * be reachable laterally by then, and land inside the pickup hold window. First in array order
 * wins a tie, so the choice is deterministic.
 */
function pickupLane(state: StarSwarmState, elapsedMs: number): number | null {
  const p = state.player;
  let best: PowerUp | null = null;
  let bestArrive = Infinity;
  for (const pu of state.powerUps) {
    // only upgrades persist: the reset wipes timed buffs (shield, lightning), Buddy and bombs
    if ((pu.type !== "salvage" && pu.type !== "hull") || pu.vy <= 0) continue;
    const gap = p.y - pu.y - (p.height + pu.height) / 2; // vertical distance until they touch
    const arrive = Math.max(0, gap) / pu.vy;
    const leave = Math.max(0, p.y - pu.y + (p.height + pu.height) / 2) / pu.vy; // fallen past
    const lateral = Math.max(0, Math.abs(pu.x - p.x) - (p.width + pu.width) / 2);
    if (
      leave <= 0 ||
      pu.despawnTimer <= arrive ||
      elapsedMs + arrive > EXTRACTION_PICKUP_HOLD_MAX_MS ||
      lateral / PILOT_SPEED > leave
    )
      continue;
    if (arrive < bestArrive) {
      best = pu;
      bestArrive = arrive;
    }
  }
  if (!best) return null;
  const hw = p.width / 2;
  return Math.max(hw, Math.min(state.canvasW - hw, best.x));
}

/**
 * #2842: one tick of the extraction autopilot. The ship holds the lane, sidestepping whatever
 * is still live, for at least EXTRACTION_HOLD_MIN_MS; once nothing can still reach it (or at
 * EXTRACTION_HOLD_MAX_MS regardless) it accelerates off the top, still steering around hazards.
 * Deterministic: no rng, so seeded runs replay exactly.
 */
export function tickExtractionPilot(
  state: StarSwarmState,
  ex: Extraction,
  dtMs: number
): { player: Player; extraction: Extraction } {
  const p = state.player;
  const elapsedMs = ex.elapsedMs + dtMs;
  const hazards = liveHazards(state);
  // #2945: a collectable pickup holds the ship in the lane (up to the pickup hold cap) and draws
  // it sideways — but only into a lane with no hazard coming, so hazards keep priority.
  const chaseX = ex.climbMs > 0 ? null : pickupLane(state, elapsedMs);
  const chase = chaseX !== null && laneDanger(p, hazards, chaseX, 0, false) === 0 ? chaseX : null;
  const climbing =
    ex.climbMs > 0 ||
    (elapsedMs >= EXTRACTION_HOLD_MIN_MS &&
      chase === null &&
      (elapsedMs >= EXTRACTION_HOLD_MAX_MS || !hazards.some((h) => stillThreatens(h, p))));
  const climbMs = climbing ? ex.climbMs + dtMs : 0;
  const targetX = chase ?? pickLane(p, hazards, state.canvasW, climbMs, climbing);
  const dx = targetX - p.x;
  const x = p.x + Math.sign(dx) * Math.min(Math.abs(dx), PILOT_SPEED * dtMs);
  const y = climbing ? p.y - climbSpeed(climbMs) * dtMs : p.y;
  return { player: { ...p, x, y }, extraction: { elapsedMs, climbMs } };
}

/** #2842: the ship is off the top (or the extraction timed out) — time for the reset. */
export function extractionComplete(state: StarSwarmState): boolean {
  const ex = state.extraction;
  if (state.phase !== "Extraction" || !ex) return false;
  return state.player.y + state.player.height / 2 < 0 || ex.elapsedMs >= EXTRACTION_MAX_MS;
}

/**
 * #2842: the last enemy is down. Award the clear bonus, raise the banner and hand the ship to
 * the autopilot. Nothing is frozen and nothing is removed: shots already fired (by either side,
 * whether or not their ship survives) and rocks keep flying and stay harmful.
 */
export function beginExtraction(state: StarSwarmState): StarSwarmState {
  // #2490 ×2 on boss waves; #2837 credited to the wave just cleared
  const scored = addScore(
    state,
    WAVE_CLEAR_SOURCE,
    waveClearBonusPoints(state.wave, state.difficulty)
  );
  return {
    ...scored,
    phase: "Extraction",
    extraction: { elapsedMs: 0, climbMs: 0 },
    missionCompleteTimer: MISSION_COMPLETE_BANNER_MS,
  };
}

/**
 * #2842: the hard wave-boundary reset — the one explicit place transient combat entities leave
 * play other than by their own hit or despawn. Projectiles are never removed because the ship
 * that fired them died (see the #2776 invariants); they persist until this boundary.
 *
 * Clears: player shots (Buddy's shots are player-owned, so included), enemy shots (aimed, burst,
 * twin-laser, flak, and #2845's shots at Buddy), asteroids, Buddy ships (with their HP, bursts
 * and steering state, #2845), #2843's released Carrier beams, and any beam charge or attack-run
 * brace still on a Carrier. Plug-in point: a new transient combat entity must be cleared here
 * (and in the reset tests in engine.extraction.test.ts / buddy.test.ts), so nothing from wave N can
 * interact with wave N+1.
 */
export function clearTransientCombat(state: StarSwarmState): StarSwarmState {
  return {
    ...state,
    playerBullets: [],
    enemyBullets: [],
    carrierBeams: [],
    asteroids: [],
    buddyShips: [],
    enemies: state.enemies.map((e) =>
      e.beamPhase === "idle" && e.runPhase === "idle"
        ? e
        : { ...e, beamPhase: "idle" as const, runPhase: "idle" as const }
    ),
    extraction: null,
  };
}
