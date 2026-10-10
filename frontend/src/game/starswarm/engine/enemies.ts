/**
 * Star Swarm engine — the enemy fleet (#2988).
 *
 * `tickEnemies` drives the per-ship phase machine (`enemyPhases.ts`) for the whole roster: the
 * threshold latches, the #2489 rout, dive scheduling, formation sway, the Carrier context, shots
 * diverted to Buddy (#2845), the bullet cap, reinforcements (#2843) and the straggler rule
 * (#1031). The Carrier is read as `roster[carrierIdx]` from the tick's context (#2963), and the
 * enemy-bullet list, the beam list and the tier stats are copied only when something fires.
 */
import type {
  Asteroid,
  Bullet,
  CarrierBeam,
  CarrierStage,
  Enemy,
  EnemyTier,
  Explosion,
  RunStats,
  StarSwarmState,
  TierStats,
} from "../types";
import { degradeAim, dodgeOffset, onScreenRocks } from "./asteroids";
import { aimAtBuddy, buddyDivertRoll, buddyTargetFor } from "./buddy";
import {
  carrierFlakRock,
  rollCarrierCadence,
  type CarrierCtx,
  type EnemyTickResult,
} from "./carrier";
import { makeEnemy, startFleeing, tickSingleEnemy } from "./enemyPhases";
import { spawnExplosion } from "./entities";
import { weaponsFree } from "./extraction";
import { aimVelocity, slotToWorld, waveSlots, type SlotDef } from "./geometry";
import { rng } from "./rng";
import { STAGE_RANK, carrierStageIn, carrierStageOf, mapKeep, type TickCtx } from "./roster";
import { bumpRun } from "./stats";
import {
  BEAM_CHARGE_MS,
  BEAM_WIGGLE_AMPLITUDE,
  CARRIER_MAX_SWAY,
  DEFAULT_TUNING,
  GUARDIAN_BULLET_VY,
  GUARDIAN_DIVE_THRESHOLD,
  GUARDIAN_MAX_SWAY,
  MAX_SWAY,
  REINFORCE_COUNT,
  SHOOT_INTERVAL_BASE,
  SWAY_SPEED_BASE,
  SWOOP_DURATION,
  WIGGLE_DURATION,
  bulletCap,
  diveInterval,
  isBossWave,
  maxDivers,
  type Tuning,
} from "./tuning";

// ---------------------------------------------------------------------------
// Enemies
// ---------------------------------------------------------------------------

// #979/#2484: heavier tiers drift less with the formation sway
export function clampSway(tier: EnemyTier, swayX: number): number {
  const limit =
    tier === "Carrier" ? CARRIER_MAX_SWAY : tier === "Guardian" ? GUARDIAN_MAX_SWAY : MAX_SWAY;
  return Math.max(-limit, Math.min(limit, swayX));
}

/**
 * #2491 dev-panel hook: destroy every escort at once so the Carrier's final stand, twin fire
 * and plating drop can be reached without playing the wave out. No points — it's a tool, not a
 * bomb — and the escalation latches are left to the next tick to work out as usual.
 */
export function killEscorts(state: StarSwarmState): StarSwarmState {
  if (state.phase !== "Playing") return state;
  const explosions: Explosion[] = [...state.explosions];
  const enemies = state.enemies.map((e) => {
    if (!e.isAlive || e.tier === "Carrier") return e;
    explosions.push(spawnExplosion(e.x, e.y));
    return { ...e, hp: 0, isAlive: false, hitFlashTimer: 0 };
  });
  return { ...state, enemies, explosions };
}

/** #2489: true on the tick the wave's grunts break and run. */
export function routJustStarted(prev: StarSwarmState, next: StarSwarmState): boolean {
  return next.wave === prev.wave && next.routed && !prev.routed;
}

/** #2489: live grunts currently fleeing — the banner shows while this is > 0. */
export function fleeingCount(state: StarSwarmState): number {
  return state.enemies.filter((e) => e.isAlive && e.phase === "Fleeing").length;
}

/**
 * #2843: the wave's original Grunt slots — the only slots reinforcements may refill, and the
 * ceiling on how many Grunts can be alive at once. None on a boss wave.
 */
