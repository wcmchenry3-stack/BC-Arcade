/**
 * Star Swarm engine — Buddy (#1035, #2845), a durable, targetable allied ship.
 *
 * Buddy's station-keeping, attack runs and evasion (`tickBuddyShips`), the hostile fire it
 * draws (`buddyTargetFor`, `aimAtBuddy` — the finite-capacity seam the enemies divert shots
 * through) and the damage it takes (`resolveBuddyHits`). Every Buddy decision is rng-free (a
 * stateless hash of entity ids), so Buddy never perturbs the seeded stream; its own entities
 * draw ids from a separate range (#2880).
 */
import type {
  Asteroid,
  BuddyShip,
  Bullet,
  CarrierBeam,
  Enemy,
  EnemyTier,
  Explosion,
  StarSwarmState,
  Vec2,
} from "../types";
import { asteroidHits, asteroidThreatens, type ThreatCircle } from "./asteroids";
import { spawnExplosion } from "./entities";
import { beamHazards, weaponsFree, type Hazard } from "./extraction";
import { collideCircleAABB, hashFrac } from "./geometry";
import { nextBuddyId, seedBuddyIdRange } from "./rng";
import { carrierArmoredIn } from "./roster";
import { bumpRun } from "./stats";
import {
  ASTEROID_HIT_FLASH_MS,
  BUDDY_BEAM_DAMAGE,
  BUDDY_BULLET_SPEED,
  BUDDY_BURST_INTERVAL,
  BUDDY_FIRST_BURST_MS,
  BUDDY_FORMATION_GAP,
  BUDDY_HURT_RADIUS,
  BUDDY_LOOKAHEAD_MS,
  BUDDY_MARGIN,
  BUDDY_PLAYER_GAP,
  BUDDY_ROCK_DAMAGE,
  BUDDY_ROCK_LOOKAHEAD_MS,
  BUDDY_RUN_MS,
  BUDDY_RUN_RISE,
  BUDDY_STATION_MS,
  BUDDY_STRAFE_PERIOD,
  BUDDY_TARGET_BELOW,
  BUDDY_TARGET_RANGE,
  BUDDY_TRANSIT_SPEED,
  BULLET_E_H,
  BULLET_E_W,
  CANVAS_W,
  DEFAULT_TUNING,
  HIT_FLASH_DURATION,
  MAX_PLAYER_BULLETS,
  PLAYER_Y_FROM_BOTTOM,
  type Tuning,
} from "./tuning";

// ---------------------------------------------------------------------------
// Buddy (#1035, #2845) — a durable, targetable allied ship
// ---------------------------------------------------------------------------
//
// ---------------------------------------------------------------------------
// Buddy (#1035, #2845) — a durable, targetable allied ship
// ---------------------------------------------------------------------------
//
// Buddy flies in from a side edge to a standoff lane below the formation (Entering), strafes
// there making BUDDY_BURSTS attack runs — it lines up under its target and fires one piercing
// spread burst per run (OnStation) — then peels off (Leaving). It has BUDDY_HP hit points;
// hostile shots, released Carrier beams and rocks damage it, and at 0 it is destroyed (its
// unfired bursts are lost, its fired shots fly on). Every Buddy decision is deterministic and
// rng-free (stateless hashes of entity ids), so Buddy never perturbs the seeded stream.

/** Stateless [0, 1) roll for a key — a divert decision or an aim error, never the seeded rng. */
export function buddyDivertRoll(key: number): number {
  return hashFrac(key * 7.7713 + 1.37);
}

/**
 * #2845: does Buddy notice this hazard at all? A per-hazard, per-Buddy hash against `chance`
 * (see BUDDY_NOTICE) — deterministic, and the imperfection in Buddy's otherwise strong evasion.
 */
export function buddyNotices(buddyId: number, hazardId: number, chance: number): boolean {
  return hashFrac(hazardId * 12.9898 + buddyId * 4.1414 + 0.5) < chance;
}

/** #2845: Buddy's hit circle (with its velocity) — the asteroid contract's input. */
export function buddyThreatCircle(b: BuddyShip, pad = 0): ThreatCircle {
  return { x: b.x, y: b.y, r: BUDDY_HURT_RADIUS + pad, vx: b.vx, vy: b.vy };
}

/**
 * #2845: the Buddy `shooter` may divert a shot to — the nearest one on screen, in range and far
 * enough below it (enemy guns point down); null if none. The armored Carrier never targets Buddy
 * (it has no aimed guns then anyway); from the moment the last Guardian dies it does.
 */
