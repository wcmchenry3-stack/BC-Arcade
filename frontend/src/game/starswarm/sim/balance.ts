/**
 * #2880: seeded, headless Buddy balance simulation over the real Star Swarm engine.
 *
 * It drives the engine's own `tick()` with an autoplayed player, launches Buddy through the real
 * power-up path (`applyPowerUp(s, "buddy")`, the dev-panel handle — the same `makeBuddy` a pickup
 * uses) and measures, per sortie, what happens to Buddy and to the Carrier. Nothing in the engine
 * is instrumented: every metric is recovered by diffing consecutive states (which shot vanished
 * on Buddy's hull, which enemy a Buddy shot newly pierced, …), and the attribution is
 * cross-checked against Buddy's actual HP loss (`attributionMisses`).
 *
 * Paired design: each seed plays to the launch point once, then forks from that exact state and
 * engine counters into a with-Buddy and a without-Buddy branch, so the Carrier's time-to-kill is
 * compared on the same seed.
 *
 * The engine is a parameter, so the same harness runs the shipped engine or a sim-only variant
 * with tuning overrides (see engineVariant.ts). Runner and docs: docs/games/starswarm.md,
 * "Balance simulation".
 */
import { deriveSeed, mix32 } from "../../_shared/simRandom";
import type * as EngineModule from "../engine";
import type {
  Bullet,
  BuddyShip,
  DifficultyTier,
  Enemy,
  EnemyTier,
  GunsLevel,
  StarSwarmInput,
  StarSwarmState,
} from "../types";