function originalGruntSlots(wave: number, bossWave = isBossWave(wave)): readonly SlotDef[] {
  if (bossWave) return NO_SLOTS;
  // #2963: the tick asks every frame — build each wave's list once (it depends on `wave` alone)
  let slots = GRUNT_SLOTS.get(wave);
  if (!slots) {
    slots = waveSlots(wave).filter((s) => s.tier === "Grunt");
    GRUNT_SLOTS.set(wave, slots);
  }
  return slots;
}
const NO_SLOTS: readonly SlotDef[] = [];
const GRUNT_SLOTS = new Map<number, readonly SlotDef[]>();

/** #2843: the wave's original simultaneous Grunt population (0 on a boss wave). */
export function originalGruntCount(wave: number): number {
  return originalGruntSlots(wave).length;
}

/** #2485: reinforcements per wave are capped at half the wave's original grunt slots. */
export function reinforceCap(wave: number): number {
  return Math.floor(originalGruntCount(wave) / 2);
}

/**
 * #926 dive scheduler: when the dive timer fires, pick up to `maxDivers(wave)` new divers from
 * the formation (Guardians only once `guardianThresholdCrossed`) on the seeded rng, adding their
 * roster indices to `diveIndices`. Returns the dive timer; it only runs in combat.
 */
export function scheduleDives(
  state: StarSwarmState,
  roster: readonly Enemy[],
  ctx: TickCtx,
  guardianThresholdCrossed: boolean,
  dtMs: number,
  diveIndices: Set<number>
): number {
  let nextDiveTimer = state.nextDiveTimer;
  if (state.phase !== "Playing") return nextDiveTimer;
  nextDiveTimer -= dtMs;
  if (nextDiveTimer <= 0) {
    nextDiveTimer = diveInterval(state.wave, ctx.paramScale);
    // #978/#1030: Guardian only eligible once guardianThresholdCrossed
    const candidates = roster
      .map((e, i) => ({ e, i }))
      .filter(
        ({ e }) =>
          e.isAlive &&
          e.phase === "Formation" &&
          e.tier !== "Carrier" && // #2484: never dives
          (e.tier !== "Guardian" || guardianThresholdCrossed)
      );
    // Only launch enough new divers to reach the cap; Wiggling enemies are NOT counted (#975)
    const currentDivers = roster.filter((e) => e.isAlive && e.phase === "Diving").length;
    const allowedNew = Math.max(0, maxDivers(state.wave) - currentDivers);
    for (let k = 0; k < allowedNew && candidates.length > 0; k++) {
      const pick = Math.floor(rng() * candidates.length);
      diveIndices.add(candidates[pick]!.i);
      candidates.splice(pick, 1);
    }
  }
  return nextDiveTimer;
}

/** #923 formation sway: advance the offset at the difficulty-scaled speed, bouncing at ±MAX_SWAY. */
export function advanceSway(
  state: StarSwarmState,
  paramScale: number,
  dtMs: number
): { swayX: number; swayDir: 1 | -1 } {
  const swaySpeed = SWAY_SPEED_BASE * paramScale;
  let swayX = state.formationSwayX + state.formationSwayDir * swaySpeed * dtMs;
  let swayDir = state.formationSwayDir;
  if (swayX >= MAX_SWAY) {
    swayX = MAX_SWAY;
    swayDir = -1;
  } else if (swayX <= -MAX_SWAY) {
    swayX = -MAX_SWAY;
    swayDir = 1;
  }
  return { swayX, swayDir };
}

/** #3131: the rocks a commit-time path check looks at — live and already on screen. */
function liveOnScreenRocks(state: StarSwarmState): readonly Asteroid[] {
  return state.asteroids.length === 0
    ? state.asteroids
    : onScreenRocks(state.asteroids, state.canvasW, state.canvasH);
}

/**
 * #2485/#2843: what the Carrier's tick needs to know this tick — its stage as of the tick's
 * starting roster, the player's position, a rock it would answer with flak (#2844, exposed
 * only) and the Buddy it may divert a volley to (#2845, while the pressure cap has room for the
 * pair). `carrierNow` is the first alive Carrier (`roster[ctx.alive.carrierIdx]`), if any.
 */