export function buddyTargetFor(
  shooter: Pick<Enemy, "x" | "y" | "tier">,
  buddies: readonly BuddyShip[],
  carrierArmored: boolean,
  canvasW = CANVAS_W
): BuddyShip | null {
  if (shooter.tier === "Carrier" && carrierArmored) return null;
  let best: BuddyShip | null = null;
  let bestD = BUDDY_TARGET_RANGE * BUDDY_TARGET_RANGE;
  for (const b of buddies) {
    if (b.hp <= 0 || b.x < 0 || b.x > canvasW || b.y < 0) continue;
    const dy = b.y - shooter.y;
    if (dy < BUDDY_TARGET_BELOW) continue;
    const dx = b.x - shooter.x;
    const d = dx * dx + dy * dy;
    if (d <= bestD) {
      best = b;
      bestD = d;
    }
  }
  return best;
}

/**
 * #2845: a shot's velocity from (ox, oy) at Buddy, by tier (BUDDY_TARGETING): its speed, how much
 * of Buddy's motion it leads, and an aim error drawn from a hash of `key`. Grunts are slow, blind
 * to motion and wild; the Carrier is fast, leads fully and barely misses.
 */
export function aimAtBuddy(
  ox: number,
  oy: number,
  buddy: Pick<BuddyShip, "x" | "y" | "vx" | "vy">,
  tier: EnemyTier,
  key: number,
  tuning: Tuning = DEFAULT_TUNING
): { vx: number; vy: number } {
  const t = tuning.BUDDY_TARGETING[tier];
  const flight = Math.hypot(buddy.x - ox, buddy.y - oy) / t.speed;
  const tx = buddy.x + buddy.vx * flight * t.lead;
  const ty = buddy.y + buddy.vy * flight * t.lead;
  const err = (hashFrac(key * 3.7331 + 0.21) * 2 - 1) * t.aimError;
  const ang = Math.atan2(ty - oy, tx - ox) + err;
  return { vx: Math.cos(ang) * t.speed, vy: Math.sin(ang) * t.speed };
}

/**
 * #2845 allied collision policy — an explicit rule, not an omission: only enemy-owned shots can
 * hurt the player or Buddy. Player shots (Buddy's burst included) pass through both allies
 * harmlessly, and player/Buddy shots never collide with each other (nothing tests one player shot
 * against another). The player and Buddy's hulls never collide either. Both still meet hostiles
 * and rocks normally.
 */
export function shotHarmsAllies(b: Pick<Bullet, "owner">): boolean {
  return b.owner === "enemy";
}

/** #2845: what Buddy fires at — the exposed Carrier first, else the formation's centre. */
function buddyAimTarget(state: StarSwarmState): Vec2 | null {
  const carrier = state.enemies.find((e) => e.isAlive && e.tier === "Carrier");
  if (carrier && !carrierArmoredIn(state.enemies)) return { x: carrier.x, y: carrier.y };
  // the armored Carrier is off the list: its field would stop the burst
  const ships = state.enemies.filter(
    (e) => e.isAlive && e.tier !== "Carrier" && e.y >= 0 && e.phase !== "SwoopIn"
  );
  if (ships.length === 0) return null;
  return {
    x: ships.reduce((s, e) => s + e.x, 0) / ships.length,
    y: ships.reduce((s, e) => s + e.y, 0) / ships.length,
  };
}

/** Buddy's lowest allowed lane — it keeps clear of the player's. */
function buddyFloorY(canvasH: number): number {
  return canvasH - PLAYER_Y_FROM_BOTTOM - BUDDY_PLAYER_GAP;
}

/**
 * #2845: where Buddy wants to be right now. A lane below the lowest ship holding formation, and
 * never within BUDDY_STANDOFF of the Carrier (the vertical gap alone guarantees it); strafing
 * ±BUDDY_STRAFE about its target line, except on an attack run (the last BUDDY_RUN_MS before a
 * burst), when it lines up under the target and climbs BUDDY_RUN_RISE — still outside the
 * standoff. The floor (above the player lane) wins if the Carrier dives deep on its own run.
 */
