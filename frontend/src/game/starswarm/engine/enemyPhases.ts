/**
 * Star Swarm engine — the per-ship phase machine (#2988).
 *
 * One enemy's tick: SwoopIn → Formation → Wiggling (the #975 telegraph) → Diving (#977 Bézier
 * arcs) → Circling → Returning, the #2489 rout's Fleeing, and the Carrier's own tick (routed to
 * `carrier.ts`). `makeEnemy` builds a ship in its formation slot. Every function here takes one
 * `Enemy` and returns `EnemyTickResult` — the ship after the tick and anything it fired; the
 * roster-wide logic (dive scheduling, the bullet cap, reinforcements) is `enemies.ts`.
 */
import type { Bullet, DifficultyTier, Enemy } from "../types";
import { NO_CARRIER_CTX, tickCarrier, type CarrierCtx, type EnemyTickResult } from "./carrier";
import {
  aimVelocity,
  aimedBulletVelocity,
  divePath,
  evalCubic,
  fleePath,
  returnPath,
  slotToWorld,
  swoopPath,
  type SlotDef,
} from "./geometry";
import { nextId, rng } from "./rng";
import {
  BULLET_E_H,
  BULLET_E_W,
  BURST_INTERVAL,
  BURST_PAUSE_BASE,
  BURST_PAUSE_JITTER,
  CIRCLE_RADIUS,
  CIRCLE_SPEED,
  DEFAULT_TUNING,
  DIVE_PATH_DURATION,
  DIVE_SHOOT_INTERVAL,
  FLEE_DURATION_MAX,
  FLEE_DURATION_MIN,
  FLEE_ENSIGN_SCALE,
  FLEE_STAGGER_MAX,
  GUARDIAN_BULLET_VY,
  GUARDIAN_DIVE_PATH_DURATION,
  RETURN_DURATION,
  SHOOT_INTERVAL_BASE,
  SHOOT_INTERVAL_JITTER,
  SWOOP_DURATION,
  SWOOP_STAGGER,
  TIER_HP,
  TIER_SIZE,
  WIGGLE_AMPLITUDE,
  WIGGLE_DURATION,
  type Tuning,
} from "./tuning";

// ---------------------------------------------------------------------------
// Enemy factories
// ---------------------------------------------------------------------------

export function makeEnemy(idx: number, slot: SlotDef, canvasW: number): Enemy {
  const { fx, fy } = slotToWorld(slot, canvasW);
  const size = TIER_SIZE[slot.tier];
  const path = swoopPath(idx, fx, fy, canvasW);
  const p0 = evalCubic(path, 0);
  const delay = (idx * SWOOP_STAGGER) / SWOOP_DURATION;

  return {
    id: nextId(),
    tier: slot.tier,
    phase: "SwoopIn",
    x: p0.x,
    y: p0.y,
    width: size.w,
    height: size.h,
    formationX: fx,
    formationY: fy,
    path,
    pathT: -delay, // negative = waiting; advances to 0 before path traversal begins
    pathDuration: SWOOP_DURATION,
    vel: { x: 0, y: 0 },
    circleCx: 0,
    circleCy: 0,
    circleRadius: CIRCLE_RADIUS + rng() * 10,
    circleAngle: 0,
    circleSpeed: CIRCLE_SPEED * (0.85 + rng() * 0.3),
    shootTimer: rng() * (SHOOT_INTERVAL_BASE + SHOOT_INTERVAL_JITTER),
    diveTargetX: 0,
    hp: TIER_HP[slot.tier],
    isAlive: true,
    hitFlashTimer: 0,
    wiggleTimer: 0,
    burstShotsLeft: 0,
    beamPhase: "idle",
    beamTimer: 0, // #2843: the Carrier's is rolled in buildWaveState / on launch; unused otherwise
    runPhase: "idle",
    runTimer: 0, // #2843: rolled when the Carrier is exposed; unused otherwise
    dodge: null,
    rolledAsteroidIds: [],
    flakCooldown: 0,
    evadeMs: 0,
    flinchMs: 0,
    reactedAsteroidIds: [],
    reactedPhase: "SwoopIn",
    attentionMs: 0,
  };
}

