/**
 * Star Swarm engine — the Carrier (#2484, #2485, #2843).
 *
 * The staged boss: cadence ranges and seeded rolls, the finite-capacity volley seam
 * (`chooseCarrierTarget`: a rock, Buddy or the player — never an extra gun), the twin lasers,
 * the traveling beam and the attack run, all in `tickCarrier`; plus the renderer/event
 * selectors (`carrierBeamCharge`, `carrierRunBrace`, the `*JustStarted` edges). The Carrier's
 * stage itself is read in `roster.ts`.
 */
import type {
  Asteroid,
  BeamPhase,
  BuddyShip,
  Bullet,
  CarrierBeam,
  CarrierStage,
  CubicBezier,
  DifficultyTier,
  Enemy,
  StarSwarmState,
} from "../types";
import { firstClearPath, type RockLike } from "./asteroids";
import { aimAtBuddy, buddyDivertRoll } from "./buddy";
import { aimVelocity, evalCubic } from "./geometry";
import { nextId, peekNextId, rng } from "./rng";
import { STAGE_RANK } from "./roster";
import {
  ATTACK_RUN,
  ATTACK_RUN_BRACE_LIFT,
  ATTACK_RUN_BRACE_MS,
  ATTACK_RUN_HOLD_MAX_MS,
  ATTACK_RUN_SHALLOW_FACTOR,
  BEAM_CHARGE_MS,
  BEAM_HALF_WIDTH,
  BEAM_LENGTH,
  BEAM_SPEED,
  BOSS_WAVE_BEAM_SCALE,
  BULLET_E_H,
  BULLET_E_W,
  CADENCE_INACTIVE_MS,
  CANVAS_H,
  CARRIER_CADENCE_CAP,
  CARRIER_CADENCE_FLOOR,
  CARRIER_FLAK_RANGE,
  DEFAULT_TUNING,
  FLAK_LEAD_MS,
  FLAK_SPEED,
  GUARDIAN_BULLET_VY,
  TWIN_FIRE_OFFSET,
  difficultyParamScale,
  type CadenceRange,
  type CarrierCadence,
  type Tuning,
} from "./tuning";

// ---------------------------------------------------------------------------
// Carrier cadences (#2843)
// ---------------------------------------------------------------------------

/**
 * #2843: the bounds a Carrier cadence rolls within, at this stage, difficulty and wave; null if
 * the action doesn't happen in that stage. Difficulty divides by min(1.6, paramScale), a boss
 * wave divides the beam by a further 1.5, and nothing goes below CARRIER_CADENCE_FLOOR.
 */
export function carrierCadenceBounds(
  kind: CarrierCadence,
  stage: CarrierStage,
  difficulty: DifficultyTier,
  bossWave: boolean,
  tuning: Tuning = DEFAULT_TUNING
): CadenceRange | null {
  const base = tuning.CARRIER_CADENCE[kind][stage];
  if (!base) return null;
  const div =
    Math.min(CARRIER_CADENCE_CAP, difficultyParamScale(difficulty)) *
    (kind === "beam" && bossWave ? BOSS_WAVE_BEAM_SCALE : 1);
  const floor = CARRIER_CADENCE_FLOOR[kind];
  return { min: Math.max(floor, base.min / div), max: Math.max(floor, base.max / div) };
}

/**
 * #2843: one seeded roll of a Carrier cadence — uniform within `carrierCadenceBounds`. An action
 * that doesn't happen in this stage returns CADENCE_INACTIVE_MS without drawing from the rng (a
 * finite "never", so it survives a save — JSON has no Infinity). Uses the engine's rng(), so
 * seeded runs replay exactly.
 */
export function rollCarrierCadence(
  kind: CarrierCadence,
  stage: CarrierStage,
  difficulty: DifficultyTier,
  bossWave: boolean,
  tuning: Tuning = DEFAULT_TUNING
): number {
  const b = carrierCadenceBounds(kind, stage, difficulty, bossWave, tuning);
  if (!b) return CADENCE_INACTIVE_MS;
  return b.min + rng() * (b.max - b.min);
}

// ---------------------------------------------------------------------------
// Enemies
// ---------------------------------------------------------------------------

export interface EnemyTickResult {
  enemy: Enemy;
  bullet: Bullet | null;
  /** #2485: a volley (the Carrier's twin lasers) — each still counts against bulletCap(). */
  bullets?: Bullet[];
  /** #2843: a released Carrier beam — its own entity from here on (see CarrierBeam). */
  beam?: CarrierBeam;
}