export function buddyStation(
  state: StarSwarmState,
  b: Pick<BuddyShip, "ageMs" | "burstTimer" | "burstsLeft" | "phase">,
  tuning: Tuning = DEFAULT_TUNING
): Vec2 {
  const { canvasW, canvasH } = state;
  const floor = buddyFloorY(canvasH);
  let formationBottom = 0;
  for (const e of state.enemies) {
    if (e.isAlive && (e.phase === "Formation" || e.phase === "Wiggling")) {
      formationBottom = Math.max(formationBottom, e.y + e.height / 2);
    }
  }
  const carrier = state.enemies.find((e) => e.isAlive && e.tier === "Carrier");
  const standoffY = carrier ? carrier.y + tuning.BUDDY_STANDOFF : -Infinity;
  let y = Math.max(
    formationBottom + BUDDY_FORMATION_GAP,
    canvasH * tuning.BUDDY_LANE_FLOOR,
    standoffY
  );
  const target = buddyAimTarget(state);
  const runIn = b.phase === "OnStation" && b.burstsLeft > 0 && b.burstTimer <= BUDDY_RUN_MS;
  let x: number;
  if (target && runIn) {
    x = target.x;
    y = Math.max(y - BUDDY_RUN_RISE, standoffY);
  } else {
    const cx = target ? target.x : canvasW / 2;
    x = cx + tuning.BUDDY_STRAFE * Math.sin((2 * Math.PI * b.ageMs) / BUDDY_STRAFE_PERIOD);
  }
  return {
    x: Math.max(20, Math.min(canvasW - 20, x)),
    y: Math.min(floor, y),
  };
}

/**
 * #2845: the hostiles Buddy is dodging — the enemy shots (flak and shots at the player included),
 * released Carrier beams and threatening rocks (`asteroidThreatens` over BUDDY_ROCK_LOOKAHEAD_MS)
 * that it noticed (BUDDY_NOTICE). Player shots are allied and never listed.
 */
export function buddyHazards(
  state: StarSwarmState,
  b: BuddyShip,
  tuning: Tuning = DEFAULT_TUNING
): Hazard[] {
  const { BUDDY_NOTICE, BUDDY_NOTICE_AIMED } = tuning;
  const out: Hazard[] = [];
  for (const e of state.enemyBullets) {
    if (!shotHarmsAllies(e)) continue;
    if (Math.abs(e.x - b.x) > 280 || Math.abs(e.y - b.y) > 360) continue; // can't arrive in time
    if (!buddyNotices(b.id, e.id, e.target === "buddy" ? BUDDY_NOTICE_AIMED : BUDDY_NOTICE.shot))
      continue;
    out.push({ x: e.x, y: e.y, vx: e.vx, vy: e.vy, r: Math.max(e.width, e.height) / 2 });
  }
  for (const beam of state.carrierBeams) {
    if (buddyNotices(b.id, beam.id, BUDDY_NOTICE.beam)) out.push(...beamHazards(beam));
  }
  const circle = buddyThreatCircle(b, BUDDY_MARGIN);
  for (const a of state.asteroids) {
    if (!asteroidThreatens(a, circle, BUDDY_ROCK_LOOKAHEAD_MS)) continue;
    if (!buddyNotices(b.id, a.id, BUDDY_NOTICE.rock)) continue;
    out.push({ x: a.x, y: a.y, vx: a.vx, vy: a.vy, r: a.radius });
  }
  return out;
}

/** How dangerous steering from Buddy's spot for (tx, ty) is over the next ~700 ms. 0 = clear. */
function buddyDanger(
  b: BuddyShip,
  hazards: readonly Hazard[],
  tx: number,
  ty: number,
  speed: number
): number {
  const dx = tx - b.x;
  const dy = ty - b.y;
  const len = Math.hypot(dx, dy);
  let danger = 0;
  for (const t of BUDDY_LOOKAHEAD_MS) {
    const step = len > 0 ? Math.min(len, speed * t) / len : 0;
    const sx = b.x + dx * step;
    const sy = b.y + dy * step;
    const weight = 1 / (1 + t / 250);
    for (const h of hazards) {
      const reach = h.r + BUDDY_HURT_RADIUS + BUDDY_MARGIN;
      const hx = h.x + h.vx * t - sx;
      const hy = h.y + h.vy * t - sy;
      if (hx * hx + hy * hy < reach * reach) danger += weight;
    }
  }
  return danger;
}

const BUDDY_DODGE_DX = [-90, -60, -30, 0, 30, 60, 90] as const;
const BUDDY_DODGE_DY = [-40, 0, 40] as const;