// ---------------------------------------------------------------------------
// Per-ship phase ticks
// ---------------------------------------------------------------------------

export function tickSingleEnemy(
  enemy: Enemy,
  dtMs: number,
  playerX: number,
  playerY: number,
  canvasH: number,
  shouldDive: boolean,
  wave: number,
  guardianThresholdCrossed: boolean,
  guardianDeepThresholdCrossed: boolean,
  paramScale = 1,
  carrierCtx: CarrierCtx = NO_CARRIER_CTX,
  tuning: Tuning = DEFAULT_TUNING
): EnemyTickResult {
  if (!enemy.isAlive) return { enemy, bullet: null };
  // #2485/#2843: the Carrier has its own tick, on station and on its attack run
  if (enemy.tier === "Carrier" && (enemy.phase === "Formation" || enemy.phase === "AttackRun")) {
    return tickCarrier(enemy, dtMs, carrierCtx, tuning);
  }

  switch (enemy.phase) {
    case "SwoopIn":
      return tickSwoopIn(enemy, dtMs);
    case "Formation":
      return tickFormation(
        enemy,
        dtMs,
        playerX,
        playerY,
        shouldDive,
        wave,
        guardianThresholdCrossed,
        paramScale
      );
    case "Wiggling":
      return tickWiggling(
        enemy,
        dtMs,
        canvasH,
        guardianThresholdCrossed,
        guardianDeepThresholdCrossed
      );
    case "Diving":
      return tickDiving(
        enemy,
        dtMs,
        canvasH,
        playerX,
        playerY,
        guardianThresholdCrossed,
        guardianDeepThresholdCrossed
      );
    case "Circling":
      return tickCircling(enemy, dtMs, playerX, playerY);
    case "Returning":
      return tickReturning(enemy, dtMs);
    case "Fleeing":
      return tickFleeing(enemy, dtMs);
    case "AttackRun":
      return { enemy, bullet: null }; // #2843: Carrier only, routed above
  }
}

function tickSwoopIn(enemy: Enemy, dtMs: number): EnemyTickResult {
  const newT = enemy.pathT + dtMs / enemy.pathDuration;

  if (newT < 0) {
    // Still waiting (stagger delay)
    return { enemy: { ...enemy, pathT: newT }, bullet: null };
  }

  if (newT >= 1) {
    // Arrived — snap to formation position
    return {
      enemy: {
        ...enemy,
        phase: "Formation",
        x: enemy.formationX,
        y: enemy.formationY,
        pathT: 1,
        path: null,
      },
      bullet: null,
    };
  }

  const pos = evalCubic(enemy.path!, newT);
  return { enemy: { ...enemy, x: pos.x, y: pos.y, pathT: newT }, bullet: null };
}

