/**
 * Star Swarm engine — wave lifecycle gates and the extraction autopilot (#2842).
 *
 * The central gates (`weaponsFree`: may anything new be fired or spawned; `hazardsLive`: does
 * anything in flight resolve; `playerHasControl`: does input fly the ship), the live-hazard list
 * the autopilot and Buddy dodge, the autopilot itself (hold the lane, climb off the top), the
 * wave clear and its pickup wait (#3132), the extraction start/end and `clearTransientCombat`,
 * the hard wave-boundary reset.
 */
import type { CarrierBeam, Extraction, Player, PowerUp, StarSwarmState } from "../types";
import { WAVE_CLEAR_SOURCE, addScore } from "../scoreLedger";
import { powerUpDespawnMs } from "./entities";
import {
  EXTRACTION_HOLD_MAX_MS,
  EXTRACTION_HOLD_MIN_MS,
  EXTRACTION_MAX_MS,
  MISSION_COMPLETE_BANNER_MS,
  PICKUP_WAIT_SLACK_MS,
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
//   SwoopIn ──all arrived──▶ Playing ──last kill──┬─ no pickup on screen ──▶ Extraction
//                                                  └─ pickups on screen ──▶ ClearAwaitingPickups
//   ClearAwaitingPickups ──pickup list empty (or the safety cap)──▶ Extraction
//   Extraction ──a pickup appears while the ship still holds its lane──▶ ClearAwaitingPickups
//   Extraction ──ship out──▶ clearTransientCombat ──▶ buildWaveState (wave N+1) ──▶ SwoopIn
//
// The screen's 3 s countdown runs with the engine frozen before each SwoopIn, so combat begins
// only once both the countdown and the swoop-in are over. Central gates decide everything:
// weaponsFree (may anything *new* be fired or spawned?), hazardsLive (does anything already in
// flight resolve — hit, damage, collect?) and isAutopilot (does the AI fly the ship?).
//
// #3132: once the last enemy is down the player's weapons stop and nothing new enters from
// off-screen (`arrivalsAllowed`), but whatever is already on screen stays fair game: shots in
// flight keep flying and a rock they break can still drop salvage. The last kill's tick is still
// combat, so its own drops (the Carrier's plating, and the ordinary power-up roll it triggers)
// spawn as usual. While any pickup is on screen the wave waits in ClearAwaitingPickups with the
// player flying, so nothing is lost to the extraction or the reset.

/**
 * #2842: may anything new enter play — player or enemy fire, flak, a buddy's burst, the Carrier's
 * beam and twin lasers, a timed or thrown asteroid? Only in combat. Swoop-in is setup time; after
 * the last kill (#3132's pickup wait and the extraction) only what is already in flight resolves.
 */
export function weaponsFree(state: StarSwarmState): boolean {
  return state.phase === "Playing";
}

/**
 * #3132: may anything new enter play from off-screen — a timed or thrown asteroid, a
 * top-spawned power-up drop, a reinforcement? Only in combat. Judged on the phase the tick
 * started in, so the tick of the last kill still counts as combat (its ordinary drop is
 * allowed); from the next tick on, nothing arrives. What is already on screen is not affected:
 * a rock broken after the last kill still drops its salvage. The same gate as `weaponsFree`
 * today, named for the rule it states.
 */
export function arrivalsAllowed(state: StarSwarmState): boolean {
  return weaponsFree(state);
}

/**
 * #2842: do projectiles, rocks, beams and rams resolve against ships, and pickups get collected?
 * In combat, during #3132's pickup wait and during extraction — shots already fired stay real
 * after the wave's last kill. Never during swoop-in: the player and every enemy are invulnerable
 * until combat starts.
 */
export function hazardsLive(state: StarSwarmState): boolean {
  return (
    state.phase === "Playing" ||
    state.phase === "ClearAwaitingPickups" ||
    state.phase === "Extraction"
  );
}

/** #2842: the AI is flying the player ship (input is ignored). Not during #3132's pickup wait. */
export function isAutopilot(state: StarSwarmState): boolean {
  return state.phase === "Extraction";
}

/** #3132: every enemy is down — the pickup wait or the extraction. */
export function isWaveCleared(state: StarSwarmState): boolean {
  return state.phase === "ClearAwaitingPickups" || state.phase === "Extraction";
}

/** #2842: true on the tick the wave's last enemy dies (wave-clear sound, haptic, a11y). */
export function waveJustCleared(prev: StarSwarmState, next: StarSwarmState): boolean {
  return !isWaveCleared(prev) && isWaveCleared(next);
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
  // #3132: no pickup chase (#2945's, retired) — the wave waits for its pickups, player flying,
  // before the extraction begins, so the autopilot only dodges and climbs.
  const climbing =
    ex.climbMs > 0 ||
    (elapsedMs >= EXTRACTION_HOLD_MIN_MS &&
      (elapsedMs >= EXTRACTION_HOLD_MAX_MS || !hazards.some((h) => stillThreatens(h, p))));
  const climbMs = climbing ? ex.climbMs + dtMs : 0;
  const targetX = pickLane(p, hazards, state.canvasW, climbMs, climbing);
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
 * #2842: the last enemy is down. Award the clear bonus and raise the banner — once, here — then
 * either wait for the pickups still on screen (#3132) or hand the ship to the autopilot at once.
 * Nothing is frozen and nothing is removed: shots already fired (by either side, whether or not
 * their ship survives) and rocks keep flying and stay harmful.
 */
export function beginWaveClear(state: StarSwarmState): StarSwarmState {
  // #2490 ×2 on boss waves; #2837 credited to the wave just cleared
  const scored = addScore(
    state,
    WAVE_CLEAR_SOURCE,
    waveClearBonusPoints(state.wave, state.difficulty)
  );
  const cleared = { ...scored, missionCompleteTimer: MISSION_COMPLETE_BANNER_MS };
  return state.powerUps.length > 0
    ? { ...cleared, phase: "ClearAwaitingPickups", phaseTimer: 0 }
    : beginExtraction(cleared);
}

/**
 * #3132: one tick of the pickup wait's clock, in game time (it stops while paused and slows under
 * the bonus-life slow-mo like everything else). It counts from the newest pickup's arrival — a
 * rock broken during the wait can still drop salvage — so the cap never cuts a fresh pickup short.
 */
export function tickPickupWait(
  state: StarSwarmState,
  dtMs: number,
  prevPowerUps: readonly PowerUp[]
): StarSwarmState {
  if (state.phase !== "ClearAwaitingPickups") return state;
  const arrived = state.powerUps.some((p) => !prevPowerUps.some((q) => q.id === p.id));
  return { ...state, phaseTimer: arrived ? 0 : state.phaseTimer + dtMs };
}

/**
 * #3132: the safety cap on the pickup wait (ms), counted from the newest pickup's arrival. No
 * pickup outlives powerUpDespawnMs(canvasH), so the wait normally ends well before this.
 */
export function pickupWaitMaxMs(canvasH: number): number {
  return powerUpDespawnMs(canvasH) + PICKUP_WAIT_SLACK_MS;
}

/**
 * #3132: the cleared wave's pickup wait is over — every pickup was collected or left the screen,
 * or the safety cap ran out (`pickupWaitMaxMs`).
 */
export function pickupWaitOver(state: StarSwarmState): boolean {
  return (
    state.phase === "ClearAwaitingPickups" &&
    (state.powerUps.length === 0 || state.phaseTimer >= pickupWaitMaxMs(state.canvasH))
  );
}

/**
 * #3132: end the pickup wait. Only the safety cap can leave a pickup on screen here; that stuck
 * pickup is removed, so the extraction starts clean and never hands the ship back for it.
 */
export function endPickupWait(state: StarSwarmState): StarSwarmState {
  return beginExtraction(state.powerUps.length > 0 ? { ...state, powerUps: [] } : state);
}

/**
 * #3132: a pickup appeared during the extraction — salvage from a rock that a shot already in
 * flight broke — while the ship still holds its lane (it hasn't started to climb, so it is on
 * station). The player gets the ship back to collect it. Once the climb has begun the ship is
 * leaving: the extraction runs on.
 */
export function extractionYieldsToPickup(state: StarSwarmState): boolean {
  return (
    state.phase === "Extraction" &&
    state.extraction !== null &&
    state.extraction.climbMs === 0 &&
    state.powerUps.length > 0
  );
}

/** #3132: hand the ship back to the player and wait for the new pickup. */
export function resumePickupWait(state: StarSwarmState): StarSwarmState {
  return { ...state, phase: "ClearAwaitingPickups", phaseTimer: 0, extraction: null };
}

/** #2842: hand the ship to the extraction autopilot. */
export function beginExtraction(state: StarSwarmState): StarSwarmState {
  return {
    ...state,
    phase: "Extraction",
    phaseTimer: 0,
    extraction: { elapsedMs: 0, climbMs: 0 },
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