/**
 * #2845: Buddy's evasion — pick the point to steer for. With nothing noticed it is simply its
 * station. Otherwise it scores its station and a bounded ring of nearby points (±90 px across,
 * ±40 px up/down) against every noticed hazard at its capped speed, and takes the safest, pulled
 * toward its station; on station no point inside the Carrier standoff is considered. Strong (it sees 700 ms
 * ahead), bounded (BUDDY_SPEED, a small ring) and imperfect (BUDDY_NOTICE misses, and it only
 * re-plans every BUDDY_REPLAN_MS).
 */
function planBuddyGoal(
  state: StarSwarmState,
  b: BuddyShip,
  desired: Vec2,
  speed: number,
  clampToField: boolean,
  tuning: Tuning
): Vec2 {
  const hazards = buddyHazards(state, b, tuning);
  if (hazards.length === 0) return desired;
  const carrier = state.enemies.find((e) => e.isAlive && e.tier === "Carrier");
  const floor = buddyFloorY(state.canvasH) + 30;
  // the standoff holds while dodging too — a dodge never ducks in toward the Carrier
  const ceiling = Math.max(state.canvasH * 0.2, carrier ? carrier.y + tuning.BUDDY_STANDOFF : 0);
  const candidates: Vec2[] = [desired];
  for (const dx of BUDDY_DODGE_DX) {
    for (const dy of BUDDY_DODGE_DY) {
      let x = b.x + dx;
      let y = b.y + dy;
      if (clampToField) {
        x = Math.max(16, Math.min(state.canvasW - 16, x));
        y = Math.min(floor, Math.max(ceiling, y));
      }
      candidates.push({ x, y });
    }
  }
  let best = desired;
  let bestCost = Infinity;
  for (const c of candidates) {
    let cost = buddyDanger(b, hazards, c.x, c.y, speed) * 1000;
    cost += Math.hypot(c.x - desired.x, c.y - desired.y) * 0.05;
    if (cost < bestCost) {
      bestCost = cost;
      best = c;
    }
  }
  return best;
}

/** #2845: one attack-run burst — a piercing (not armor-piercing) fan at `target`. */
/** #2845: how many shots Buddy's next burst fans out (a stateless hash — rng-free). */
export function buddyBurstCount(
  b: Pick<BuddyShip, "id" | "burstsLeft">,
  tuning: Tuning = DEFAULT_TUNING
): number {
  const { BUDDY_BULLET_COUNT_MIN, BUDDY_BULLET_COUNT_MAX } = tuning;
  return (
    BUDDY_BULLET_COUNT_MIN +
    Math.floor(
      hashFrac(b.id * 9.13 + b.burstsLeft * 2.71) *
        (BUDDY_BULLET_COUNT_MAX - BUDDY_BULLET_COUNT_MIN + 1)
    )
  );
}

/**
 * The whole fan, always — the caller only fires it once the player-bullet cap (#2334: Buddy's
 * shots are player-owned) has room for every shot, so a burst is never spent half-empty.
 */
function buddyBurst(b: BuddyShip, target: Vec2 | null, tuning: Tuning): Bullet[] {
  const count = buddyBurstCount(b, tuning);
  const base = target ? Math.atan2(target.y - b.y, target.x - b.x) : -Math.PI / 2;
  const out: Bullet[] = [];
  for (let i = 0; i < count; i++) {
    const angle =
      count === 1 ? base : base + ((i / (count - 1)) * 2 - 1) * tuning.BUDDY_SPREAD_HALF;
    out.push({
      id: nextBuddyId(),
      x: b.x,
      y: b.y,
      vx: Math.cos(angle) * BUDDY_BULLET_SPEED,
      vy: Math.sin(angle) * BUDDY_BULLET_SPEED,
      owner: "player",
      width: BULLET_E_W,
      height: BULLET_E_H,
      damage: tuning.BUDDY_SHOT_DAMAGE,
      piercing: true, // multi-hit through ordinary hulls…
      pierceLeft: tuning.BUDDY_PIERCE_HITS, // …but only this many (#2880)
      // …but not armorPiercing: the escorted Carrier's field stops it (#2845)
      source: "buddy",
    });
  }
  return out;
}

