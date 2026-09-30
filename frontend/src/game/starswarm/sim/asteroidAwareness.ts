/**
 * #2881 investigation: a seeded headless sim over the REAL engine `tick()` that measures how each
 * enemy phase responds to an asteroid aimed straight at it. Not shipped to players; nothing in the
 * game imports this file.
 *
 * Protocol per trial (seed x difficulty x tier x phase): settle a wave, park every gun/dive/rout
 * rule, force ONE target ship into the phase under test, then inject a large rock on a course to
 * hit where the ship will be (on its Bezier path for path phases) 0.8-1.4 s later. The engine is
 * then ticked and the target's state is diffed tick to tick. Events are attributed to the phase the
 * ship was in at the start of the tick in which they happened.
 *
 * A CONTROL run (dodge + flak disabled) with the same seed says how often that rock would have hit
 * an unreacting ship, so "avoided" = 1 - hit/controlHit. An optional PROPOSAL policy is applied
 * between ticks, from outside the engine, to estimate the effect of the #2881 diver reactions.
 */
import {
  CANVAS_H,
  CANVAS_W,
  FLAK_BASE,
  FLAK_COOLDOWN,
  ASTEROID_ATTENTION,
  WIGGLE_DURATION,
  asteroidThreatens,
  difficultyParamScale,
  enemyThreatCircle,
  initStarSwarm,
  seedRng,
  splitRemaining,
  tick,
} from "../engine";
import { createStream, deriveSeed } from "../../_shared/simRandom";
import type {
  Asteroid,
  Bullet,
  CubicBezier,
  DifficultyTier,
  Enemy,
  EnemyTier,
  StarSwarmInput,
  StarSwarmState,
} from "../types";

export type SimPhase = "Formation" | "Wiggling" | "Diving" | "Circling" | "Returning" | "Fleeing";
export interface SimCell {
  readonly tier: EnemyTier;
  readonly phase: SimPhase;
}

/** Every (tier, phase) the engine can actually put a ship in and this sim can force. */
export const SIM_CELLS: readonly SimCell[] = [
  ...(["Grunt", "Elite", "Guardian"] as const).flatMap((tier) =>
    (["Formation", "Wiggling", "Diving", "Returning"] as const).map((phase) => ({ tier, phase }))
  ),
  { tier: "Elite", phase: "Circling" },
  { tier: "Guardian", phase: "Circling" },
  { tier: "Grunt", phase: "Fleeing" },
  { tier: "Carrier", phase: "Formation" }, // exposed (no Guardian left); armored is immune by design
];

/** Between-tick reactions layered over the engine for divers (#2881 proposal). Sim-only. */
export interface DiverPolicy {
  readonly name: string;
  /** Phases the policy acts in. */
  readonly phases: readonly SimPhase[];
  /** Chance a threatened ship flinches (evade window => aim degrade + visible cue), by tier. */
  readonly flinch: Readonly<Record<EnemyTier, number>>;
  readonly flinchMs: number;
  /** Multiplier on the engine's FLAK_BASE for a diver firing flak at the rock (pays flakMs). */
  readonly flakFactor: number;
  /** When the engine's own dodge roll failed: chance of a late partial nudge, by tier. */
  readonly lateNudge: Readonly<Record<EnemyTier, number>>;
  /** Control-point shift (px) of that late nudge. p0 and p3 are untouched, so the dive stays committed. */
  readonly nudgePx: number;
}

export const PROPOSED_POLICY: DiverPolicy = {
  name: "proposal",
  phases: ["Diving", "Returning", "Circling", "Fleeing"],
  flinch: { Grunt: 1, Elite: 0.85, Guardian: 0.6, Carrier: 0 },
  flinchMs: 450,
  flakFactor: 0.8,
  lateNudge: { Grunt: 0.35, Elite: 0.5, Guardian: 0.6, Carrier: 0 },
  nudgePx: 60,
};

export interface TrialResult {
  readonly cell: SimCell;
  readonly seed: number;
  /** Engine marked the ship threatened (rolledAsteroidIds gained the rock), or the policy did. */
  readonly threatened: boolean;
  readonly threatPhase: SimPhase | null;
  readonly warnMs: number | null; // detection to the rock reaching the ship: the ship's warning
  readonly distracted: boolean; // attentionMs debt booked for this rock (threat or flak cost)
  readonly flak: boolean;
  readonly dodged: boolean; // a sidestep / path nudge happened (evadeMs raised)
  readonly pathNudged: boolean;
  readonly flinched: boolean; // proposal only
  readonly evadedShots: number; // player-directed shots fired while evading (aim degraded)
  readonly hit: boolean;
  readonly hitPhase: SimPhase | null;
}