/** #2485/#2843: what the Carrier needs to know that the per-enemy tick otherwise doesn't see. */
export interface CarrierCtx {
  /** Playing phase — the Carrier only acts mid-wave. */
  playing: boolean;
  /** The Carrier's live stage this tick (null with no Carrier). */
  stage: CarrierStage | null;
  /** The stage the Carrier last acted on (`state.carrierStage`) — an escalation re-rolls. */
  prevStage: CarrierStage | null;
  /** #2490: boss wave — the beam cadence is BOSS_WAVE_BEAM_SCALE× faster. */
  bossWave: boolean;
  difficulty: DifficultyTier;
  playerX: number;
  playerY: number;
  canvasH: number;
  /** #2844: a rock the exposed Carrier would answer with flak this tick (see `carrierFlakRock`); else null. */
  flakRock: CarrierFlakRock | null;
  /**
   * #2845: the Buddy an *exposed* Carrier may divert a volley to (nearest in range, pressure cap
   * not reached); null while armored or with no Buddy to shoot at.
   */
  buddy: BuddyShip | null;
  /**
   * #3131: live rocks already on screen, which the attack run is vetted against when it commits
   * (`carrierRunCandidates` / `firstClearPath`). Empty with no rocks in play.
   */
  rocks: readonly RockLike[];
}
export const NO_CARRIER_CTX: CarrierCtx = {
  playing: false,
  stage: null,
  prevStage: null,
  bossWave: false,
  difficulty: "LieutenantJG",
  playerX: 0,
  playerY: 0,
  canvasH: CANVAS_H,
  flakRock: null,
  buddy: null,
  rocks: [],
};

/** #2844: the part of a rock the Carrier's flak choice needs. */
export type CarrierFlakRock = Pick<Asteroid, "x" | "y" | "vx" | "vy">;

/**
 * #2843/#2844 finite-capacity seam: where a Carrier volley goes. The Carrier's own timers decide
 * *when* it fires and how much; this decides only *where*. A volley aimed at a rock REPLACES the
 * player-directed one on the same timer — it never adds a volley, a gun or any cadence. #2845:
 * a volley at Buddy plugs in here the same way — the same two guns on the same timer.
 */
export type CarrierTarget =
  | { readonly kind: "player"; readonly x: number; readonly y: number }
  | {
      readonly kind: "rock";
      /** Lead point the flak is aimed at. */
      readonly x: number;
      readonly y: number;
    }
  | {
      readonly kind: "buddy";
      /** The Buddy being shot at (the volley leads it, see aimAtBuddy). */
      readonly buddy: BuddyShip;
      /** Stateless per-volley key for the aim-error hash. */
      readonly key: number;
    };

/**
 * #2844: the nearest live rock an *exposed* Carrier would divert its volley to — approaching and
 * within CARRIER_FLAK_RANGE. Null while armored (its force field handles rocks), with flak
 * disabled, or when nothing is coming. Pure and rng-free, so a Carrier's diverted volley never
 * perturbs the seeded stream.
 */
export function carrierFlakRock(
  carrier: Pick<Enemy, "x" | "y">,
  rocks: readonly Asteroid[],
  armored: boolean
): CarrierFlakRock | null {
  if (armored) return null;
  let best: Asteroid | null = null;
  let bestD = CARRIER_FLAK_RANGE * CARRIER_FLAK_RANGE;
  for (const a of rocks) {
    if (a.hp <= 0) continue;
    const dx = a.x - carrier.x;
    const dy = a.y - carrier.y;
    if (a.vx * -dx + a.vy * -dy <= 0) continue; // not approaching
    const d = dx * dx + dy * dy;
    if (d < bestD) {
      best = a;
      bestD = d;
    }
  }
  return best;
}

/**
 * Where this volley goes: a threatening rock first (#2844), then — #2845, exposed Carrier only —
 * Buddy on a `BUDDY_TARGETING.Carrier.divert` roll, else the player. The roll is a stateless hash
 * of `key` (the volley's first bullet id), so it never draws from the seeded rng.
 */