/** #2845: a fresh Buddy entering from a side edge (the side is a hash of its id — rng-free). */
export function makeBuddy(state: StarSwarmState, tuning: Tuning = DEFAULT_TUNING): BuddyShip {
  const { BUDDY_BURSTS, BUDDY_HP } = tuning;
  // Seed Buddy's range from where the main stream is at launch (read-only: nothing is allocated
  // from it), so Buddy's id — which keys its side, fan size and noticing — still differs run to
  // run instead of being the same 1e9 every time. Only ever moves forward, so ids stay unique.
  seedBuddyIdRange();
  const id = nextBuddyId();
  const fromLeft = hashFrac(id * 5.19 + 0.3) < 0.5;
  const station = buddyStation(
    state,
    { ageMs: 0, burstTimer: BUDDY_FIRST_BURST_MS, burstsLeft: BUDDY_BURSTS, phase: "Entering" },
    tuning
  );
  const x = fromLeft ? -30 : state.canvasW + 30;
  return {
    id,
    x,
    y: station.y,
    vx: 0,
    vy: 0,
    phase: "Entering",
    hp: BUDDY_HP,
    hitFlashTimer: 0,
    ageMs: 0,
    stationMs: BUDDY_STATION_MS,
    burstsLeft: BUDDY_BURSTS,
    burstTimer: BUDDY_FIRST_BURST_MS,
    planMs: 0,
    goalX: x,
    goalY: station.y,
    facingRight: fromLeft,
    hitRockIds: [],
  };
}

/** #2845: launch a Buddy (pickup or dev panel) and count it. */
export function launchBuddy(
  state: StarSwarmState,
  tuning: Tuning = DEFAULT_TUNING
): StarSwarmState {
  return {
    ...state,
    buddyShips: [...state.buddyShips, makeBuddy(state, tuning)],
    runStats: bumpRun(state.runStats, { buddyLaunched: 1 }),
  };
}

/** #2845: true on the tick a Buddy is destroyed (the screen announces it). */
export function buddyJustLost(prev: StarSwarmState, next: StarSwarmState): boolean {
  return next.runStats.buddyLost > prev.runStats.buddyLost;
}

export function tickBuddyShips(
  state: StarSwarmState,
  dtMs: number,
  tuning: Tuning = DEFAULT_TUNING
): StarSwarmState {
  if (state.buddyShips.length === 0) return state;
  const { canvasW, canvasH } = state;
  const newPlayerBullets = [...state.playerBullets];
  const updated: BuddyShip[] = [];
  // Nothing left to fight, or the wave is being extracted: every Buddy peels off (unfired bursts
  // are lost). A Buddy in flight during swoop-in holds its fire (weaponsFree), like every gun.
  const standDown = state.phase === "Extraction" || !state.enemies.some((e) => e.isAlive);

  for (const b0 of state.buddyShips) {
    let b: BuddyShip = {
      ...b0,
      ageMs: b0.ageMs + dtMs,
      hitFlashTimer: Math.max(0, b0.hitFlashTimer - dtMs),
      planMs: b0.planMs - dtMs,
    };
    if (standDown && b.phase !== "Leaving") b = { ...b, phase: "Leaving" };

    // ── phase and attack runs ──
    if (b.phase === "Entering") {
      const st = buddyStation(state, b, tuning);
      if (Math.hypot(st.x - b.x, st.y - b.y) < 10 || b.ageMs > 2500)
        b = { ...b, phase: "OnStation" };
    } else if (b.phase === "OnStation") {
      let { burstTimer, burstsLeft, stationMs } = b;
      stationMs -= dtMs;
      burstTimer -= dtMs;
      if (burstTimer <= 0 && burstsLeft > 0) {
        const room = MAX_PLAYER_BULLETS - newPlayerBullets.length;
        if (weaponsFree(state) && room >= buddyBurstCount(b, tuning)) {
          newPlayerBullets.push(...buddyBurst(b, buddyAimTarget(state), tuning));
          burstsLeft--;
          burstTimer = BUDDY_BURST_INTERVAL;
          if (burstsLeft === 0) stationMs = Math.min(stationMs, 800); // a beat, then away
        } else {
          // hold the run (lined up) until combat allows fire and the player-bullet cap has room
          // for the whole fan; station time still runs, so a blocked burst can't stretch the sortie
          burstTimer = 0;
        }
      }
      b = { ...b, burstTimer, burstsLeft, stationMs };
      if (stationMs <= 0) b = { ...b, phase: "Leaving" };
    }

    // ── steering: station → evasion plan → capped move ──
    const leaving = b.phase === "Leaving";
    const desired: Vec2 = leaving
      ? { x: b.x < canvasW / 2 ? -60 : canvasW + 60, y: b.y - 80 }
      : buddyStation(state, b, tuning);
    const speed = b.phase === "OnStation" ? tuning.BUDDY_SPEED : BUDDY_TRANSIT_SPEED;
    let goal: Vec2 = { x: b.goalX, y: b.goalY };
    if (b.planMs <= 0) {
      goal = planBuddyGoal(state, b, desired, speed, b.phase === "OnStation", tuning);
      b = { ...b, planMs: tuning.BUDDY_REPLAN_MS, goalX: goal.x, goalY: goal.y };
    }
    const dx = goal.x - b.x;
    const dy = goal.y - b.y;
    const len = Math.hypot(dx, dy);
    const step = len > 0 ? Math.min(len, speed * dtMs) / len : 0;
    const x = b.x + dx * step;
    const y = b.y + dy * step;
    const vx = dtMs > 0 ? (x - b.x) / dtMs : 0;
    const vy = dtMs > 0 ? (y - b.y) / dtMs : 0;
    const facingRight = Math.abs(vx) > 0.03 ? vx > 0 : b.facingRight;
    b = { ...b, x, y, vx, vy, facingRight };

    const gone = leaving && (x < -30 || x > canvasW + 30 || y < -30 || y > canvasH + 30);
    if (!gone) updated.push(b);
  }

  return { ...state, buddyShips: updated, playerBullets: newPlayerBullets };
}