export function buildCarrierCtx(
  state: StarSwarmState,
  ctx: TickCtx,
  stage: CarrierStage | null,
  carrierNow: Enemy | undefined,
  buddyIncoming: number,
  tuning: Tuning
): CarrierCtx {
  const carrierCtx: { -readonly [K in keyof CarrierCtx]: CarrierCtx[K] } = {
    playing: state.phase === "Playing",
    stage,
    prevStage: state.carrierStage,
    bossWave: ctx.bossWave, // #2490
    difficulty: state.difficulty,
    playerX: state.player.x,
    playerY: state.player.y,
    canvasH: state.canvasH,
    flakRock: null, // set below once the Carrier's position is known
    buddy: null,
    rocks: liveOnScreenRocks(state), // #3131: the attack run is vetted against these at commit
  };
  if (carrierNow && stage && stage !== "protected" && !state.flakDisabled) {
    // #2844: an exposed Carrier diverts its twin volley to an approaching rock (never while armored)
    carrierCtx.flakRock = carrierFlakRock(carrierNow, state.asteroids, ctx.armored);
  }
  if (carrierNow && buddyIncoming + 2 <= tuning.BUDDY_MAX_INCOMING) {
    carrierCtx.buddy = buddyTargetFor(carrierNow, state.buddyShips, ctx.armored, state.canvasW);
  }
  return carrierCtx;
}

/**
 * #2845: this ship's fire decision — the shot it was about to fire at the player may go to Buddy
 * instead (the Carrier decided inside chooseCarrierTarget). Rng-free (a hash of the bullet id),
 * so Buddy's presence never perturbs the seeded stream. Every diversion REPLACES a shot that was
 * about to go at the player (same ship, same timer, same bullet) — no ship gains a gun or any
 * cadence because Buddy is here. Returns `b` itself when the shot keeps its target.
 */
export function divertShotToBuddy(
  b: Bullet,
  enemy: Enemy,
  state: StarSwarmState,
  buddyIncoming: number,
  tuning: Tuning
): Bullet {
  if (!b.flak && b.target !== "buddy" && enemy.tier !== "Carrier") {
    const buddy =
      buddyIncoming < tuning.BUDDY_MAX_INCOMING
        ? buddyTargetFor(enemy, state.buddyShips, false, state.canvasW)
        : null;
    if (buddy && buddyDivertRoll(b.id) < tuning.BUDDY_TARGETING[enemy.tier].divert) {
      return { ...b, ...aimAtBuddy(b.x, b.y, buddy, enemy.tier, b.id, tuning), target: "buddy" };
    }
  } else if (b.target === "buddy" && buddyIncoming >= tuning.BUDDY_MAX_INCOMING) {
    // the Carrier chose Buddy on the tick's opening count, but ships ahead of it in the roster
    // have since filled the pressure cap — that volley goes back to the player
    const vel = aimVelocity(b.x, enemy.y, state.player.x, state.player.y, GUARDIAN_BULLET_VY);
    return { ...b, vx: vel.vx, vy: vel.vy, target: undefined };
  }
  return b;
}

/** What `launchReinforcements` hands back: the roster (with any launches appended) and the counters. */
interface ReinforceResult {
  enemies: readonly Enemy[];
  reinforceTimer: number;
  reinforcedThisWave: number;
  runStats: RunStats;
}

/**
 * #2485/#2843: Carrier reinforcements — on a seeded, stage-ranged interval, refill vacant
 * *original* grunt slots only, so the live grunt count never exceeds the wave's original
 * grunt population; also capped per wave (reinforceCap). A wave with no original grunts (a
 * boss wave) gets none, and neither does a Carrier in its final stand, nor Ensign.
 * Reinforcements don't touch startingNonLeaderCount, so the 35% / ≤3 latches are unaffected
 * once crossed; until then they delay the escalation, which is the point.
 */