export function chooseCarrierTarget(
  ctx: CarrierCtx,
  key = 0,
  tuning: Tuning = DEFAULT_TUNING
): CarrierTarget {
  if (ctx.flakRock) {
    const r = ctx.flakRock;
    return { kind: "rock", x: r.x + r.vx * FLAK_LEAD_MS, y: r.y + r.vy * FLAK_LEAD_MS };
  }
  if (ctx.buddy && buddyDivertRoll(key) < tuning.BUDDY_TARGETING.Carrier.divert) {
    return { kind: "buddy", buddy: ctx.buddy, key };
  }
  return { kind: "player", x: ctx.playerX, y: ctx.playerY };
}

/** #2485/#2699: the Carrier's twin lasers, aimed at `target`. */
function carrierTwinVolley(c: Enemy, target: CarrierTarget, tuning: Tuning): Bullet[] {
  return [-TWIN_FIRE_OFFSET, TWIN_FIRE_OFFSET].map((dx) => {
    const ox = c.x + dx;
    const oy = c.y + c.height / 2;
    if (target.kind === "buddy") {
      // #2845: the same two guns on the same timer, aimed at Buddy instead of the player
      const vel = aimAtBuddy(ox, oy, target.buddy, "Carrier", target.key + dx, tuning);
      return {
        id: nextId(),
        x: ox,
        y: oy,
        vx: vel.vx,
        vy: vel.vy,
        owner: "enemy" as const,
        width: BULLET_E_W,
        height: BULLET_E_H,
        damage: 1,
        target: "buddy" as const,
      };
    }
    if (target.kind === "rock") {
      // #2844: diverted to flak — same two guns, same timer, aimed at the rock; outside the cap
      const len = Math.hypot(target.x - ox, target.y - oy) || 1;
      return {
        id: nextId(),
        x: ox,
        y: oy,
        vx: ((target.x - ox) / len) * FLAK_SPEED,
        vy: ((target.y - oy) / len) * FLAK_SPEED,
        owner: "enemy" as const,
        width: BULLET_E_W,
        height: BULLET_E_H,
        damage: 1,
        flak: true,
      };
    }
    const vel = aimVelocity(ox, c.y, target.x, target.y, GUARDIAN_BULLET_VY);
    return {
      id: nextId(),
      x: ox,
      y: oy,
      vx: vel.vx,
      vy: vel.vy,
      owner: "enemy" as const,
      width: BULLET_E_W,
      height: BULLET_E_H,
      damage: 1,
    };
  });
}

/** #2843: a released beam, leaving the Carrier's emitter and heading straight down. */
function releaseBeam(c: Enemy): CarrierBeam {
  return {
    id: nextId(),
    x: c.x,
    y: c.y + c.height / 2,
    vy: BEAM_SPEED,
    length: BEAM_LENGTH,
    halfWidth: BEAM_HALF_WIDTH,
  };
}

/**
 * #2843: the Carrier's heavy attack run — not a Grunt dive. It leans out to one side, sweeps
 * down to the player's column (captured when the brace began) at `depth`, and climbs back to
 * its station: one slow, wide, readable swoop that never reaches the player lane. Deeper and
 * quicker in the final stand.
 */
export function carrierRunPath(
  c: Enemy,
  targetX: number,
  canvasH: number,
  stage: Exclude<CarrierStage, "protected">,
  variant: { readonly mirror?: boolean; readonly shallow?: boolean } = {}
): CubicBezier {
  const depth = ATTACK_RUN[stage].depth * (variant.shallow ? ATTACK_RUN_SHALLOW_FACTOR : 1);
  const depthY = canvasH * depth;
  const planned = c.formationX < targetX ? -1 : 1; // swing out away from the target first
  const lean = variant.mirror ? -planned : planned;
  return {
    p0: { x: c.x, y: c.y },
    p1: { x: targetX + lean * 70, y: depthY },
    p2: { x: targetX - lean * 70, y: depthY },
    p3: { x: c.formationX, y: c.formationY },
  };
}

/**
 * #3131: the attack-run candidates, in the fixed order they are tried: the planned run, the
 * mirrored lean, then the shallower depth (planned lean, then mirrored). Rng-free.
 */
export function carrierRunCandidates(
  c: Enemy,
  targetX: number,
  canvasH: number,
  stage: Exclude<CarrierStage, "protected">
): CubicBezier[] {
  return [
    carrierRunPath(c, targetX, canvasH, stage),
    carrierRunPath(c, targetX, canvasH, stage, { mirror: true }),
    carrierRunPath(c, targetX, canvasH, stage, { shallow: true }),
    carrierRunPath(c, targetX, canvasH, stage, { mirror: true, shallow: true }),
  ];
}