/**
 * #2845: hostiles against Buddy. Enemy shots (any tier, flak and shots meant for the player
 * included) and released Carrier beams that touch Buddy's hit circle are spent on it — a shot
 * deals its damage, a beam BUDDY_BEAM_DAMAGE. A rock deals BUDDY_ROCK_DAMAGE once per rock
 * (`asteroidHits`); a small one shatters, a large one flies on. The player's shield never covers
 * Buddy, and player shots are allied (`shotHarmsAllies`). At 0 HP Buddy explodes and is removed —
 * its unfired bursts go with it, but the shots it already fired fly on (they are separate
 * entities in `playerBullets`).
 */
export function resolveBuddyHits(
  buddies: readonly BuddyShip[],
  enemyBullets: readonly Bullet[],
  beams: readonly CarrierBeam[],
  rocks: Asteroid[],
  explosions: Explosion[]
): { buddies: BuddyShip[]; enemyBullets: Bullet[]; beams: CarrierBeam[]; lost: number } {
  if (buddies.length === 0) {
    return { buddies: [], enemyBullets: [...enemyBullets], beams: [...beams], lost: 0 };
  }
  const spentShots = new Set<number>();
  const spentBeams = new Set<number>();
  const out: BuddyShip[] = [];
  let lost = 0;
  for (const b0 of buddies) {
    let b = b0;
    let damage = 0;
    for (const s of enemyBullets) {
      if (spentShots.has(s.id) || !shotHarmsAllies(s)) continue;
      if (!collideCircleAABB(b.x, b.y, BUDDY_HURT_RADIUS, s.x, s.y, s.width, s.height)) continue;
      spentShots.add(s.id);
      damage += s.damage;
    }
    for (const beam of beams) {
      if (spentBeams.has(beam.id)) continue;
      const hit = collideCircleAABB(
        b.x,
        b.y,
        BUDDY_HURT_RADIUS,
        beam.x,
        beam.y - beam.length / 2,
        beam.halfWidth * 2,
        beam.length
      );
      if (!hit) continue;
      spentBeams.add(beam.id);
      damage += BUDDY_BEAM_DAMAGE;
    }
    const circle = buddyThreatCircle(b);
    for (let ri = 0; ri < rocks.length; ri++) {
      const rock = rocks[ri]!;
      if (b.hitRockIds.includes(rock.id) || !asteroidHits(rock, circle)) continue;
      damage += BUDDY_ROCK_DAMAGE;
      b = { ...b, hitRockIds: [...b.hitRockIds, rock.id] };
      rocks[ri] =
        rock.kind === "small"
          ? { ...rock, hp: 0, shattered: true }
          : { ...rock, hitFlashTimer: ASTEROID_HIT_FLASH_MS };
    }
    if (damage === 0) {
      out.push(b);
      continue;
    }
    const hp = b.hp - damage;
    if (hp <= 0) {
      explosions.push(spawnExplosion(b.x, b.y, nextBuddyId()));
      lost++;
      continue;
    }
    out.push({ ...b, hp, hitFlashTimer: HIT_FLASH_DURATION });
  }
  return {
    buddies: out,
    enemyBullets: spentShots.size
      ? enemyBullets.filter((s) => !spentShots.has(s.id))
      : [...enemyBullets],
    beams: spentBeams.size ? beams.filter((x) => !spentBeams.has(x.id)) : [...beams],
    lost,
  };
}