function tickFormation(
  enemy: Enemy,
  dtMs: number,
  playerX: number,
  playerY: number,
  shouldDive: boolean,
  wave: number,
  guardianThresholdCrossed: boolean,
  paramScale = 1
): EnemyTickResult {
  // #2484/#2485: a Carrier in Formation is routed to tickCarrier before reaching here
  if (enemy.tier === "Carrier") {
    return { enemy, bullet: null };
  }

  // Guardian is passive until threshold crossed: no firing, no diving
  if (enemy.tier === "Guardian" && !guardianThresholdCrossed) {
    return { enemy, bullet: null };
  }

  // #975: transition to Wiggling (not directly to Diving) — gives player a reaction window
  if (shouldDive) {
    return {
      enemy: {
        ...enemy,
        phase: "Wiggling",
        wiggleTimer: WIGGLE_DURATION,
        diveTargetX: playerX,
      },
      bullet: null,
    };
  }

  const shootTimer = enemy.shootTimer - dtMs;
  if (shootTimer > 0) {
    return { enemy: { ...enemy, shootTimer }, bullet: null };
  }

  // #979: Guardian fires in bursts; other tiers use random single-shot interval
  if (enemy.tier === "Guardian") {
    const { enemy: e, bullet } = guardianBurstFire(enemy, playerX, playerY);
    return { enemy: e, bullet };
  }

  // #1314: Elites always fire proportionally-aimed shots; Grunts use wave-scaled probabilistic aim
  const vel =
    enemy.tier === "Elite"
      ? aimVelocity(enemy.x, enemy.y, playerX, playerY)
      : aimedBulletVelocity(enemy.x, enemy.y, playerX, playerY, wave, paramScale);

  const bullet: Bullet = {
    id: nextId(),
    x: enemy.x,
    y: enemy.y + enemy.height / 2,
    vx: vel.vx,
    vy: vel.vy,
    owner: "enemy",
    width: BULLET_E_W,
    height: BULLET_E_H,
    damage: 1,
  };
  return {
    enemy: { ...enemy, shootTimer: SHOOT_INTERVAL_BASE + rng() * SHOOT_INTERVAL_JITTER },
    bullet,
  };
}

// #979: shared burst-fire logic for Guardian in Formation and Diving phases
function guardianBurstFire(enemy: Enemy, playerX: number, playerY: number): EnemyTickResult {
  const newBurstShotsLeft =
    enemy.burstShotsLeft === 0
      ? 2 + Math.floor(rng() * 3) // start new burst: pick 3–5 total shots; return remaining after this shot
      : enemy.burstShotsLeft - 1;
  const newShootTimer =
    newBurstShotsLeft > 0 ? BURST_INTERVAL : BURST_PAUSE_BASE + rng() * BURST_PAUSE_JITTER;

  const vel = aimVelocity(enemy.x, enemy.y, playerX, playerY, GUARDIAN_BULLET_VY); // #1314
  const bullet: Bullet = {
    id: nextId(),
    x: enemy.x,
    y: enemy.y + enemy.height / 2,
    vx: vel.vx,
    vy: vel.vy,
    owner: "enemy",
    width: BULLET_E_W,
    height: BULLET_E_H,
    damage: 1,
  };
  return {
    enemy: { ...enemy, shootTimer: newShootTimer, burstShotsLeft: newBurstShotsLeft },
    bullet,
  };
}

// #975: oscillate ±WIGGLE_AMPLITUDE px for WIGGLE_DURATION ms, then launch Bézier dive
function tickWiggling(
  enemy: Enemy,
  dtMs: number,
  canvasH: number,
  guardianThresholdCrossed: boolean,
  guardianDeepThresholdCrossed: boolean
): EnemyTickResult {
  const newTimer = enemy.wiggleTimer - dtMs;

  if (newTimer <= 0) {
    // Stage 1 Elites: shallow arc; Stage 2 Guardians: shallow arc (like Stage 1 Elites)
    const isGuardianStage2 =
      enemy.tier === "Guardian" && guardianThresholdCrossed && !guardianDeepThresholdCrossed;
    const shallow = (enemy.tier === "Elite" && !guardianThresholdCrossed) || isGuardianStage2;
    const path = divePath(enemy, enemy.diveTargetX, canvasH, shallow);
    const duration = enemy.tier === "Guardian" ? GUARDIAN_DIVE_PATH_DURATION : DIVE_PATH_DURATION;
    return {
      enemy: {
        ...enemy,
        phase: "Diving",
        wiggleTimer: 0,
        path,
        pathT: 0,
        pathDuration: duration,
        vel: { x: 0, y: 0 },
        burstShotsLeft: 0,
        shootTimer: 0,
      },
      bullet: null,
    };
  }

  const elapsed = WIGGLE_DURATION - newTimer;
  const wiggleOffset = Math.sin((4 * Math.PI * elapsed) / WIGGLE_DURATION) * WIGGLE_AMPLITUDE;
  return {
    enemy: { ...enemy, x: enemy.formationX + wiggleOffset, wiggleTimer: newTimer },
    bullet: null,
  };
}