/**
 * #2485/#2843: the Carrier's own tick (station-keeping or on its attack run). Every cadence is a
 * seeded roll from its stage's range (`rollCarrierCadence`), so nothing is metronomic.
 *
 * - Beam: idle → charge (BEAM_CHARGE_MS telegraph) → release. The release is an independent
 *   CarrierBeam; the Carrier goes straight back to idle.
 * - Twin lasers (exposed / final stand only): a pair of aimed shots per roll.
 * - Attack run (exposed / final stand only): brace (ATTACK_RUN_BRACE_MS telegraph) → run.
 *   #3131: at the commit the run is vetted against on-screen rocks (`carrierRunCandidates`,
 *   first one that does not fly into a rock holding station would miss). With none clear the
 *   Carrier stays braced on station and re-checks each tick; after ATTACK_RUN_HOLD_MAX_MS it
 *   stands down and re-rolls its run timer. The hold is tracked as `runTimer` below zero.
 *
 * Telegraphs never overlap: a charge never starts during a brace, nor a brace during a charge.
 * While exposed the beam also holds during the run; in the final stand beam, direct fire and
 * movement may combine — each keeps its own telegraph.
 *
 * On an escalation (protected → exposed → final stand) timers pull in: an action that just
 * came online rolls fresh, one already running keeps the sooner of its timer and a new roll.
 */
export function tickCarrier(
  enemy: Enemy,
  dtMs: number,
  ctx: CarrierCtx,
  tuning: Tuning = DEFAULT_TUNING
): EnemyTickResult {
  const stage = ctx.stage;
  if (!ctx.playing || !stage) return { enemy, bullet: null };
  const roll = (kind: CarrierCadence) =>
    rollCarrierCadence(kind, stage, ctx.difficulty, ctx.bossWave, tuning);

  let e = enemy;
  const prev = ctx.prevStage;
  if (prev && STAGE_RANK[stage] > STAGE_RANK[prev]) {
    const cameOnline = prev === "protected";
    e = {
      ...e,
      beamTimer: e.beamPhase === "idle" ? Math.min(e.beamTimer, roll("beam")) : e.beamTimer,
      shootTimer: cameOnline ? roll("twin") : Math.min(e.shootTimer, roll("twin")),
      runTimer:
        e.runPhase === "idle" && e.phase !== "AttackRun"
          ? cameOnline
            ? roll("attackRun")
            : Math.min(e.runTimer, roll("attackRun"))
          : e.runTimer,
    };
  }

  const armedStage = stage !== "protected";
  const bracing = e.runPhase === "brace";
  const running = e.phase === "AttackRun";

  // ── Beam ──
  let beamPhase: BeamPhase = e.beamPhase;
  let beamTimer = e.beamTimer;
  let beam: CarrierBeam | undefined;
  if (beamPhase === "charge") {
    beamTimer -= dtMs;
    if (beamTimer <= 0) {
      beam = releaseBeam(e);
      beamPhase = "idle";
      beamTimer = roll("beam");
    }
  } else if (!bracing && !(running && stage !== "finalStand")) {
    beamTimer -= dtMs;
    if (beamTimer <= 0) {
      beamPhase = "charge";
      beamTimer = BEAM_CHARGE_MS;
    }
  }

  // ── Twin lasers ──
  let shootTimer = e.shootTimer;
  let bullets: Bullet[] | undefined;
  if (armedStage) {
    shootTimer -= dtMs;
    if (shootTimer <= 0) {
      shootTimer = roll("twin");
      bullets = carrierTwinVolley(e, chooseCarrierTarget(ctx, peekNextId(), tuning), tuning);
    }
  }

  // ── Attack run ──
  let next: Enemy = { ...e, beamPhase, beamTimer, shootTimer };
  if (running) {
    const newT = e.pathT + dtMs / e.pathDuration;
    if (newT >= 1 || !e.path) {
      next = {
        ...next,
        phase: "Formation",
        x: e.formationX,
        y: e.formationY,
        path: null,
        pathT: 1,
        runTimer: roll("attackRun"),
      };
    } else {
      const pos = evalCubic(e.path, newT);
      next = { ...next, x: pos.x, y: pos.y, pathT: newT };
    }
  } else if (bracing) {
    const runTimer = e.runTimer - dtMs;
    const runStage = stage as "exposed" | "finalStand";
    const start = { ...next, y: e.formationY };
    const path =
      runTimer <= 0 && armedStage
        ? firstClearPath(
            carrierRunCandidates(start, e.diveTargetX, ctx.canvasH, runStage),
            ATTACK_RUN[runStage].ms,
            start,
            ctx.rocks
          )
        : null;
    if (path) {
      next = {
        ...start,
        phase: "AttackRun",
        runPhase: "idle",
        runTimer: 0,
        path,
        pathT: 0,
        pathDuration: ATTACK_RUN[runStage].ms,
      };
    } else if (runTimer <= 0 && armedStage && runTimer <= -ATTACK_RUN_HOLD_MAX_MS) {
      // #3131: no clear run for the whole hold — stand down on station and roll a fresh timer
      next = { ...start, runPhase: "idle", runTimer: roll("attackRun") };
    } else {
      // (#3131: a run blocked by a rock holds here, settled on station, runTimer below zero)
      // rear back: a slow lift and settle, the run's telegraph
      const p = 1 - Math.max(0, runTimer) / ATTACK_RUN_BRACE_MS;
      next = {
        ...next,
        runTimer,
        y: e.formationY - ATTACK_RUN_BRACE_LIFT * Math.sin(Math.PI * p),
      };
    }
  } else if (armedStage) {
    const runTimer = e.runTimer - dtMs;
    // a brace waits for a beam charge to finish, so the two telegraphs never overlap
    if (runTimer <= 0 && beamPhase !== "charge") {
      next = {
        ...next,
        runPhase: "brace",
        runTimer: ATTACK_RUN_BRACE_MS,
        // (sim prototype, off by default: aim the run at Buddy's column when shooting at Buddy)
        diveTargetX: tuning.CARRIER_RUN_AT_BUDDY && ctx.buddy ? ctx.buddy.x : ctx.playerX,
      };
    } else {
      next = { ...next, runTimer };
    }
  }

  return { enemy: next, bullet: null, bullets, beam };
}