export function launchReinforcements(
  state: StarSwarmState,
  enemies: readonly Enemy[],
  stage: CarrierStage | null,
  ctx: TickCtx,
  dtMs: number,
  tuning: Tuning
): ReinforceResult {
  let reinforceTimer = state.reinforceTimer;
  let reinforcedThisWave = state.reinforcedThisWave;
  let runStats = state.runStats;
  const gruntSlots = originalGruntSlots(state.wave, ctx.bossWave);
  const launchRange = stage ? REINFORCE_COUNT[stage] : undefined;
  if (
    state.phase === "Playing" &&
    stage !== null &&
    launchRange !== undefined &&
    state.difficulty !== "Ensign" &&
    gruntSlots.length > 0
  ) {
    // #2843: an escalation pulls a pending launch into the new stage's range, like the
    // Carrier's other timers (the sooner of what was pending and a fresh seeded roll)
    const prevStage = state.carrierStage;
    if (prevStage && STAGE_RANK[stage] > STAGE_RANK[prevStage]) {
      reinforceTimer = Math.min(
        reinforceTimer,
        rollCarrierCadence("reinforce", stage, state.difficulty, ctx.bossWave, tuning)
      );
    }
    reinforceTimer -= dtMs;
    if (reinforceTimer <= 0) {
      reinforceTimer = rollCarrierCadence(
        "reinforce",
        stage,
        state.difficulty,
        ctx.bossWave,
        tuning
      );
      const live = enemies.filter((e) => e.isAlive);
      let liveGrunts = 0;
      for (const e of live) if (e.tier === "Grunt") liveGrunts++;
      // #2963: a slot is taken when a live ship holds exactly its (fx, fy) — compared as numbers
      // (the same equality the old "fx,fy" string keys gave), with no key strings or Set built
      const empty = gruntSlots.filter((slot) => {
        const { fx, fy } = slotToWorld(slot, state.canvasW);
        return !live.some((e) => e.formationX === fx && e.formationY === fy);
      });
      const n = Math.min(
        empty.length,
        launchRange.min + Math.floor(rng() * (launchRange.max - launchRange.min + 1)),
        reinforceCap(state.wave) - reinforcedThisWave,
        gruntSlots.length - liveGrunts // the population ceiling
      );
      const launched: Enemy[] = [];
      for (let i = 0; i < n; i++) {
        const slot = empty.splice(Math.floor(rng() * empty.length), 1)[0]!;
        const g = makeEnemy(i, slot, state.canvasW);
        launched.push({ ...g, pathT: -(i * 200) / SWOOP_DURATION });
      }
      if (launched.length > 0) {
        enemies = [...enemies, ...launched];
        reinforcedThisWave += launched.length;
        runStats = bumpRun(runStats, { reinforced: launched.length }); // #2491
      }
    }
  }
  return { enemies, reinforceTimer, reinforcedThisWave, runStats };
}

/**
 * #1031 straggler aggression — when ≤3 enemies survive in a Playing wave, all Formation enemies
 * immediately start wiggling. #1039: pauseStraggler dev-panel toggle suppresses this. #2489: a
 * routed survivor set is fleeing, not fighting — the rule stands down.
 */
export function applyStragglerRule(
  state: StarSwarmState,
  enemies: readonly Enemy[],
  routed: boolean
): readonly Enemy[] {
  if (!state.stragglerEnabled || state.pauseStraggler || state.phase !== "Playing" || routed) {
    return enemies;
  }
  const aliveCount = enemies.filter((e) => e.isAlive && e.tier !== "Carrier").length; // #2484
  if (aliveCount === 0 || aliveCount > 3) return enemies;
  return enemies.map((e) => {
    if (!e.isAlive || e.phase !== "Formation" || e.tier === "Carrier") return e;
    return {
      ...e,
      phase: "Wiggling" as const,
      wiggleTimer: WIGGLE_DURATION,
      diveTargetX: state.player.x,
      shootTimer: Math.min(e.shootTimer, SHOOT_INTERVAL_BASE / 2),
    };
  });
}

/**
 * The fleet's fire for one tick: the enemy-bullet list, the beam list and the tier stats are
 * copied on the first shot, release or flak bump (#2963), so a tick that fires nothing keeps
 * the same objects; the counts gate the bullet cap (#972, flak outside it: #2487) and Buddy's
 * pressure cap (#2845).
 */
interface FireWork {
  enemyBullets: Bullet[] | null;
  carrierBeams: CarrierBeam[] | null;
  tierStats: Record<EnemyTier, TierStats> | null;
  /** Shots in flight that count against the cap (flak does not). */
  live: number;
  readonly cap: number;
  readonly weaponsFree: boolean;
  /** Enemy shots in flight at Buddy (the pressure cap, BUDDY_MAX_INCOMING). */
  buddyIncoming: number;
  buddyShotsDrawn: number;
}

function openFireWork(state: StarSwarmState, weaponsFree: boolean, cap: number): FireWork {
  let live = 0;
  let buddyIncoming = 0;
  for (const b of state.enemyBullets) {
    if (!b.flak) live++;
    if (b.target === "buddy") buddyIncoming++;
  }
  return {
    enemyBullets: null,
    carrierBeams: null,
    tierStats: null,
    live,
    cap,
    weaponsFree,
    buddyIncoming,
    buddyShotsDrawn: 0,
  };
}