const DT = 16;
const PARK = 1e9;
const ASIDE: StarSwarmInput = { playerX: 40, fire: false };
const ROCK_SPEED = 0.18; // px/ms, inside the engine's ASTEROID_SPEED_MIN..MAX
const TAIL_MS = 450; // keep ticking this long after the rock would have arrived

function cubic(c: CubicBezier, t: number): { x: number; y: number } {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const d = 3 * u * t * t;
  const e = t * t * t;
  return {
    x: a * c.p0.x + b * c.p1.x + d * c.p2.x + e * c.p3.x,
    y: a * c.p0.y + b * c.p1.y + d * c.p2.y + e * c.p3.y,
  };
}

const patch = (s: StarSwarmState, id: number, p: Partial<Enemy>): StarSwarmState => ({
  ...s,
  enemies: s.enemies.map((e) => (e.id === id ? { ...e, ...p } : e)),
});
const find = (s: StarSwarmState, id: number): Enemy | undefined =>
  s.enemies.find((e) => e.id === id);

const waveCache = new Map<string, StarSwarmState>();

/** A settled, parked wave: nothing dives, fires, routs, spawns rocks or hurts the player. */
function settledWave(seed: number, difficulty: DifficultyTier): StarSwarmState {
  // state is immutable, so every cell/mode of one (seed, difficulty) can share the swoop-in
  const key = `${seed}/${difficulty}`;
  const hit = waveCache.get(key);
  if (hit) return hit;
  if (waveCache.size > 64) waveCache.clear();
  let s = initStarSwarm(CANVAS_W, CANVAS_H, 3, seed, difficulty);
  s = { ...s, asteroidsDisabled: true };
  while (s.phase === "SwoopIn") s = tick(s, DT, ASIDE);
  const parked: StarSwarmState = {
    ...s,
    enemyBullets: [],
    explosions: [],
    nextDiveTimer: PARK,
    pauseStraggler: true,
    routDisabled: true,
    playerFireDisabled: true,
    player: { ...s.player, x: 40, invincibleTimer: PARK },
    enemies: s.enemies.map((e) => ({ ...e, shootTimer: PARK })),
  };
  waveCache.set(key, parked);
  return parked;
}

/** Where the ship will be `ms` from now, by the ship's own motion model. */
function futurePos(e: Enemy, ms: number): { x: number; y: number } {
  if (e.path && (e.phase === "Diving" || e.phase === "Returning" || e.phase === "Fleeing")) {
    return cubic(e.path, Math.max(0, Math.min(1, e.pathT + ms / e.pathDuration)));
  }
  if (e.phase === "Circling") {
    const a = e.circleAngle + e.circleSpeed * ms;
    return {
      x: e.circleCx + Math.cos(a) * e.circleRadius,
      y: e.circleCy + Math.sin(a) * e.circleRadius,
    };
  }
  return { x: e.x, y: e.y };
}

function aimedRock(e: Enemy, arriveMs: number, rand: () => number, id: number): Asteroid {
  const target = futurePos(e, arriveMs);
  const theta = (rand() * 2 - 1) * 1.0; // rad off straight-down
  const vx = Math.sin(theta) * ROCK_SPEED;
  const vy = Math.cos(theta) * ROCK_SPEED;
  return {
    id,
    kind: "large",
    x: target.x - vx * arriveMs,
    y: target.y - vy * arriveMs,
    vx,
    vy,
    radius: 22,
    hp: 6,
    rotation: 0,
    spin: 0,
    hitFlashTimer: 0,
    hitEnemyIds: [],
  };
}