export type Engine = typeof EngineModule;

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Where Buddy is launched.
 * - `boss-exposed`: boss wave (5); the player kills the four Guardians, Buddy launches the tick
 *   the Carrier is exposed (a boss wave's lone Carrier goes straight to its final stand).
 * - `boss-start`: boss wave (5); Buddy launches as combat starts (Carrier still armored).
 * - `normal-mid`: ordinary wave (3); Buddy launches once a seeded 15–75% of the wave is dead.
 * - `normal-exposed`: ordinary wave (3); Buddy launches the tick the Carrier is exposed.
 * - `normal-start`: ordinary wave (3); Buddy launches as combat starts, against the full fleet —
 *   the "one sortie wipes the fleet" case (#2880).
 */
export type Scenario =
  "boss-exposed" | "boss-start" | "normal-mid" | "normal-exposed" | "normal-start";
export const SCENARIOS: readonly Scenario[] = [
  "boss-exposed",
  "boss-start",
  "normal-mid",
  "normal-exposed",
  "normal-start",
];

export interface PilotConfig {
  /** Label used in reports. */
  readonly name: string;
  /** The player cannot be hurt (hits are still counted as `playerHits`: 0). */
  readonly invincible: boolean;
  /** Chance the pilot notices a given hazard at all (stateless hash of its id). */
  readonly notice: number;
  /** ms between dodge re-plans (reaction latency). */
  readonly replanMs: number;
  /** px/ms lateral speed cap (a brisk drag). */
  readonly speed: number;
  /** Guns level for the run (a wave-3/5 player usually has L2). */
  readonly guns: GunsLevel;
  /** After launch, keep firing (false = a "duel": the player only dodges, Buddy vs Carrier). */
  readonly fireAfterLaunch: boolean;
}

export const PILOTS = {
  /** A competent but fallible player: misses 15% of hazards, 120 ms reaction. */
  normal: {
    name: "autoplay",
    invincible: false,
    notice: 0.85,
    replanMs: 120,
    speed: 0.45,
    guns: 2,
    fireAfterLaunch: true,
  },
  invincible: {
    name: "invincible",
    invincible: true,
    notice: 0.85,
    replanMs: 120,
    speed: 0.45,
    guns: 2,
    fireAfterLaunch: true,
  },
  /** The player dodges but holds fire after launch: Buddy alone against the Carrier. */
  duel: {
    name: "duel",
    invincible: true,
    notice: 0.85,
    replanMs: 120,
    speed: 0.45,
    guns: 2,
    fireAfterLaunch: false,
  },
} as const satisfies Record<string, PilotConfig>;

export interface RunSpec {
  readonly scenario: Scenario;
  readonly difficulty: DifficultyTier;
  readonly seed: number;
  readonly pilot: PilotConfig;
  /** Label of the engine variant (reports group by it). */
  readonly variant: string;
  /** Skip the without-Buddy branch (sensitivity sweeps that don't need TTK). */
  readonly skipControl?: boolean;
}

const DT = 16; // ms per tick — the tests' step
const PRE_MAX_MS = 180_000; // give up reaching the launch point after this long
const POST_MAX_MS = 60_000; // and follow each branch at most this long after launch
const LANE_PAD = 3;
const TAIL_MS = 1500; // after a sortie with no time-to-kill to follow, let shots in flight land

// ---------------------------------------------------------------------------
// Autoplay pilot
// ---------------------------------------------------------------------------

interface PilotState {
  goalX: number;
  planMs: number;
  targetId: number | null;
  prevEnemyPos: Map<number, { x: number; y: number }>;
}

function newPilot(x: number): PilotState {
  return { goalX: x, planMs: 0, targetId: null, prevEnemyPos: new Map() };
}

function clonePilot(p: PilotState): PilotState {
  return { ...p, prevEnemyPos: new Map(p.prevEnemyPos) };
}

interface Hz {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
}

const PILOT_LOOKAHEAD = [0, 60, 120, 180, 240, 320, 400, 500, 600, 720] as const;
const PLAYER_R = 7; // PLAYER_HURT_RADIUS
const PILOT_MARGIN = 5;

function pilotHazards(E: Engine, s: StarSwarmState, ps: PilotState, cfg: PilotConfig): Hz[] {
  const seen = (id: number, salt: number) => E.hashFrac(id * 1.618 + salt) < cfg.notice;
  const out: Hz[] = [];
  const p = s.player;
  for (const b of s.enemyBullets) {
    if (b.y > p.y + 20 && b.vy >= 0) continue;
    if (!seen(b.id, 0.11)) continue;
    out.push({ x: b.x, y: b.y, vx: b.vx, vy: b.vy, r: Math.max(b.width, b.height) / 2 });
  }
  for (const a of s.asteroids) {
    if (a.hp > 0 && seen(a.id, 0.37)) out.push({ x: a.x, y: a.y, vx: a.vx, vy: a.vy, r: a.radius });
  }
  for (const beam of s.carrierBeams) {
    if (!seen(beam.id, 0.73)) continue;
    for (let d = 0; d <= beam.length; d += beam.halfWidth * 1.5) {
      out.push({ x: beam.x, y: beam.y - d, vx: 0, vy: beam.vy, r: beam.halfWidth });
    }
  }
  // a charging beam: its column is a threat for the whole lane (the telegraph is readable)
  const charge = E.carrierBeamCharge(s);
  if (charge && charge.progress > 0.25) {
    out.push({ x: charge.x, y: p.y, vx: 0, vy: 0, r: E.BEAM_HALF_WIDTH + 4 });
  }
  // diving / circling hulls near the lane (velocity from the last tick)
  for (const e of s.enemies) {
    if (!e.isAlive || (e.phase !== "Diving" && e.phase !== "Circling")) continue;
    if (e.y < p.y - 260) continue;
    const prev = ps.prevEnemyPos.get(e.id);
    const vx = prev ? (e.x - prev.x) / DT : 0;
    const vy = prev ? (e.y - prev.y) / DT : 0;
    out.push({ x: e.x, y: e.y, vx, vy, r: Math.max(e.width, e.height) / 2 });
  }
  return out;
}

function laneDanger(
  px: number,
  py: number,
  goal: number,
  speed: number,
  hz: readonly Hz[]
): number {
  let danger = 0;
  const dx = goal - px;
  for (const t of PILOT_LOOKAHEAD) {
    const sx = px + Math.sign(dx) * Math.min(Math.abs(dx), speed * t);
    const w = 1 / (1 + t / 250);
    for (const h of hz) {
      const reach = h.r + PLAYER_R + PILOT_MARGIN;
      const hx = h.x + h.vx * t - sx;
      const hy = h.y + h.vy * t - py;
      if (hx * hx + hy * hy < reach * reach) danger += w;
    }
  }
  return danger;
}

/** The enemy the pilot lines up under: the exposed Carrier, else the nearest low ship. */
function pickTarget(E: Engine, s: StarSwarmState, ps: PilotState): Enemy | null {
  const alive = s.enemies.filter((e) => e.isAlive && e.y > 0 && e.phase !== "SwoopIn");
  if (alive.length === 0) return null;
  const carrier = alive.find((e) => e.tier === "Carrier");
  const armored = E.isCarrierArmored(s);
  if (carrier && !armored) return carrier;
  const shootable = alive.filter((e) => e.tier !== "Carrier" || !armored);
  if (shootable.length === 0) return null;
  const px = s.player.x;
  const kept = ps.targetId !== null ? shootable.find((e) => e.id === ps.targetId) : undefined;
  if (kept && Math.abs(kept.x - px) < 140) return kept;
  let best: Enemy | null = null;
  let bestCost = Infinity;
  for (const e of shootable) {
    const cost = Math.abs(e.x - px) - 0.25 * e.y;
    if (cost < bestCost) {
      bestCost = cost;
      best = e;
    }
  }
  return best;
}

function pilotStep(
  E: Engine,
  s: StarSwarmState,
  ps: PilotState,
  cfg: PilotConfig,
  fire: boolean
): StarSwarmInput {
  const p = s.player;
  ps.planMs -= DT;
  if (ps.planMs <= 0) {
    ps.planMs = cfg.replanMs;
    const target = pickTarget(E, s, ps);
    ps.targetId = target ? target.id : null;
    const desired = target
      ? target.x
      : s.canvasW / 2 + Math.sin(s.runStats.buddyLaunched + p.x) * 60; // idle sweep
    const hz = pilotHazards(E, s, ps, cfg);
    const hw = p.width / 2;
    let best = Math.max(hw, Math.min(s.canvasW - hw, desired));
    let bestCost = Infinity;
    for (let x = Math.max(hw, p.x - 160); x <= Math.min(s.canvasW - hw, p.x + 160); x += 6) {
      const cost =
        (hz.length ? laneDanger(p.x, p.y, x, cfg.speed, hz) * 1000 : 0) +
        Math.abs(x - desired) * 0.05;
      if (cost < bestCost) {
        bestCost = cost;
        best = x;
      }
    }
    ps.goalX = best;
  }
  ps.prevEnemyPos.clear();
  for (const e of s.enemies) if (e.isAlive) ps.prevEnemyPos.set(e.id, { x: e.x, y: e.y });
  const dx = ps.goalX - p.x;
  const x = p.x + Math.sign(dx) * Math.min(Math.abs(dx), cfg.speed * DT);
  return { playerX: x, fire };
}

// ---------------------------------------------------------------------------
// Per-run records
// ---------------------------------------------------------------------------

export type BuddyKiller = "carrierTwin" | "beam" | "Guardian" | "Elite" | "Grunt" | "rock";
export const KILLERS: readonly BuddyKiller[] = [
  "carrierTwin",
  "beam",
  "Guardian",
  "Elite",
  "Grunt",
  "rock",
];
const TIERS: readonly EnemyTier[] = ["Grunt", "Elite", "Guardian", "Carrier"];

type TierCount = Record<EnemyTier, number>;
const zeroTiers = (): TierCount => ({ Grunt: 0, Elite: 0, Guardian: 0, Carrier: 0 });

export interface RunRecord {
  readonly scenario: Scenario;
  readonly difficulty: DifficultyTier;
  readonly seed: number;
  readonly pilot: string;
  readonly variant: string;
  /** The launch point was reached (false: the pilot never got there, the run is excluded). */
  readonly reached: boolean;
  /** Carrier exposed at launch. */
  readonly exposedAtLaunch: boolean;
  // ── Buddy sortie (with-Buddy branch) ──
  destroyed: boolean;
  killer: BuddyKiller | null;
  hpEnd: number;
  sortieMs: number;
  damageTaken: Record<BuddyKiller, number>;
  /** Enemy shots diverted to Buddy, by shooter tier, and how many of those hit it. */
  drawn: TierCount;
  drawnHit: TierCount;
  /** Shots not aimed at Buddy (player-directed) that hit it anyway. */
  strayHits: number;
  /** Damage dealt by Buddy / by the player to all enemies during the sortie window. */
  buddyDamage: number;
  playerDamage: number;
  buddyKills: TierCount;
  /** Buddy kills credited to each attack run (burst 1, 2, 3, …). */
  killsByRun: number[];
  /** Enemies alive at launch (every tier) — the fleet a sortie can take a share of. */
  fleetAtLaunch: number;
  /** Every enemy was dead by the end of the sortie window (sortie + shots in flight). */
  waveCleared: boolean;
  /** Every non-Carrier ship alive at launch was dead by then (the formation was wiped). */
  formationCleared: boolean;
  /** Damage Buddy dealt to the exposed Carrier (whole branch), and whether it landed the kill. */
  buddyCarrierDamage: number;
  carrierDamageTotal: number;
  carrierKilledByBuddy: boolean;
  /** Carrier beams released while Buddy was on station with the Carrier exposed. */
  beams: number;
  beamsInLane: number;
  beamHits: number;
  /** Carrier attack runs started while Buddy was on station, and their closest approach. */
  runs: number;
  runsClose: number;
  runMinDistSum: number;
  /** Share of on-station ms Buddy spent inside the exposed Carrier's beam lane. */
  onStationMs: number;
  inLaneMs: number;
  /** Mean Carrier↔Buddy distance while on station and exposed (sum over ticks, and ticks). */
  gapSum: number;
  gapTicks: number;
  /** Diffing could not account for part of Buddy's HP loss (should stay ~0). */
  attributionMisses: number;
  // ── Carrier time-to-kill (ms after launch; null = not dead by POST_MAX_MS) ──
  ttkWith: number | null;
  ttkWithout: number | null;
  /** Hits the player took in the sortie window, with and without Buddy. */
  playerHitsWith: number;
  playerHitsWithout: number;
}

function emptyRecord(spec: RunSpec, reached: boolean, exposed: boolean): RunRecord {
  return {
    scenario: spec.scenario,
    difficulty: spec.difficulty,
    seed: spec.seed,
    pilot: spec.pilot.name,
    variant: spec.variant,
    reached,
    exposedAtLaunch: exposed,
    destroyed: false,
    killer: null,
    hpEnd: 0,
    sortieMs: 0,
    damageTaken: { carrierTwin: 0, beam: 0, Guardian: 0, Elite: 0, Grunt: 0, rock: 0 },
    drawn: zeroTiers(),
    drawnHit: zeroTiers(),
    strayHits: 0,
    buddyDamage: 0,
    playerDamage: 0,
    buddyKills: zeroTiers(),
    killsByRun: [],
    fleetAtLaunch: 0,
    waveCleared: false,
    formationCleared: false,
    buddyCarrierDamage: 0,
    carrierDamageTotal: 0,
    carrierKilledByBuddy: false,
    beams: 0,
    beamsInLane: 0,
    beamHits: 0,
    runs: 0,
    runsClose: 0,
    runMinDistSum: 0,
    onStationMs: 0,
    inLaneMs: 0,
    gapSum: 0,
    gapTicks: 0,
    attributionMisses: 0,
    ttkWith: null,
    ttkWithout: null,
    playerHitsWith: 0,
    playerHitsWithout: 0,
  };
}

// ---------------------------------------------------------------------------
// Driving the engine
// ---------------------------------------------------------------------------

const SCENARIO_WAVE: Record<Scenario, number> = {
  "boss-exposed": 5,
  "boss-start": 5,
  "normal-mid": 3,
  "normal-exposed": 3,
  "normal-start": 3,
};

/** One engine tick under the sim's house rules: no pickups, lives topped up, optional invincibility. */
function simTick(
  E: Engine,
  s: StarSwarmState,
  ps: PilotState,
  cfg: PilotConfig,
  fire: boolean
): { next: StarSwarmState; hits: number } {
  let pre = s.powerUps.length ? { ...s, powerUps: [] } : s; // pickups would perturb the measurement
  if (pre.player.lives < 3) pre = { ...pre, player: { ...pre.player, lives: 3 } };
  if (cfg.invincible) pre = { ...pre, player: { ...pre.player, invincibleTimer: 1e9 } };
  const input = pilotStep(E, pre, ps, cfg, fire);
  const next = E.tick(pre, DT, input);
  const hits =
    Math.max(0, pre.player.lives - next.player.lives) +
    Math.max(0, pre.player.hull - next.player.hull);
  return { next, hits };
}

function carrierOf(s: StarSwarmState): Enemy | undefined {
  return s.enemies.find((e) => e.tier === "Carrier");
}

function carrierDead(s: StarSwarmState): boolean {
  const c = carrierOf(s);
  return !c || !c.isAlive;
}

/** Seeded kill fraction for `normal-mid` (0.15–0.75). */
function midFraction(seed: number): number {
  return 0.15 + (0.6 * mix32(seed ^ 0x2880)) / 4294967296;
}

function launchReady(E: Engine, s: StarSwarmState, spec: RunSpec, initialCount: number): boolean {
  if (s.phase !== "Playing") return false;
  switch (spec.scenario) {
    case "boss-start":
    case "normal-start":
      return true;
    case "boss-exposed":
    case "normal-exposed": {
      const stage = E.carrierStage(s);
      return stage === "exposed" || stage === "finalStand";
    }
    case "normal-mid": {
      const dead = s.enemies.filter((e) => !e.isAlive).length;
      return dead / initialCount >= midFraction(spec.seed);
    }
  }
}

function postBullet(s: StarSwarmState, id: number): Bullet | undefined {
  return s.playerBullets.find((b) => b.id === id);
}

/**
 * Where a new enemy bullet came from: the nearest live ship to its origin. `firedFrom` is the
 * roster the tick started with: a ship that fires and is killed in the same tick is dead in `s`
 * but is still the shooter.
 */
function shooterTier(s: StarSwarmState, b: Bullet, firedFrom?: StarSwarmState): EnemyTier {
  const wasAlive = new Set(firedFrom?.enemies.filter((e) => e.isAlive).map((e) => e.id));
  const ox = b.x - b.vx * DT;
  const oy = b.y - b.vy * DT;
  let best: EnemyTier = "Grunt";
  let bestD = Infinity;
  for (const e of s.enemies) {
    if (!e.isAlive && !wasAlive.has(e.id)) continue;
    const d = Math.hypot(e.x - ox, e.y + e.height / 2 - oy);
    if (d < bestD) {
      bestD = d;
      best = e.tier;
    }
  }
  return best;
}

interface Tracker {
  shooter: Map<number, EnemyTier>;
  drawnIds: Set<number>;
  beamSeen: Set<number>;
  /** Beams released while Buddy was in play (the denominator of the beam hit rate). */
  beamCounted: Set<number>;
  runActive: boolean;
  runMin: number;
  /** Buddy shot id → the attack run (0-based) that fired it. */
  burstOf: Map<number, number>;
  bursts: number;
}

/**
 * Test hook: attribute a single tick (pre → post) to a fresh record, as a sortie in progress.
 * Pass a spec whose scenario/difficulty match the states; Buddy damage lands in `buddyDamage`,
 * `playerDamage` and the Carrier fields.
 */
export function attributeTick(
  E: Engine,
  pre: StarSwarmState,
  post: StarSwarmState,
  spec: RunSpec
): RunRecord {
  const rec = emptyRecord(spec, true, true);
  const tr: Tracker = {
    shooter: new Map(),
    drawnIds: new Set(),
    beamSeen: new Set(),
    beamCounted: new Set(),
    runActive: false,
    runMin: Infinity,
    burstOf: new Map(),
    bursts: 0,
  };
  observe(E, pre, post, rec, tr, -1, true);
  return rec;
}

/**
 * Attribute one tick's events (pre → post) to the record. Buddy is the single launched ship.
 */
function observe(
  E: Engine,
  pre: StarSwarmState,
  post: StarSwarmState,
  rec: RunRecord,
  tr: Tracker,
  buddyId: number,
  inSortie: boolean
): void {
  // provenance of new enemy shots
  for (const b of post.enemyBullets) {
    if (tr.shooter.has(b.id)) continue;
    const tier = shooterTier(post, b, pre);
    tr.shooter.set(b.id, tier);
    if (b.target === "buddy") {
      rec.drawn[tier]++;
      tr.drawnIds.add(b.id);
    }
  }

  // ── damage dealt by Buddy vs the player ──
  const preBullets = new Map(pre.playerBullets.map((b) => [b.id, b]));
  // a new Buddy fan this tick is its next attack run
  let newFan = false;
  for (const b of post.playerBullets) {
    if (b.source !== "buddy" || tr.burstOf.has(b.id)) continue;
    tr.burstOf.set(b.id, tr.bursts);
    newFan = true;
  }
  if (newFan) tr.bursts++;
  // enemy id → the Buddy shot that hit it this tick (a ship takes at most one hit a tick)
  const buddyHitsOn = new Map<number, number>();
  for (const b of post.playerBullets) {
    if (b.source !== "buddy" || !b.hitEnemyIds) continue;
    const before = preBullets.get(b.id)?.hitEnemyIds ?? [];
    for (const id of b.hitEnemyIds) {
      if (!before.includes(id)) buddyHitsOn.set(id, b.id);
    }
  }
  // a Buddy shot spent this tick (a prototype pierce cap, a rock) leaves no hitEnemyIds behind:
  // an otherwise unexplained hit on a ship it overlapped is its hit (each ship takes ≤1 hit a tick)
  const postIds = new Set(post.playerBullets.map((b) => b.id));
  const vanished = pre.playerBullets
    .filter((b) => b.source === "buddy" && !postIds.has(b.id))
    .map((b) => ({
      id: b.id,
      x: b.x + b.vx * DT,
      y: b.y + b.vy * DT,
      w: b.width,
      h: b.height,
      // ships this shot already hit on earlier ticks: it cannot be what hurt them now
      hit: b.hitEnemyIds ?? [],
    }));
  const preEnemies = new Map(pre.enemies.map((e) => [e.id, e]));
  for (const e of post.enemies) {
    const was = preEnemies.get(e.id);
    if (!was || !was.isAlive) continue;
    const drop = was.hp - e.hp;
    if (drop <= 0) continue;
    if (!buddyHitsOn.has(e.id)) {
      const overlapped = vanished.find(
        (b) =>
          !b.hit.includes(e.id) &&
          Math.abs(b.x - e.x) < (b.w + e.width) / 2 + 1 &&
          Math.abs(b.y - e.y) < (b.h + e.height) / 2 + 1
      );
      if (overlapped) buddyHitsOn.set(e.id, overlapped.id);
    }
    const hitBy = buddyHitsOn.get(e.id);
    const shot =
      hitBy === undefined ? undefined : (preBullets.get(hitBy) ?? postBullet(post, hitBy));
    const byBuddy = shot ? Math.min(drop, shot.damage) : 0;
    const byPlayer = drop - byBuddy;
    if (inSortie) {
      rec.buddyDamage += byBuddy;
      rec.playerDamage += byPlayer;
      if (!e.isAlive && byBuddy > 0) {
        rec.buddyKills[e.tier]++;
        const run = hitBy === undefined ? 0 : (tr.burstOf.get(hitBy) ?? 0);
        while (rec.killsByRun.length <= run) rec.killsByRun.push(0);
        rec.killsByRun[run]!++;
      }
    }
    if (e.tier === "Carrier") {
      rec.buddyCarrierDamage += byBuddy;
      rec.carrierDamageTotal += drop;
      if (!e.isAlive && byBuddy > 0) rec.carrierKilledByBuddy = true;
    }
  }

  const b0 = pre.buddyShips.find((b) => b.id === buddyId);
  if (!b0) return;
  const b1 = post.buddyShips.find((b) => b.id === buddyId);
  const destroyed = !b1 && post.runStats.buddyLost > pre.runStats.buddyLost;
  const carrier = carrierOf(post);
  const exposed = !!carrier && carrier.isAlive && !E.isCarrierArmored(post);
  const at: Pick<BuddyShip, "x" | "y"> = b1 ?? { x: b0.x + b0.vx * DT, y: b0.y + b0.vy * DT };
  const R = E.BUDDY_HURT_RADIUS + (b1 ? 0.5 : 6);

  // ── beams released while Buddy is in play: in its lane at release, and whether they hit ──
  if (b1) {
    for (const beam of post.carrierBeams) {
      if (tr.beamSeen.has(beam.id)) continue;
      tr.beamSeen.add(beam.id);
      tr.beamCounted.add(beam.id);
      rec.beams++;
      if (Math.abs(beam.x - b1.x) < beam.halfWidth + E.BUDDY_HURT_RADIUS + LANE_PAD)
        rec.beamsInLane++;
    }
  }
  // ── Carrier geometry vs Buddy (on station, Carrier exposed) ──
  if (b1 && b1.phase === "OnStation" && exposed && carrier) {
    rec.onStationMs += DT;
    if (Math.abs(b1.x - carrier.x) < E.BEAM_HALF_WIDTH + E.BUDDY_HURT_RADIUS) rec.inLaneMs += DT;
    rec.gapSum += Math.hypot(b1.x - carrier.x, b1.y - carrier.y);
    rec.gapTicks++;
    const running = carrier.phase === "AttackRun";
    if (running && !tr.runActive) {
      tr.runActive = true;
      tr.runMin = Infinity;
      rec.runs++;
    }
    if (running) tr.runMin = Math.min(tr.runMin, Math.hypot(b1.x - carrier.x, b1.y - carrier.y));
  }
  if (tr.runActive && (!carrier || carrier.phase !== "AttackRun" || !b1)) {
    tr.runActive = false;
    if (Number.isFinite(tr.runMin)) {
      rec.runMinDistSum += tr.runMin;
      if (tr.runMin < 120) rec.runsClose++;
    }
  }
  for (const beam of post.carrierBeams) tr.beamSeen.add(beam.id);

  // ── what hit Buddy this tick ──
  const hpDrop = destroyed ? b0.hp : b1 ? b0.hp - b1.hp : 0;
  if (hpDrop <= 0) return;
  const postShots = new Set(post.enemyBullets.map((b) => b.id));
  const got: Partial<Record<BuddyKiller, number>> = {};
  let attributed = 0;
  for (const s of pre.enemyBullets) {
    if (postShots.has(s.id)) continue;
    const x = s.x + s.vx * DT;
    const y = s.y + s.vy * DT;
    if (!E.collideCircleAABB(at.x, at.y, R, x, y, s.width, s.height)) continue;
    const tier = tr.shooter.get(s.id) ?? "Grunt";
    const k: BuddyKiller = tier === "Carrier" ? "carrierTwin" : tier;
    got[k] = (got[k] ?? 0) + s.damage;
    attributed += s.damage;
    if (tr.drawnIds.has(s.id)) rec.drawnHit[tier]++;
    else rec.strayHits++;
  }
  const postBeams = new Set(post.carrierBeams.map((b) => b.id));
  for (const beam of pre.carrierBeams) {
    if (postBeams.has(beam.id)) continue;
    const y = beam.y + beam.vy * DT;
    const hit = E.collideCircleAABB(
      at.x,
      at.y,
      R,
      beam.x,
      y - beam.length / 2,
      beam.halfWidth * 2,
      beam.length
    );
    if (!hit) continue;
    got.beam = (got.beam ?? 0) + E.BUDDY_BEAM_DAMAGE;
    attributed += E.BUDDY_BEAM_DAMAGE;
    if (tr.beamCounted.has(beam.id)) rec.beamHits++;
  }
  const rocksBefore = new Set(b0.hitRockIds);
  const newRocks = b1
    ? b1.hitRockIds.filter((id) => !rocksBefore.has(id)).length
    : Math.max(0, Math.ceil((hpDrop - attributed) / E.BUDDY_ROCK_DAMAGE));
  if (newRocks > 0) {
    got.rock = (got.rock ?? 0) + newRocks * E.BUDDY_ROCK_DAMAGE;
    attributed += newRocks * E.BUDDY_ROCK_DAMAGE;
  }
  for (const [k, v] of Object.entries(got) as [BuddyKiller, number][]) rec.damageTaken[k] += v;
  if (attributed < hpDrop) rec.attributionMisses += hpDrop - attributed;
  if (destroyed) {
    let best: BuddyKiller | null = null;
    let bestV = -1;
    for (const k of KILLERS) {
      const v = got[k] ?? 0;
      if (v > bestV) {
        bestV = v;
        best = k;
      }
    }
    rec.killer = bestV > 0 ? best : null;
  }
}

/** Play one seed: to the launch point, then the with- and without-Buddy branches. */
export function runOne(E: Engine, spec: RunSpec): RunRecord {
  const wave = SCENARIO_WAVE[spec.scenario];
  E._resetIds();
  let s = E.initStarSwarm(E.CANVAS_W, E.CANVAS_H, wave, spec.seed, spec.difficulty);
  s = { ...s, player: { ...s.player, guns: spec.pilot.guns } };
  const initialCount = s.enemies.length;
  let ps = newPilot(s.player.x);
  let t = 0;
  while (!launchReady(E, s, spec, initialCount)) {
    if (t > PRE_MAX_MS || s.phase === "Extraction" || s.phase === "GameOver" || carrierDead(s)) {
      return emptyRecord(spec, false, false);
    }
    s = simTick(E, s, ps, spec.pilot, true).next;
    t += DT;
  }
  const fork = s;
  const counters = E.engineCounters();
  const pilotFork = clonePilot(ps);
  const rec = emptyRecord(spec, true, !E.isCarrierArmored(fork));
  const fleet = fork.enemies.filter((e) => e.isAlive);
  rec.fleetAtLaunch = fleet.length;
  const formationIds = new Set(fleet.filter((e) => e.tier !== "Carrier").map((e) => e.id));
  // Carrier time-to-kill is followed where it means something: from a launch at exposure or on a
  // boss wave. Not from a mid-wave or wave-start launch on an ordinary wave (it would measure the
  // whole wave), and not in a duel (the player isn't shooting, so there is no control branch).
  const followTtk =
    (spec.scenario.startsWith("boss") || spec.scenario === "normal-exposed") &&
    spec.pilot.fireAfterLaunch;

  // ── branch A: with Buddy ──
  s = E.applyPowerUp(fork, "buddy");
  const buddy = s.buddyShips[s.buddyShips.length - 1];
  if (!buddy) throw new Error("balance sim: applyPowerUp did not launch a Buddy");
  const buddyId = buddy.id;
  const tr: Tracker = {
    shooter: new Map(),
    drawnIds: new Set(),
    beamSeen: new Set(fork.carrierBeams.map((b) => b.id)),
    beamCounted: new Set(),
    runActive: false,
    runMin: Infinity,
    burstOf: new Map(),
    bursts: 0,
  };
  for (const b of fork.enemyBullets) tr.shooter.set(b.id, shooterTier(fork, b));
  let sortieOver = false;
  let lastHp = buddy.hp;
  for (t = 0; t < POST_MAX_MS; t += DT) {
    const r = simTick(E, s, ps, spec.pilot, spec.pilot.fireAfterLaunch);
    // the sortie window runs until Buddy is gone plus TAIL_MS, so its last fan's shots count
    const inWindow = !sortieOver || t <= rec.sortieMs + TAIL_MS;
    observe(E, s, r.next, rec, tr, buddyId, inWindow);
    if (inWindow) {
      const alive = r.next.enemies.filter((e) => e.isAlive);
      rec.waveCleared = alive.length === 0 || r.next.wave !== wave;
      rec.formationCleared =
        rec.waveCleared || !alive.some((e) => formationIds.has(e.id) && e.tier !== "Carrier");
    }
    if (!sortieOver) rec.playerHitsWith += r.hits;
    const b1 = r.next.buddyShips.find((b) => b.id === buddyId);
    if (b1) lastHp = b1.hp;
    if (!sortieOver && !b1) {
      sortieOver = true;
      rec.sortieMs = t + DT;
      rec.destroyed = r.next.runStats.buddyLost > s.runStats.buddyLost;
      rec.hpEnd = rec.destroyed ? 0 : lastHp;
    }
    if (rec.ttkWith === null && carrierDead(r.next)) rec.ttkWith = t + DT;
    s = r.next;
    if (!sortieOver) continue;
    if (rec.ttkWith !== null || s.wave !== wave) break;
    // no time-to-kill to follow: let the last shots in flight land, then stop
    if (!followTtk && t > rec.sortieMs + TAIL_MS) break;
  }
  if (!sortieOver) {
    rec.sortieMs = POST_MAX_MS;
    rec.hpEnd = lastHp;
  }

  // ── branch B: the same state and counters, no Buddy ──
  if (!spec.skipControl && spec.pilot.fireAfterLaunch) {
    E._resetIds();
    E.restoreEngineCounters(counters);
    s = fork;
    ps = pilotFork;
    for (t = 0; t < POST_MAX_MS; t += DT) {
      const r = simTick(E, s, ps, spec.pilot, true);
      if (t < rec.sortieMs) rec.playerHitsWithout += r.hits;
      s = r.next;
      if (rec.ttkWithout === null && carrierDead(s)) rec.ttkWithout = t + DT;
      if (t < rec.sortieMs) continue;
      if (!followTtk || rec.ttkWithout !== null || s.wave !== wave) break;
    }
  }
  return rec;
}

// ---------------------------------------------------------------------------
// Aggregation and reporting
// ---------------------------------------------------------------------------

export interface CellSummary {
  readonly key: string;
  readonly scenario: Scenario;
  readonly difficulty: DifficultyTier;
  readonly pilot: string;
  readonly variant: string;
  readonly n: number;
  readonly reached: number;
  readonly destroyedPct: number;
  readonly killerPct: Record<BuddyKiller, number>;
  readonly hpMean: number;
  readonly hpP10: number;
  readonly hpP50: number;
  readonly drawnPerSortie: TierCount;
  readonly drawnHitPct: number;
  readonly carrierDrawnHitPct: number;
  readonly strayHitsPerSortie: number;
  readonly buddyDamageShare: number;
  readonly buddyKillsPerSortie: number;
  /** Buddy kills per attack run (run 1, 2, 3). */
  readonly killsByRun: readonly number[];
  readonly fleetAtLaunch: number;
  /** Share of the fleet alive at launch that Buddy destroyed: mean, p90, max. */
  readonly fleetFracMean: number;
  readonly fleetFracP90: number;
  readonly fleetFracMax: number;
  readonly waveClearedPct: number;
  readonly formationClearedPct: number;
  readonly buddyCarrierDamage: number;
  readonly buddyCarrierShare: number;
  readonly carrierKillByBuddyPct: number;
  readonly beamsPerSortie: number;
  readonly beamInLanePct: number;
  readonly beamHitPct: number;
  readonly runsPerSortie: number;
  readonly runClosePct: number;
  readonly runMinDist: number;
  readonly inLanePct: number;
  readonly meanGap: number;
  readonly ttkWithP50: number | null;
  readonly ttkWithoutP50: number | null;
  readonly ttkRatio: number | null;
  readonly playerHitsWith: number;
  readonly playerHitsWithout: number;
  readonly sortieMs: number;
  readonly attributionMisses: number;
}

function mean(xs: readonly number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

function quantile(xs: readonly number[], q: number): number {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const i = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))));
  return sorted[i]!;
}