/**
 * #2843: the Carrier's beam charge, for both renderers and the beam-start event; null when it
 * isn't charging (released beams are `state.carrierBeams`).
 */
export function carrierBeamCharge(
  state: StarSwarmState
): { x: number; y: number; progress: number } | null {
  const c = state.enemies.find((e) => e.isAlive && e.tier === "Carrier");
  if (!c || c.beamPhase !== "charge") return null;
  return {
    x: c.x,
    y: c.y + c.height / 2,
    progress: 1 - Math.max(0, c.beamTimer) / BEAM_CHARGE_MS,
  };
}

/** #2843: the Carrier's attack-run brace (telegraph) progress 0–1; null when not bracing. */
export function carrierRunBrace(
  state: StarSwarmState
): { x: number; y: number; r: number; progress: number } | null {
  const c = state.enemies.find((e) => e.isAlive && e.tier === "Carrier");
  if (!c || c.runPhase !== "brace") return null;
  return {
    x: c.x,
    y: c.y,
    r: Math.max(c.width, c.height) * 0.7,
    progress: 1 - Math.max(0, c.runTimer) / ATTACK_RUN_BRACE_MS,
  };
}

/** #2485: true on the tick the Carrier starts charging its beam (telegraph sound + a11y). */
export function carrierBeamJustStarted(prev: StarSwarmState, next: StarSwarmState): boolean {
  return carrierBeamCharge(prev) === null && carrierBeamCharge(next) !== null;
}

/** #2843: true on the tick a beam is released (a beam in flight that wasn't there before). */
export function carrierBeamJustFired(prev: StarSwarmState, next: StarSwarmState): boolean {
  if (next.wave !== prev.wave) return false;
  const before = new Set(prev.carrierBeams.map((b) => b.id));
  return next.carrierBeams.some((b) => !before.has(b.id));
}

/** #2843: true on the tick the Carrier braces for an attack run (its telegraph). */
export function carrierAttackRunJustStarted(prev: StarSwarmState, next: StarSwarmState): boolean {
  return carrierRunBrace(prev) === null && carrierRunBrace(next) !== null;
}

/** #2485: true on the tick a reinforcement batch launches (same wave, counter went up). */
export function reinforcementsJustLaunched(prev: StarSwarmState, next: StarSwarmState): boolean {
  return next.wave === prev.wave && next.reinforcedThisWave > prev.reinforcedThisWave;
}