/** Force the chosen ship into `phase` using only the engine's own transitions where possible. */
function forcePhase(s0: StarSwarmState, id: number, cell: SimCell): StarSwarmState | null {
  let s = s0;
  const { tier, phase } = cell;
  if (phase === "Circling" || (tier === "Guardian" && phase !== "Returning")) {
    s = {
      ...s,
      guardianThresholdCrossed: true,
      guardianDeepThresholdCrossed: phase === "Circling",
    };
  } else if (tier === "Guardian" && phase === "Returning") {
    s = { ...s, guardianThresholdCrossed: true, guardianDeepThresholdCrossed: false };
  }
  if (phase === "Fleeing") s = { ...s, routed: true };
  if (tier === "Carrier") {
    s = {
      ...s,
      enemies: s.enemies.map((e) => (e.tier === "Guardian" ? { ...e, isAlive: false, hp: 0 } : e)),
    };
  }
  if (phase === "Formation") return s;
  if (phase === "Wiggling") {
    return patch(s, id, { phase: "Wiggling", wiggleTimer: WIGGLE_DURATION, diveTargetX: 40 });
  }
  if (phase !== "Fleeing") s = patch(s, id, { phase: "Wiggling", wiggleTimer: 1, diveTargetX: 40 });
  for (let i = 0; i < 400; i++) {
    const e = find(s, id);
    if (!e || !e.isAlive) return null;
    if (e.phase === phase && (phase !== "Fleeing" || e.pathT >= 0)) return s;
    s = tick(s, DT, ASIDE);
  }
  return null;
}

export function runTrial(
  seed: number,
  difficulty: DifficultyTier,
  cell: SimCell,
  mode: "live" | "control" | "policy",
  policy: DiverPolicy = PROPOSED_POLICY
): TrialResult | null {
  const rand = createStream(deriveSeed(seed, difficulty.length, 1));
  let s = settledWave(seed, difficulty);
  seedRng(deriveSeed(seed, difficulty.length, 2)); // the engine's own stream, identical for control / live / policy
  const pool = s.enemies.filter(
    (e) => e.isAlive && e.tier === cell.tier && e.phase === "Formation"
  );
  if (pool.length === 0) return null;
  const id = pool[Math.floor(rand() * pool.length)]!.id;
  const forced = forcePhase(s, id, cell);
  if (!forced) return null;
  s = forced;
  if (mode === "control") s = { ...s, dodgeDisabled: true, flakDisabled: true };
  // let the target fire during the window so distraction / aim degrade have something to act on
  s = patch(s, id, { shootTimer: cell.phase === "Formation" ? 250 : 500 });

  const arriveMs = cell.phase === "Wiggling" ? 250 + rand() * 80 : 800 + rand() * 600;
  const rock = aimedRock(find(s, id)!, arriveMs, rand, 990_001);
  s = { ...s, asteroids: [rock] };

  const out = {
    threatened: false,
    threatPhase: null as SimPhase | null,
    warnMs: null as number | null,
    distracted: false,
    flak: false,
    dodged: false,
    pathNudged: false,
    flinched: false,
    evadedShots: 0,
    hit: false,
    hitPhase: null as SimPhase | null,
  };
  let policyDone = false;
  const scale = difficultyParamScale(difficulty);

  for (let t = 0; t < arriveMs + TAIL_MS; t += DT) {
    const prev = find(s, id)!;
    const prevBullets = new Set(s.enemyBullets.map((b) => b.id));
    const prevFlakStat = s.tierStats[cell.tier].flak;
    s = tick(s, DT, ASIDE);
    const cur = find(s, id);
    if (!cur) break;
    const ph = prev.phase as SimPhase;

    if (
      !out.threatened &&
      cur.rolledAsteroidIds.includes(rock.id) &&
      !prev.rolledAsteroidIds.includes(rock.id)
    ) {
      out.threatened = true;
      out.threatPhase = ph;
      out.warnMs = arriveMs - t;
    }
    if (cur.attentionMs > Math.max(0, prev.attentionMs - DT) + 1) out.distracted = true;
    if (cell.tier === "Carrier") {
      if (s.tierStats.Carrier.flak > prevFlakStat) out.flak = true;
    } else if (cur.flakCooldown > prev.flakCooldown) out.flak = true;
    if (cur.evadeMs > prev.evadeMs) {
      out.dodged = true;
      if (cur.path !== prev.path) out.pathNudged = true;
    }
    if (prev.evadeMs > 0) {
      const fresh = s.enemyBullets.filter(
        (b: Bullet) =>
          !prevBullets.has(b.id) && !b.flak && Math.hypot(b.x - prev.x, b.y - prev.y) < 40
      );
      out.evadedShots += fresh.length;
    }
    if (!cur.isAlive || cur.hp < prev.hp) {
      out.hit = true;
      out.hitPhase = ph;
      break;
    }

    // ---- proposal policy: reactions the engine does not give divers, applied from outside ----
    if (mode === "policy" && !policyDone && policy.phases.includes(cur.phase as SimPhase)) {
      const r = s.asteroids.find((a) => a.id === rock.id);
      // the engine's own flag covers moving divers; asteroidThreatens (static ship) covers Circling
      if (r && (out.threatened || asteroidThreatens(r, enemyThreatCircle(cur), 700))) {
        policyDone = true;
        let e: Enemy = cur;
        const engineDodged = out.dodged;
        if (!out.threatened) {
          // Circling is skipped by the engine entirely: pay the threat distraction ourselves
          const cost = ASTEROID_ATTENTION[e.tier].threatMs;
          e = { ...e, shootTimer: e.shootTimer + cost, attentionMs: e.attentionMs + cost };
          out.threatened = true;
          out.threatPhase = e.phase as SimPhase;
          out.warnMs = arriveMs - t;
          out.distracted = true;
        }
        if (rand() < policy.flinch[e.tier]) {
          e = { ...e, evadeMs: Math.max(e.evadeMs, policy.flinchMs) };
          out.flinched = true;
        }
        if (
          e.flakCooldown <= 0 &&
          rand() < Math.min(1.3, scale) * FLAK_BASE[e.tier] * policy.flakFactor
        ) {
          const tx = r.x + r.vx * 300;
          const ty = r.y + r.vy * 300;
          const len = Math.hypot(tx - e.x, ty - e.y) || 1;
          const flak: Bullet = {
            id: 980_000 + t,
            x: e.x,
            y: e.y,
            vx: ((tx - e.x) / len) * 0.42,
            vy: ((ty - e.y) / len) * 0.42,
            owner: "enemy",
            width: 4,
            height: 8,
            damage: 1,
            flak: true,
          };
          const cost = ASTEROID_ATTENTION[e.tier].flakMs; // finite capacity: flak displaces a shot
          e = {
            ...e,
            flakCooldown: FLAK_COOLDOWN,
            shootTimer: e.shootTimer + cost,
            attentionMs: e.attentionMs + cost,
          };
          s = { ...s, enemyBullets: [...s.enemyBullets, flak] };
          out.flak = true;
        }
        if (
          !engineDodged &&
          e.path &&
          e.pathT >= 0 &&
          e.pathT < 1 &&
          rand() < policy.lateNudge[e.tier]
        ) {
          const dir = e.x < r.x + r.vx * 400 ? -1 : 1;
          const rest = splitRemaining(e.path, e.pathT);
          const nudged: CubicBezier = {
            p0: rest.p0,
            p1: { x: rest.p1.x + dir * policy.nudgePx, y: rest.p1.y },
            p2: { x: rest.p2.x + dir * policy.nudgePx, y: rest.p2.y },
            p3: rest.p3,
          };
          e = { ...e, path: nudged, pathT: 0, pathDuration: e.pathDuration * (1 - e.pathT) };
          out.pathNudged = true;
          out.dodged = true;
        }
        s = patch(s, id, e);
      }
    }
    if (!s.asteroids.some((a) => a.id === rock.id)) break;
  }
  return { cell, seed, ...out };
}