/** Median of a time-to-kill list where null (not dead by the cap) counts as +∞. */
function ttkMedian(xs: readonly (number | null)[]): number | null {
  const v = xs.map((x) => (x === null ? Infinity : x));
  const m = quantile(v, 0.5);
  return Number.isFinite(m) ? m : null;
}

const sumTiers = (rs: readonly RunRecord[], f: (r: RunRecord) => TierCount): TierCount => {
  const out = zeroTiers();
  for (const r of rs) for (const t of TIERS) out[t] += f(r)[t];
  return out;
};

export function cellKey(
  r: Pick<RunRecord, "scenario" | "difficulty" | "pilot" | "variant">
): string {
  return `${r.variant}|${r.pilot}|${r.scenario}|${r.difficulty}`;
}

export function summarize(records: readonly RunRecord[]): CellSummary[] {
  const groups = new Map<string, RunRecord[]>();
  for (const r of records) {
    const k = cellKey(r);
    const g = groups.get(k);
    if (g) g.push(r);
    else groups.set(k, [r]);
  }
  const out: CellSummary[] = [];
  for (const [key, all] of groups) {
    const rs = all.filter((r) => r.reached);
    const n = rs.length || 1;
    const destroyed = rs.filter((r) => r.destroyed);
    const killerPct = Object.fromEntries(
      KILLERS.map((k) => [
        k,
        destroyed.length ? destroyed.filter((r) => r.killer === k).length / destroyed.length : 0,
      ])
    ) as Record<BuddyKiller, number>;
    const drawn = sumTiers(rs, (r) => r.drawn);
    const drawnHit = sumTiers(rs, (r) => r.drawnHit);
    const drawnTotal = TIERS.reduce((a, t) => a + drawn[t], 0);
    const hitTotal = TIERS.reduce((a, t) => a + drawnHit[t], 0);
    const bd = rs.reduce((a, r) => a + r.buddyDamage, 0);
    const pd = rs.reduce((a, r) => a + r.playerDamage, 0);
    const cd = rs.reduce((a, r) => a + r.carrierDamageTotal, 0);
    const bcd = rs.reduce((a, r) => a + r.buddyCarrierDamage, 0);
    const beams = rs.reduce((a, r) => a + r.beams, 0);
    const runs = rs.reduce((a, r) => a + r.runs, 0);
    const onSt = rs.reduce((a, r) => a + r.onStationMs, 0);
    const gapTicks = rs.reduce((a, r) => a + r.gapTicks, 0);
    const withT = rs.map((r) => r.ttkWith);
    const withoutT = rs.map((r) => r.ttkWithout);
    const w50 = ttkMedian(withT);
    const wo50 = rs.some((r) => r.ttkWithout !== null) ? ttkMedian(withoutT) : null;
    const hp = rs.map((r) => r.hpEnd);
    const fleetFrac = rs.map((r) =>
      r.fleetAtLaunch ? TIERS.reduce((a, t) => a + r.buddyKills[t], 0) / r.fleetAtLaunch : 0
    );
    const first = all[0]!;
    out.push({
      key,
      scenario: first.scenario,
      difficulty: first.difficulty,
      pilot: first.pilot,
      variant: first.variant,
      n: all.length,
      reached: rs.length,
      destroyedPct: destroyed.length / n,
      killerPct,
      hpMean: mean(hp),
      hpP10: quantile(hp, 0.1),
      hpP50: quantile(hp, 0.5),
      drawnPerSortie: Object.fromEntries(TIERS.map((t) => [t, drawn[t] / n])) as TierCount,
      drawnHitPct: drawnTotal ? hitTotal / drawnTotal : 0,
      carrierDrawnHitPct: drawn.Carrier ? drawnHit.Carrier / drawn.Carrier : 0,
      strayHitsPerSortie: rs.reduce((a, r) => a + r.strayHits, 0) / n,
      buddyDamageShare: bd + pd ? bd / (bd + pd) : 0,
      buddyKillsPerSortie:
        rs.reduce((a, r) => a + TIERS.reduce((b, t) => b + r.buddyKills[t], 0), 0) / n,
      killsByRun: [0, 1, 2].map((i) => rs.reduce((a, r) => a + (r.killsByRun[i] ?? 0), 0) / n),
      fleetAtLaunch: mean(rs.map((r) => r.fleetAtLaunch)),
      fleetFracMean: mean(fleetFrac),
      fleetFracP90: quantile(fleetFrac, 0.9),
      fleetFracMax: quantile(fleetFrac, 1),
      waveClearedPct: rs.filter((r) => r.waveCleared).length / n,
      formationClearedPct: rs.filter((r) => r.formationCleared).length / n,
      buddyCarrierDamage: bcd / n,
      buddyCarrierShare: cd ? bcd / cd : 0,
      carrierKillByBuddyPct: rs.filter((r) => r.carrierKilledByBuddy).length / n,
      beamsPerSortie: beams / n,
      beamInLanePct: beams ? rs.reduce((a, r) => a + r.beamsInLane, 0) / beams : 0,
      beamHitPct: beams ? rs.reduce((a, r) => a + r.beamHits, 0) / beams : 0,
      runsPerSortie: runs / n,
      runClosePct: runs ? rs.reduce((a, r) => a + r.runsClose, 0) / runs : 0,
      runMinDist: runs ? rs.reduce((a, r) => a + r.runMinDistSum, 0) / runs : 0,
      inLanePct: onSt ? rs.reduce((a, r) => a + r.inLaneMs, 0) / onSt : 0,
      meanGap: gapTicks ? rs.reduce((a, r) => a + r.gapSum, 0) / gapTicks : 0,
      ttkWithP50: w50,
      ttkWithoutP50: wo50,
      ttkRatio: w50 !== null && wo50 !== null && wo50 > 0 ? w50 / wo50 : null,
      playerHitsWith: rs.reduce((a, r) => a + r.playerHitsWith, 0) / n,
      playerHitsWithout: rs.reduce((a, r) => a + r.playerHitsWithout, 0) / n,
      sortieMs: mean(rs.map((r) => r.sortieMs)),
      attributionMisses: rs.reduce((a, r) => a + r.attributionMisses, 0),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Cells — the gate-ready entry point (pure, deterministic, no output)
// ---------------------------------------------------------------------------

/** Root of every sim seed (#2880). */
export const SIM_SEED = 2880;

/**
 * The i-th engine seed of a cell. Hashed, never `base + i`: the engine's LCG makes consecutive
 * seeds' first draws nearly identical (see _shared/simRandom.ts). The same i gives the same seed
 * in every scenario, difficulty and variant, so variants are compared on the same seeds.
 */
export function cellSeed(i: number, seedBase = 0): number {
  return deriveSeed(SIM_SEED, seedBase, i);
}

export interface CellSpec {
  readonly scenario: Scenario;
  readonly difficulty: DifficultyTier;
  readonly pilot: PilotConfig;
  /** Label of the engine variant (the caller supplies the matching engine). */
  readonly variant: string;
  readonly seeds: number;
  /** Seed-set selector (default 0); a different base gives an independent seed set. */
  readonly seedBase?: number;
  /** Run only seeds i with i % shards === shard (parallel runs; merge the records after). */
  readonly shard?: number;
  readonly shards?: number;
}

/** Every run of one cell, in seed order. */
export function runCell(E: Engine, cell: CellSpec): RunRecord[] {
  const shards = cell.shards ?? 1;
  const out: RunRecord[] = [];
  for (let i = cell.shard ?? 0; i < cell.seeds; i += shards) {
    out.push(
      runOne(E, {
        scenario: cell.scenario,
        difficulty: cell.difficulty,
        pilot: cell.pilot,
        variant: cell.variant,
        seed: cellSeed(i, cell.seedBase),
      })
    );
  }
  return out;
}

/** One cell's metrics: the plain object a gate compares against a baseline band. */
export function measureCell(E: Engine, cell: CellSpec): CellSummary {
  const [summary] = summarize(runCell(E, cell));
  if (!summary) throw new Error("balance sim: a cell needs at least one seed");
  return summary;
}