// #977/#1029/#1030: Bézier arc dive
// - Grunts: skip Circling; go directly to Returning at 85%
// - Elites Phase 1 (guardianThresholdCrossed=false): shallow arc, Returning at 60%, no body collision
// - Elites Phase 2 + Guardians: Circling at 85% (existing behaviour)
function tickDiving(
  enemy: Enemy,
  dtMs: number,
  canvasH: number,
  playerX: number,
  playerY: number,
  guardianThresholdCrossed: boolean,
  guardianDeepThresholdCrossed: boolean
): EnemyTickResult {
  const newT = enemy.pathT + dtMs / enemy.pathDuration;
  const pos = evalCubic(enemy.path!, Math.min(newT, 1));

  // Tick shoot timer; Guardian uses burst fire (#979), others use single aimed shot
  const shootTimer = enemy.shootTimer - dtMs;
  let bullet: Bullet | null = null;
  let nextShootTimer = shootTimer;
  let nextBurstShotsLeft = enemy.burstShotsLeft;

  if (shootTimer <= 0) {
    if (enemy.tier === "Guardian") {
      const result = guardianBurstFire(enemy, playerX, playerY);
      bullet = result.bullet;
      nextShootTimer = result.enemy.shootTimer;
      nextBurstShotsLeft = result.enemy.burstShotsLeft;
    } else {
      const vel = aimVelocity(enemy.x, enemy.y, playerX, playerY); // #1314
      bullet = {
        id: nextId(),
        x: enemy.x,
        y: enemy.y + enemy.height / 2,
        vx: vel.vx,
        vy: vel.vy,
        owner: "enemy",
        width: BULLET_E_W,
        height: BULLET_E_H,
        damage: 1,
      };
      nextShootTimer = DIVE_SHOOT_INTERVAL;
    }
  }

  const isElitePhase1 = enemy.tier === "Elite" && !guardianThresholdCrossed;
  // #1077: Stage 2 Guardian uses shallow arc — return to formation like Elite Phase 1, no Circling
  const isGuardianStage2 =
    enemy.tier === "Guardian" && guardianThresholdCrossed && !guardianDeepThresholdCrossed;
  const depthThreshold = isElitePhase1 || isGuardianStage2 ? canvasH * 0.6 : canvasH * 0.85;
  const pathDone = pos.y > depthThreshold || newT >= 1;

  if (pathDone) {
    if (enemy.tier === "Grunt" || isElitePhase1 || isGuardianStage2) {
      // No circling: return directly to formation
      const path = returnPath(pos.x, pos.y, enemy.formationX, enemy.formationY);
      return {
        enemy: {
          ...enemy,
          phase: "Returning",
          x: pos.x,
          y: pos.y,
          pathT: 0,
          path,
          pathDuration: RETURN_DURATION,
          shootTimer: nextShootTimer,
          burstShotsLeft: nextBurstShotsLeft,
        },
        bullet,
      };
    }

    // Elite Phase 2 + Guardian → Circling
    return {
      enemy: {
        ...enemy,
        phase: "Circling",
        x: pos.x,
        y: pos.y,
        pathT: Math.min(newT, 1),
        circleCx: pos.x,
        circleCy: pos.y,
        circleAngle: Math.PI / 2,
        vel: { x: 0, y: 0 },
        shootTimer: nextShootTimer,
        burstShotsLeft: nextBurstShotsLeft,
      },
      bullet,
    };
  }

  return {
    enemy: {
      ...enemy,
      x: pos.x,
      y: pos.y,
      pathT: newT,
      vel: { x: 0, y: 0 },
      shootTimer: nextShootTimer,
      burstShotsLeft: nextBurstShotsLeft,
    },
    bullet,
  };
}