/**
 * Where a ship ends the tick: a ship holding formation sits at its slot plus the sway (heavier
 * tiers drift less, #979/#2484) plus any sidestep (#2487); a charging Carrier shudders (#2485);
 * a sidestep carries through the pre-dive wiggle; the hit flash decays (#976).
 */
function settleShip(e0: Enemy, swayX: number, dtMs: number): Enemy {
  let e = e0;
  if (!e.isAlive) return e;
  if (e.phase === "Formation") {
    e = { ...e, x: e.formationX + clampSway(e.tier, swayX) + dodgeOffset(e) }; // #2487 sidestep
  }
  if ((e.phase === "Formation" || e.phase === "AttackRun") && e.beamPhase === "charge") {
    // #2485: beam telegraph — a quick shudder so the player has time to sidestep (#2843: on
    // station or mid-run in the final stand)
    const elapsed = BEAM_CHARGE_MS - e.beamTimer;
    e = {
      ...e,
      x: e.x + Math.sin((6 * Math.PI * elapsed) / BEAM_CHARGE_MS) * BEAM_WIGGLE_AMPLITUDE,
    };
  }
  // #2487: a sidestep also carries through the pre-dive wiggle (which recomputes x each tick)
  if (e.phase === "Wiggling" && e.dodge) {
    e = { ...e, x: e.x + dodgeOffset(e) };
  }
  // Decrement hit-flash timer (#976)
  if (e.hitFlashTimer > 0) {
    e = { ...e, hitFlashTimer: Math.max(0, e.hitFlashTimer - dtMs) };
  }
  return e;
}

/**
 * Sim prototype (off in the shipped game, `CARRIER_TRACK_BUDDY_SPEED` = 0): the exposed Carrier
 * slides its station toward an on-station Buddy at `speed` px/ms, and back to centre once Buddy
 * is gone, so its beam lane and twin fire follow Buddy instead of sitting still.
 */
function trackBuddy(e: Enemy, state: StarSwarmState, dtMs: number, speed: number): Enemy {
  if (state.phase !== "Playing") return e;
  const tb = state.buddyShips.find((bb) => bb.hp > 0 && bb.phase === "OnStation");
  const aim = Math.max(60, Math.min(state.canvasW - 60, tb ? tb.x : state.canvasW / 2));
  const step = Math.max(-speed * dtMs, Math.min(speed * dtMs, aim - e.formationX));
  return { ...e, formationX: e.formationX + step };
}

/**
 * What one ship fired this tick, into the fleet's fire: each shot may be diverted to Buddy
 * (#2845), is degraded while the ship evades a rock (#2844), and then either lands outside the
 * cap (flak) or inside it — and only while weapons are free (#2842). A released beam is its own
 * entity from here on (#2843).
 */
function fireShipShots(
  result: EnemyTickResult,
  enemy: Enemy,
  state: StarSwarmState,
  fw: FireWork,
  tuning: Tuning
): void {
  // #2844: a ship that is evading a rock shoots worse — player-directed shots only (flak is
  // already aimed at the rock)
  const evading = enemy.evadeMs > 0;
  const volley = result.bullets;
  const shots = volley ? volley.length : 0;
  // #2963: result.bullet, then result.bullets, without building a list of them
  for (let bi = -1; bi < shots; bi++) {
    const raw = bi < 0 ? result.bullet : volley![bi]!;
    if (!raw) continue;
    let b = divertShotToBuddy(raw, enemy, state, fw.buddyIncoming, tuning); // #2845
    if (evading && !b.flak) {
      // #2844 evasion degrades player-directed aim only. A shot at Buddy keeps its
      // BUDDY_TARGETING aim, but the rng draws are still taken so the seeded stream is the same
      // whichever target the shot went to (the same-seed counterfactual relies on it).
      const degraded = degradeAim(b.vx, b.vy, enemy.tier, rng);
      if (b.target !== "buddy") b = { ...b, ...degraded };
    }
    if (b.flak) {
      // #2844: flak is outside the cap — its price was paid in the ship's fire timer. Only the
      // Carrier's diverted volley reaches here (a volley that replaced a player-directed one).
      if (fw.weaponsFree) {
        (fw.enemyBullets ??= [...state.enemyBullets]).push(b);
        const stats = (fw.tierStats ??= { ...state.tierStats });
        stats[enemy.tier] = { ...stats[enemy.tier], flak: stats[enemy.tier].flak + 1 };
      }
    } else if (fw.live < fw.cap && fw.weaponsFree) {
      (fw.enemyBullets ??= [...state.enemyBullets]).push(b);
      fw.live++;
      if (b.target === "buddy") {
        fw.buddyIncoming++;
        fw.buddyShotsDrawn++;
      }
    }
  }
  // #2843: a released beam is its own entity from here on
  if (result.beam && fw.weaponsFree) {
    (fw.carrierBeams ??= [...state.carrierBeams]).push(result.beam);
  }
}