/** Rates for one (tier, phase) cell over `n` valid trials. All 0..1 except counts and ms. */
export interface RateSet {
  readonly n: number;
  readonly threatened: number; // the ship noticed the rock (engine flag; the policy's in policy mode)
  readonly distracted: number; // paid attention debt
  readonly flak: number;
  readonly dodged: number; // sidestep or path nudge happened
  readonly nudged: number; // ... of which a path nudge
  readonly flinched: number;
  readonly hit: number; // collided with the rock
  readonly hitGivenDodged: number | null; // a "successful" dodge that still collided
  readonly hitGivenNotDodged: number | null;
  readonly shotsWhileEvading: number; // player-directed shots fired with aim degraded, per trial
  readonly medianWarnMs: number | null;
}

export interface CellMetrics {
  readonly cell: SimCell;
  /** Dodge + flak off: how often the injected rock hits an unreacting ship (geometry check). */
  readonly controlHit: number;
  readonly live: RateSet;
  readonly policy: RateSet | null;
}

export interface AwarenessParams {
  readonly seeds: number;
  readonly difficulty: DifficultyTier;
  readonly cells?: readonly SimCell[];
  /** Also run the proposal (between-tick) layer over the same seeds. */
  readonly policy?: DiverPolicy | null;
}

export interface AwarenessMetrics {
  readonly params: { seeds: number; difficulty: DifficultyTier; policy: string | null };
  readonly cells: readonly CellMetrics[];
}