function tickCircling(
  enemy: Enemy,
  dtMs: number,
  playerX: number,
  playerY: number
): EnemyTickResult {
  const newAngle = enemy.circleAngle + enemy.circleSpeed * dtMs;
  const newX = enemy.circleCx + Math.cos(newAngle) * enemy.circleRadius;
  const newY = enemy.circleCy + Math.sin(newAngle) * enemy.circleRadius;

  // #944/#1314: tick shoot timer and fire proportionally-aimed bullet if ready
  const shootTimer = enemy.shootTimer - dtMs;
  let bullet: Bullet | null = null;
  if (shootTimer <= 0) {
    const speed = enemy.tier === "Guardian" ? GUARDIAN_BULLET_VY : undefined;
    const vel = aimVelocity(enemy.x, enemy.y, playerX, playerY, speed);
    bullet = {
      id: nextId(),
      x: enemy.x,
      y: enemy.y + enemy.height / 2,
      vx: vel.vx,
      vy: vel.vy,
      owner: "enemy",
      width: BULLET_E_W,
      height: BULLET_E_H,
      damage: 1,
    };
  }
  const nextShootTimer = shootTimer <= 0 ? DIVE_SHOOT_INTERVAL : shootTimer;

  // After ~1 full revolution (2π rad), start returning
  if (newAngle - Math.PI / 2 >= Math.PI * 2) {
    const path = returnPath(newX, newY, enemy.formationX, enemy.formationY);
    return {
      enemy: {
        ...enemy,
        phase: "Returning",
        x: newX,
        y: newY,
        circleAngle: newAngle,
        path,
        pathT: 0,
        pathDuration: RETURN_DURATION,
        shootTimer: nextShootTimer,
      },
      bullet,
    };
  }

  return {
    enemy: { ...enemy, x: newX, y: newY, circleAngle: newAngle, shootTimer: nextShootTimer },
    bullet,
  };
}

function tickReturning(enemy: Enemy, dtMs: number): EnemyTickResult {
  const newT = enemy.pathT + dtMs / enemy.pathDuration;

  if (newT >= 1) {
    return {
      enemy: {
        ...enemy,
        phase: "Formation",
        x: enemy.formationX,
        y: enemy.formationY,
        pathT: 1,
        path: null,
        shootTimer: SHOOT_INTERVAL_BASE + rng() * SHOOT_INTERVAL_JITTER,
      },
      bullet: null,
    };
  }

  const pos = evalCubic(enemy.path!, newT);
  return { enemy: { ...enemy, x: pos.x, y: pos.y, pathT: newT }, bullet: null };
}

/** #2489: a grunt breaking for the top edge. It never shoots; reaching the end of the path is an
 * escape — the ship is removed with no score (tickEnemies counts it as routEscaped). */
function tickFleeing(enemy: Enemy, dtMs: number): EnemyTickResult {
  const newT = enemy.pathT + dtMs / enemy.pathDuration;
  if (newT < 0) {
    // Hesitating before it bolts — still where it was, still shootable
    return { enemy: { ...enemy, pathT: newT }, bullet: null };
  }
  if (newT >= 1) {
    return { enemy: { ...enemy, isAlive: false, hp: 0, pathT: 1, hitFlashTimer: 0 }, bullet: null };
  }
  const pos = evalCubic(enemy.path!, newT);
  return { enemy: { ...enemy, x: pos.x, y: pos.y, pathT: newT }, bullet: null };
}

/** #2489: put a grunt on its flee path from wherever it is — any phase but SwoopIn. */
export function startFleeing(e: Enemy, canvasW: number, difficulty: DifficultyTier): Enemy {
  const scale = difficulty === "Ensign" ? FLEE_ENSIGN_SCALE : 1;
  const duration = (FLEE_DURATION_MIN + rng() * (FLEE_DURATION_MAX - FLEE_DURATION_MIN)) * scale;
  const stagger = rng() * FLEE_STAGGER_MAX;
  return {
    ...e,
    phase: "Fleeing",
    path: fleePath(e.x, e.y, canvasW),
    pathT: -stagger / duration,
    pathDuration: duration,
    dodge: null,
    wiggleTimer: 0,
    burstShotsLeft: 0,
  };
}