/**
 * The fleet's tick: the threshold latches and the rout are decided on the tick's starting
 * roster (`ctx`, #2963), then every ship is ticked once (`tickSingleEnemy`), its fire filtered
 * through the Buddy diversion, the bullet cap and the combat gate, before reinforcements, the
 * straggler rule and the attention floor. Copy-on-write throughout: the enemy-bullet list, the
 * beam list and the tier stats are copied only when something actually fires.
 */
export function tickEnemies(
  state: StarSwarmState,
  dtMs: number,
  ctx: TickCtx,
  tuning: Tuning = DEFAULT_TUNING
): StarSwarmState {
  // #2963: the opening checks read the tick's starting roster from ctx — tickAsteroidThreats,
  // the only sub-tick since, changes no ship's isAlive, tier or phase
  // #1030: guardianThresholdCrossed latches true once ≤35% non-leader enemies remain
  const aliveNonLeader = ctx.alive.nonLeader;
  const guardianThresholdCrossed =
    state.guardianThresholdCrossed ||
    state.startingNonLeaderCount === 0 ||
    aliveNonLeader / state.startingNonLeaderCount <= GUARDIAN_DIVE_THRESHOLD;

  // #1077: guardianDeepThresholdCrossed latches true at Stage 3 (≤3 enemies alive)
  // #2484: the Carrier never leaves formation, so it is not counted as a straggler
  const aliveAll = ctx.alive.nonCarrier;
  const guardianDeepThresholdCrossed =
    state.guardianDeepThresholdCrossed ||
    (state.stragglerEnabled &&
      !state.pauseStraggler &&
      state.phase === "Playing" &&
      aliveAll > 0 &&
      aliveAll <= 3);

  // #2489: grunt rout — the moment nothing but grunts is left alive (Elites count as leaders here,
  // unlike isLeaderTier), every surviving grunt breaks for the top edge. Decided on the tick's
  // starting roster, before anything shoots or dives, so the trigger tick fires no last volley.
  // Latched for the wave, and re-applied every tick so a reinforcement still swooping in when it
  // happens runs too, the moment it lands.
  let routed = state.routed;
  if (
    !routed &&
    !state.routDisabled &&
    state.phase === "Playing" &&
    ctx.alive.grunts > 0 &&
    ctx.alive.nonGrunts === 0
  ) {
    routed = true;
  }
  const roster = routed
    ? state.enemies.map((e) =>
        e.isAlive && e.tier === "Grunt" && e.phase !== "SwoopIn" && e.phase !== "Fleeing"
          ? startFleeing(e, state.canvasW, state.difficulty)
          : e
      )
    : state.enemies;

  // #926 Dive AI: pick up to maxDivers(wave) formation enemies to send diving
  const diveIndices = new Set<number>();
  const nextDiveTimer = scheduleDives(
    state,
    roster,
    ctx,
    guardianThresholdCrossed,
    dtMs,
    diveIndices
  );

  // #923 Formation sway: advance offset, bounce at ±MAX_SWAY
  const _ps = ctx.paramScale;
  const { swayX, swayDir } = advanceSway(state, _ps, dtMs);

  // #2842: ships that reach formation during swoop-in hold their fire until combat starts
  const enemyWeaponsFree = weaponsFree(state) && !state.enemyFireDisabled;
  // #2843: the Carrier acts on its stage as of the tick's starting roster; an escalation since
  // the stage it last acted on (state.carrierStage) pulls its timers in (see tickCarrier)
  // (#2963: a rout only sets grunts fleeing, and a routed wave has no Carrier — ctx's stage
  // is the roster's whenever the roster is the tick's own; recomputed otherwise all the same)
  const stage = roster === state.enemies ? carrierStageOf(ctx) : carrierStageIn(roster);
  // #2963: the first alive Carrier — a rout maps grunts only, so its index is the roster's too
  const carrierNow = ctx.alive.carrierIdx >= 0 ? roster[ctx.alive.carrierIdx] : undefined;
  const fw = openFireWork(state, enemyWeaponsFree, bulletCap(state.wave, _ps));
  const carrierCtx = buildCarrierCtx(state, ctx, stage, carrierNow, fw.buddyIncoming, tuning);
  // (sim prototype, off by default: the exposed Carrier slides its station toward Buddy)
  const tracking = tuning.CARRIER_TRACK_BUDDY_SPEED > 0 && stage !== null && stage !== "protected";
  let routEscaped = 0; // #2489: fleeing grunts that reached the edge this tick
  let enemies: readonly Enemy[] = roster.map((enemy, idx) => {
    const result = tickSingleEnemy(
      enemy,
      dtMs,
      state.player.x,
      state.player.y,
      state.canvasH,
      diveIndices.has(idx),
      state.wave,
      guardianThresholdCrossed,
      guardianDeepThresholdCrossed,
      _ps,
      carrierCtx,
      tuning,
      carrierCtx.rocks // #3131: Elite/Guardian dives are vetted against the same on-screen rocks
    );
    let e = result.enemy;
    if (enemy.isAlive && enemy.phase === "Fleeing" && !e.isAlive) routEscaped++; // #2489
    if (tracking && e.isAlive && e.tier === "Carrier" && e.phase === "Formation") {
      e = trackBuddy(e, state, dtMs, tuning.CARRIER_TRACK_BUDDY_SPEED);
    }
    e = settleShip(e, swayX, dtMs);
    fireShipShots(result, enemy, state, fw, tuning);
    return e;
  });

  const reinforced = launchReinforcements(state, enemies, stage, ctx, dtMs, tuning);
  enemies = reinforced.enemies;
  let runStats = reinforced.runStats;

  if (routEscaped > 0) runStats = bumpRun(runStats, { routEscaped });
  if (fw.buddyShotsDrawn > 0) runStats = bumpRun(runStats, { buddyShotsDrawn: fw.buddyShotsDrawn }); // #2845

  enemies = applyStragglerRule(state, enemies, routed); // #1031

  // #2844: the attention debt is a floor under every ship's next-shot timer, whatever the phase
  // changes above did to it (a dive launch zeroes the timer; the straggler rule caps it)
  enemies = mapKeep(enemies, (e) =>
    e.isAlive && e.attentionMs > 0 && e.shootTimer < e.attentionMs
      ? { ...e, shootTimer: e.attentionMs }
      : e
  );

  return {
    ...state,
    enemies,
    enemyBullets: fw.enemyBullets ?? state.enemyBullets,
    nextDiveTimer,
    formationSwayX: swayX,
    formationSwayDir: swayDir,
    guardianThresholdCrossed,
    guardianDeepThresholdCrossed,
    reinforceTimer: reinforced.reinforceTimer,
    reinforcedThisWave: reinforced.reinforcedThisWave,
    carrierBeams: fw.carrierBeams ?? state.carrierBeams,
    tierStats: fw.tierStats ?? state.tierStats,
    // #2843: only in combat does the Carrier act on (and so "consume") a stage change
    carrierStage: state.phase === "Playing" ? stage : state.carrierStage,
    runStats,
    routed,
  };
}

// ---------------------------------------------------------------------------
// Derived helpers (useful for renderers)
// ---------------------------------------------------------------------------

/**
 * True while any enemy is still in the SwoopIn entry animation.
 * @internal Exported for tests and offline tooling only; no production caller (knip --production, #3126).
 */
export function isSwooping(state: StarSwarmState): boolean {
  return state.enemies.some((e) => e.isAlive && e.phase === "SwoopIn");
}

/**
 * Number of enemies currently airborne (Diving or Circling).
 * @internal Exported for tests and offline tooling only; no production caller (knip --production, #3126).
 */
export function diverCount(state: StarSwarmState): number {
  return state.enemies.filter((e) => e.isAlive && (e.phase === "Diving" || e.phase === "Circling"))
    .length;
}