function rates(rs: readonly TrialResult[]): RateSet {
  const n = rs.length;
  const f = (p: (r: TrialResult) => boolean): number => (n === 0 ? 0 : rs.filter(p).length / n);
  const dodged = rs.filter((r) => r.dodged);
  const notDodged = rs.filter((r) => !r.dodged);
  const warns = rs
    .filter((r) => r.warnMs !== null)
    .map((r) => r.warnMs!)
    .sort((a, b) => a - b);
  return {
    n,
    threatened: f((r) => r.threatened),
    distracted: f((r) => r.distracted),
    flak: f((r) => r.flak),
    dodged: f((r) => r.dodged),
    nudged: f((r) => r.pathNudged),
    flinched: f((r) => r.flinched),
    hit: f((r) => r.hit),
    hitGivenDodged: dodged.length ? dodged.filter((r) => r.hit).length / dodged.length : null,
    hitGivenNotDodged: notDodged.length
      ? notDodged.filter((r) => r.hit).length / notDodged.length
      : null,
    shotsWhileEvading: n === 0 ? 0 : rs.reduce((a, r) => a + r.evadedShots, 0) / n,
    medianWarnMs: warns.length ? Math.round(warns[Math.floor(warns.length / 2)]!) : null,
  };
}

/**
 * The entry point a future gate calls: pure and deterministic for (seeds, difficulty, cells,
 * policy), prints nothing, returns plain data. Seeds are 1..seeds, hashed per trial.
 */
export function measureAwareness(params: AwarenessParams): AwarenessMetrics {
  const policy = params.policy ?? null;
  const cells: CellMetrics[] = [];
  for (const cell of params.cells ?? SIM_CELLS) {
    const control: TrialResult[] = [];
    const live: TrialResult[] = [];
    const prop: TrialResult[] = [];
    for (let seed = 1; seed <= params.seeds; seed++) {
      const c = runTrial(seed, params.difficulty, cell, "control");
      const l = runTrial(seed, params.difficulty, cell, "live");
      if (!c || !l) continue;
      control.push(c);
      live.push(l);
      if (policy) {
        const p = runTrial(seed, params.difficulty, cell, "policy", policy);
        if (p) prop.push(p);
      }
    }
    cells.push({
      cell,
      controlHit: control.length ? control.filter((r) => r.hit).length / control.length : 0,
      live: rates(live),
      policy: policy ? rates(prop) : null,
    });
  }
  waveCache.clear();
  return {
    params: { seeds: params.seeds, difficulty: params.difficulty, policy: policy?.name ?? null },
    cells,
  };
}

/** A cheap subset for the jest smoke test: one cell per behaviour class, a handful of seeds. */
export const FAST_PARAMS: AwarenessParams = {
  seeds: 6,
  difficulty: "LieutenantJG",
  policy: PROPOSED_POLICY,
  cells: [
    { tier: "Grunt", phase: "Formation" },
    { tier: "Grunt", phase: "Diving" },
    { tier: "Elite", phase: "Diving" },
    { tier: "Elite", phase: "Circling" },
  ],
};

const pct = (x: number | null): string => (x === null ? "-" : `${Math.round(100 * x)}%`);

/** Markdown table of one difficulty's metrics (`live` rows, then `proposal` rows when present). */
export function formatMetrics(m: AwarenessMetrics): string {
  const head =
    "| tier | phase | set | n | control hit | threatened | distracted | flak | dodge | nudge | flinch | hit | hit if dodged | hit if not | warn ms |\n" +
    "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|";
  const row = (c: CellMetrics, set: string, r: RateSet): string =>
    `| ${c.cell.tier} | ${c.cell.phase} | ${set} | ${r.n} | ${pct(c.controlHit)} | ${pct(r.threatened)} | ` +
    `${pct(r.distracted)} | ${pct(r.flak)} | ${pct(r.dodged)} | ${pct(r.nudged)} | ${pct(r.flinched)} | ` +
    `${pct(r.hit)} | ${pct(r.hitGivenDodged)} | ${pct(r.hitGivenNotDodged)} | ${r.medianWarnMs ?? "-"} |`;
  const lines = m.cells.flatMap((c) => [
    row(c, "live", c.live),
    ...(c.policy ? [row(c, m.params.policy ?? "policy", c.policy)] : []),
  ]);
  return [head, ...lines].join("\n");
}
