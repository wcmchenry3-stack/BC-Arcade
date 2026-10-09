/**
 * Star Swarm engine — asteroids (#2486, #2844) and the enemy response to them (#2487, #2881).
 *
 * Rocks are a neutral hazard: planned off-screen entries, timed spawns, bullets absorbed into
 * them, rocks ramming ships, splitting and salvage. The shared threat/collision contract
 * (`asteroidHits`, `asteroidThreatens`, …) is what every consumer — enemies, Buddy, the
 * extraction autopilot — asks. `tickAsteroidThreats` is the enemy side: attention costs,
 * dodge rolls, flak and the #2881 flinch/nudge reactions, all on the seeded `rng()`.
 */
import type {
  Asteroid,
  AsteroidKind,
  Bullet,
  Enemy,
  EnemyTier,
  Explosion,
  PowerUp,
  StarSwarmState,
  TierStats,
  Vec2,
} from "../types";
import { makePickup, spawnExplosion } from "./entities";
import { weaponsFree } from "./extraction";
import {
  circleCircle,
  collideCircleAABB,
  evalCubic,
  hashFrac,
  nudgePath,
  splitRemaining,
} from "./geometry";
import { nextId, rng } from "./rng";
import { mapFilterKeep, mapKeep, type TickCtx } from "./roster";
import { bumpRun, bumpStat, dodgeChance } from "./stats";
import {
  ASTEROID_ATTENTION,
  ASTEROID_ENTRY_ATTEMPTS,
  ASTEROID_ENTRY_EDGE,
  ASTEROID_HIT_FLASH_MS,
  ASTEROID_INTERVAL_MAX,
  ASTEROID_INTERVAL_MIN,
  ASTEROID_LARGE_CHANCE,
  ASTEROID_MIN_ANGLE,
  ASTEROID_MIN_CROSS_FRAC,
  ASTEROID_MIN_REACTION_MS,
  ASTEROID_MIN_WAVE,
  ASTEROID_SPEED_MAX,
  ASTEROID_SPEED_MIN,
  ASTEROID_STATS,
  BULLET_E_H,
  BULLET_E_W,
  DIVER_FLAK_FACTOR,
  DODGE_LOOKAHEAD_MS,
  DODGE_MARGIN,
  DODGE_PATH_NUDGE,
  DODGE_SIDESTEP,
  DODGE_SIDESTEP_MS,
  FLAK_BASE,
  FLAK_COOLDOWN,
  FLAK_LEAD_MS,
  FLAK_RANGE,
  FLAK_SCALE_CAP,
  FLAK_SPEED,
  FLINCH_CHANCE,
  FLINCH_MS,
  HIT_FLASH_DURATION,
  LATE_NUDGE_CHANCE,
  LATE_NUDGE_PX,
  MAX_ASTEROIDS,
  PLAYER_H,
  PLAYER_Y_FROM_BOTTOM,
  REACTION_PHASES,
  SALVAGE_DROP_CHANCE,
  isBossWave,
  type AsteroidAttention,
} from "./tuning";

// ---------------------------------------------------------------------------
// Asteroids (#2486)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Asteroids (#2486)
// ---------------------------------------------------------------------------

export function asteroidInterval(): number {
  return ASTEROID_INTERVAL_MIN + rng() * (ASTEROID_INTERVAL_MAX - ASTEROID_INTERVAL_MIN);
}

export function makeAsteroid(
  kind: AsteroidKind,
  x: number,
  y: number,
  vx: number,
  vy: number
): Asteroid {
  return {
    id: nextId(),
    kind,
    x,
    y,
    vx,
    vy,
    radius: ASTEROID_STATS[kind].radius,
    hp: ASTEROID_STATS[kind].hp,
    rotation: 0,
    spin: (rng() - 0.5) * 0.004,
    hitFlashTimer: 0,
    hitEnemyIds: [],
  };
}

// ── #2844 shared asteroid threat / collision contract ─────────────────────────────────────────
// Everything that needs to ask "is this rock a danger to that thing?" or "did it hit?" — enemies,
// the extraction autopilot and (#2845) Buddy — goes through these pure helpers, so the rules
// cannot drift between consumers. A "circle" is any ship or hitbox reduced to a centre + radius.

/** A thing a rock can threaten or strike: a centre, a radius, and optionally its own velocity (px/ms). */
export interface ThreatCircle {
  readonly x: number;
  readonly y: number;
  readonly r: number;
  readonly vx?: number;
  readonly vy?: number;
}

/** The part of a rock the contract reads — an `Asteroid` satisfies it. */
export type RockLike = Pick<Asteroid, "x" | "y" | "vx" | "vy" | "radius" | "hp">;

/** True when the rock's body overlaps the circle right now. A destroyed rock (hp <= 0) never does. */
export function asteroidHits(rock: RockLike, circle: ThreatCircle): boolean {
  if (rock.hp <= 0) return false;
  return circleCircle(rock.x, rock.y, rock.radius, circle.x, circle.y, circle.r);
}

/** Same as asteroidHits for a centred axis-aligned box (`width` × `height`) — how enemy ships are hit. */
export function asteroidHitsBox(
  rock: RockLike,
  box: { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
): boolean {
  if (rock.hp <= 0) return false;
  return collideCircleAABB(rock.x, rock.y, rock.radius, box.x, box.y, box.width, box.height);
}

/**
 * Will this rock's body reach the circle within `lookaheadMs`, both moving in straight lines at
 * their current velocities? Exact closest-approach over [0, lookaheadMs] (no sampling gaps), so a
 * fast rock cannot tunnel between checks. True if it already overlaps. `circle.r` should include
 * any safety margin the consumer wants; Buddy's "strong but imperfect" avoidance lives in how it
 * reacts to this, not in the test itself.
 */
export function asteroidThreatens(
  rock: RockLike,
  circle: ThreatCircle,
  lookaheadMs: number
): boolean {
  if (rock.hp <= 0) return false;
  const reach = rock.radius + circle.r;
  const px = rock.x - circle.x;
  const py = rock.y - circle.y;
  if (px * px + py * py <= reach * reach) return true;
  const vx = rock.vx - (circle.vx ?? 0);
  const vy = rock.vy - (circle.vy ?? 0);
  const v2 = vx * vx + vy * vy;
  if (v2 === 0) return false;
  const t = Math.max(0, Math.min(lookaheadMs, -(px * vx + py * vy) / v2));
  const cx = px + vx * t;
  const cy = py + vy * t;
  return cx * cx + cy * cy <= reach * reach;
}

/** A ship's hitbox as a threat circle (half the longer side). */
export function enemyThreatCircle(e: Pick<Enemy, "x" | "y" | "width" | "height">): ThreatCircle {
  return { x: e.x, y: e.y, r: Math.max(e.width, e.height) / 2 };
}

// ── #2844 entry geometry ──────────────────────────────────────────────────────────────────────

export type AsteroidEntryRegion = "left" | "right" | "top" | "topLeft" | "topRight";

export interface AsteroidEntry {
  readonly region: AsteroidEntryRegion;
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
}

/** Relative odds of each entry region: broad side edges, the top edge, and the upper corners. */
const ASTEROID_REGION_WEIGHTS: readonly (readonly [AsteroidEntryRegion, number])[] = [
  ["left", 0.28],
  ["right", 0.28],
  ["top", 0.26],
  ["topLeft", 0.09],
  ["topRight", 0.09],
];

/** How a candidate crossing measures up (see `asteroidEntryMetrics`). */
export interface AsteroidEntryMetrics {
  /** Path length (px) the rock's centre spends inside the canvas. */
  readonly crossPx: number;
  /** ms from the rock first touching the screen until it can reach the player's row; Infinity if never. */
  readonly reactionMs: number;
}

/**
 * Measure a trajectory by stepping it (20 ms) — pure, deterministic. The player row is where the
 * ship sits (`playerY`); "can reach" means the rock's edge gets down to the ship's top.
 */
export function asteroidEntryMetrics(
  entry: Pick<AsteroidEntry, "x" | "y" | "vx" | "vy">,
  radius: number,
  canvasW: number,
  canvasH: number
): AsteroidEntryMetrics {
  const STEP = 20;
  const speed = Math.hypot(entry.vx, entry.vy);
  const playerTop = canvasH - PLAYER_Y_FROM_BOTTOM - PLAYER_H / 2;
  let crossPx = 0;
  let enteredAt = -1;
  let reactionMs = Infinity;
  for (let t = 0; t <= 60_000; t += STEP) {
    const x = entry.x + entry.vx * t;
    const y = entry.y + entry.vy * t;
    const touching =
      x + radius > 0 && x - radius < canvasW && y + radius > 0 && y - radius < canvasH;
    if (touching && enteredAt < 0) enteredAt = t;
    if (x >= 0 && x <= canvasW && y >= 0 && y <= canvasH) crossPx += speed * STEP;
    if (enteredAt >= 0 && y + radius >= playerTop && x > -radius && x < canvasW + radius) {
      reactionMs = t - enteredAt;
      break;
    }
    if (enteredAt >= 0 && !touching) break; // left the screen without ever reaching the player row
    if (enteredAt < 0 && (y - radius > canvasH || x < -400 || x > canvasW + 400)) break;
  }
  return { crossPx, reactionMs };
}

/**
 * #2844: plan one rock's off-screen entry and crossing trajectory. Picks an entry region (a broad
 * left/right edge band, the top edge, or an upper corner), a point in the play space to cross, and
 * a speed; the rock starts fully off-screen and is aimed through that point. A candidate is
 * rejected unless it
 *  - points downward by at least ASTEROID_MIN_ANGLE (no flat skim),
 *  - spends at least ASTEROID_MIN_CROSS_FRAC × canvasWidth of path inside the field,
 *  - leaves at least ASTEROID_MIN_REACTION_MS before it can reach the player's row, and
 *  - does not start overlapping any of `actors` (ships waiting off-screen, for instance).
 * Up to ASTEROID_ENTRY_ATTEMPTS candidates are drawn from `rand`; returns null if none is fair.
 * Pure: the same `rand` stream yields the same plan, so seeded runs replay exactly.
 */
export function planAsteroidEntry(
  canvasW: number,
  canvasH: number,
  radius: number,
  actors: readonly ThreatCircle[],
  rand: () => number
): AsteroidEntry | null {
  const off = radius + ASTEROID_ENTRY_EDGE;
  const fair = (x: number, y: number, vx: number, vy: number): boolean => {
    if (Math.atan2(vy, Math.abs(vx)) < ASTEROID_MIN_ANGLE) return false;
    if (actors.some((a) => circleCircle(x, y, radius, a.x, a.y, a.r))) return false;
    const m = asteroidEntryMetrics({ x, y, vx, vy }, radius, canvasW, canvasH);
    return (
      m.crossPx >= ASTEROID_MIN_CROSS_FRAC * canvasW && m.reactionMs >= ASTEROID_MIN_REACTION_MS
    );
  };
  for (let attempt = 0; attempt < ASTEROID_ENTRY_ATTEMPTS; attempt++) {
    let pick = rand();
    let region: AsteroidEntryRegion = "left";
    for (const [r, w] of ASTEROID_REGION_WEIGHTS) {
      region = r;
      if (pick < w) break;
      pick -= w;
    }
    let x: number;
    let y: number;
    switch (region) {
      case "left":
        x = -off;
        y = canvasH * (0.04 + 0.5 * rand());
        break;
      case "right":
        x = canvasW + off;
        y = canvasH * (0.04 + 0.5 * rand());
        break;
      case "top":
        x = canvasW * (0.1 + 0.8 * rand());
        y = -off;
        break;
      case "topLeft":
        x = -off - 20 * rand();
        y = -off - 20 * rand();
        break;
      default:
        x = canvasW + off + 20 * rand();
        y = -off - 20 * rand();
    }
    const tx = canvasW * (0.15 + 0.7 * rand());
    const ty = canvasH * (0.25 + 0.45 * rand());
    const speed = ASTEROID_SPEED_MIN + rand() * (ASTEROID_SPEED_MAX - ASTEROID_SPEED_MIN);
    const len = Math.hypot(tx - x, ty - y) || 1;
    const vx = ((tx - x) / len) * speed;
    const vy = ((ty - y) / len) * speed;
    if (fair(x, y, vx, vy)) return { region, x, y, vx, vy };
  }
  // Deterministic fallback, so a timed spawn is not silently dropped on an awkward canvas (a
  // landscape tablet is short, and a random aim is often too steep to cross far enough before it
  // reaches the player row): scan side-edge entries at the slowest speed over a fixed set of
  // angles, starting at a rand()-chosen offset for variety. The same fairness rules apply.
  const FALLBACK_Y = [0.04, 0.15, 0.3] as const;
  const FALLBACK_ANGLE = [0.35, 0.5, 0.65, 0.8, 0.95] as const;
  const combos: { region: AsteroidEntryRegion; y: number; angle: number }[] = [];
  for (const region of ["left", "right"] as const) {
    for (const fy of FALLBACK_Y) {
      for (const angle of FALLBACK_ANGLE) combos.push({ region, y: canvasH * fy, angle });
    }
  }
  const start = Math.floor(rand() * combos.length);
  for (let i = 0; i < combos.length; i++) {
    const c = combos[(start + i) % combos.length]!;
    const dir = c.region === "left" ? 1 : -1;
    const x = c.region === "left" ? -off : canvasW + off;
    const vx = dir * Math.cos(c.angle) * ASTEROID_SPEED_MIN;
    const vy = Math.sin(c.angle) * ASTEROID_SPEED_MIN;
    if (fair(x, c.y, vx, vy)) return { region: c.region, x, y: c.y, vx, vy };
  }
  return null;
}

/** Everything a fresh rock must not start on top of: live ships (even off-screen ones), the player, Buddy. */
function entryActors(state: StarSwarmState): ThreatCircle[] {
  const out: ThreatCircle[] = [
    {
      x: state.player.x,
      y: state.player.y,
      r: Math.max(state.player.width, state.player.height) / 2,
    },
  ];
  for (const e of state.enemies) if (e.isAlive) out.push(enemyThreatCircle(e));
  for (const b of state.buddyShips) out.push({ x: b.x, y: b.y, r: PLAYER_H / 2 });
  return out;
}

/** A rock entering from a planned off-screen point (#2844); null if no fair trajectory was found. */
function spawnAsteroid(state: StarSwarmState, kind?: AsteroidKind): Asteroid | null {
  const k: AsteroidKind = kind ?? (rng() < ASTEROID_LARGE_CHANCE ? "large" : "small");
  const entry = planAsteroidEntry(
    state.canvasW,
    state.canvasH,
    ASTEROID_STATS[k].radius,
    entryActors(state),
    rng
  );
  return entry ? makeAsteroid(k, entry.x, entry.y, entry.vx, entry.vy) : null;
}

/** Timed spawns happen only mid-wave: never during swoop-in, bonus waves or game over. */
function canSpawnAsteroid(state: StarSwarmState): boolean {
  return (
    state.phase === "Playing" &&
    state.wave >= ASTEROID_MIN_WAVE &&
    !isBossWave(state.wave) && // #2490: no timed rocks on a boss wave — the Carrier is the show
    !state.asteroidsDisabled &&
    state.asteroids.length < MAX_ASTEROIDS
  );
}

/**
 * Dev-panel / test hook: throw a rock now. Honours the on-screen cap but ignores the wave
 * minimum and the dev "disabled" toggle, so a tester can always summon one. #2842: combat only —
 * no hazard may enter during swoop-in (setup time) or extraction (only survivors resolve).
 */
export function throwAsteroid(state: StarSwarmState, kind?: AsteroidKind): StarSwarmState {
  if (!weaponsFree(state) || state.asteroids.length >= MAX_ASTEROIDS) return state;
  const rock = spawnAsteroid(state, kind);
  if (!rock) return state;
  return {
    ...state,
    asteroids: [...state.asteroids, rock],
    runStats: bumpRun(state.runStats, { rocksSpawned: 1 }), // #2491
  };
}

export function tickAsteroids(state: StarSwarmState, dtMs: number): StarSwarmState {
  const { canvasW, canvasH } = state;
  let asteroids = mapFilterKeep(
    state.asteroids,
    (a) => ({
      ...a,
      x: a.x + a.vx * dtMs,
      y: a.y + a.vy * dtMs,
      rotation: a.rotation + a.spin * dtMs,
      hitFlashTimer: Math.max(0, a.hitFlashTimer - dtMs),
    }),
    (a) => a.y - a.radius < canvasH + 40 && a.x > -60 - a.radius && a.x < canvasW + 60 + a.radius
  );

  // The timer only runs mid-wave, so a wave never opens with a rock already on the way in.
  let nextAsteroidTimer = state.nextAsteroidTimer;
  let runStats = state.runStats;
  if (state.phase === "Playing") {
    nextAsteroidTimer -= dtMs;
    if (nextAsteroidTimer <= 0) {
      nextAsteroidTimer = asteroidInterval();
      const moved = { ...state, asteroids };
      if (canSpawnAsteroid(moved)) {
        const rock = spawnAsteroid(moved);
        if (rock) {
          asteroids = [...asteroids, rock];
          runStats = bumpRun(runStats, { rocksSpawned: 1 }); // #2491
        }
      }
    }
  }
  if (
    asteroids === state.asteroids &&
    nextAsteroidTimer === state.nextAsteroidTimer &&
    runStats === state.runStats
  ) {
    return state; // #2963: no rocks, and the spawn timer is idle outside Playing
  }
  return { ...state, asteroids, nextAsteroidTimer, runStats };
}

/**
 * Bullets (either owner, piercing or not) that reach a rock are spent on it and chip its HP.
 * `broken` counts the rocks this batch of shots finished off (#2491).
 */
export function absorbBulletsIntoRocks<B extends Bullet>(
  bullets: readonly B[],
  rocks: readonly Asteroid[]
): { bullets: B[]; rocks: Asteroid[]; broken: number } {
  const outRocks = [...rocks];
  if (rocks.length === 0) return { bullets: [...bullets], rocks: outRocks, broken: 0 };
  const kept: B[] = [];
  let broken = 0;
  for (const b of bullets) {
    const idx = outRocks.findIndex(
      (r) => r.hp > 0 && collideCircleAABB(r.x, r.y, r.radius, b.x, b.y, b.width, b.height)
    );
    if (idx === -1) {
      kept.push(b);
      continue;
    }
    const r = outRocks[idx]!;
    const hp = r.hp - b.damage;
    if (hp <= 0) broken++;
    outRocks[idx] = { ...r, hp, hitFlashTimer: ASTEROID_HIT_FLASH_MS };
  }
  return { bullets: kept, rocks: outRocks, broken };
}

/**
 * Rocks ram ships: one hit per enemy per rock, in any phase once the ship is on screen
 * (`pathT >= 0` — swooping reinforcements included). A small rock shatters on whatever it hits,
 * a large one keeps going.
 *
 * #2844: the Carrier's immunity comes from its armor, not its tier. `armored` (the tick's
 * starting roster, see tickCollisions) means its force field is up: the rock shatters on the
 * field and the Carrier takes nothing. With the last Guardian gone `armored` is false and the
 * Carrier is an ordinary hull — it takes the rock's hit like any ship (a Carrier the rock kills
 * still drops its hull plating, via `drops`).
 */
export function rocksStrikeEnemies(
  rocks: readonly Asteroid[],
  enemies: readonly Enemy[],
  explosions: Explosion[],
  struck: EnemyTier[], // #2487: tiers hit, for tierStats
  armored: boolean,
  drops: PowerUp[],
  canvasH: number
): { rocks: Asteroid[]; enemies: Enemy[]; deflects: number } {
  const outRocks = [...rocks];
  const outEnemies = [...enemies];
  let deflects = 0;
  for (let ri = 0; ri < outRocks.length; ri++) {
    let rock = outRocks[ri]!;
    if (rock.hp <= 0) continue;
    for (let ei = 0; ei < outEnemies.length; ei++) {
      const e = outEnemies[ei]!;
      if (!e.isAlive || (e.pathT < 0 && e.phase !== "Fleeing") || rock.hitEnemyIds.includes(e.id))
        continue;
      if (!asteroidHitsBox(rock, e)) continue;
      if (e.tier === "Carrier" && armored) {
        outEnemies[ei] = { ...e, hitFlashTimer: HIT_FLASH_DURATION };
        rock = { ...rock, hp: 0, shattered: true };
        deflects++;
        break;
      }
      const newHp = e.hp - 1;
      struck.push(e.tier);
      if (newHp <= 0) {
        explosions.push(spawnExplosion(e.x, e.y));
        if (e.tier === "Carrier") drops.push(makePickup("hull", e.x, e.y, canvasH)); // #2488
        outEnemies[ei] = { ...e, hp: 0, isAlive: false, hitFlashTimer: 0 };
      } else {
        outEnemies[ei] = { ...e, hp: newHp, hitFlashTimer: HIT_FLASH_DURATION };
      }
      rock = {
        ...rock,
        hitEnemyIds: [...rock.hitEnemyIds, e.id],
        hitFlashTimer: ASTEROID_HIT_FLASH_MS,
      };
      if (rock.kind === "small") {
        rock = { ...rock, hp: 0, shattered: true };
        break;
      }
    }
    outRocks[ri] = rock;
  }
  return { rocks: outRocks, enemies: outEnemies, deflects };
}

/**
 * Broken rocks pop an explosion; a large one splits in two unless it shattered on impact.
 * #2488: a broken large rock also has a chance to drop a salvage crate — whoever broke it.
 */
export function settleRocks(
  rocks: readonly Asteroid[],
  explosions: Explosion[],
  drops: PowerUp[],
  canvasH: number
): Asteroid[] {
  const out: Asteroid[] = [];
  for (const a of rocks) {
    if (a.hp > 0) {
      out.push(a);
      continue;
    }
    explosions.push(spawnExplosion(a.x, a.y));
    // Only a rock broken by shots pays out — one that shattered on a hull (the player's or the
    // Carrier's field) would otherwise hand the ship it just hit a free upgrade (#2540 review).
    if (a.kind === "large" && !a.shattered && rng() < SALVAGE_DROP_CHANCE) {
      drops.push(makePickup("salvage", a.x, a.y, canvasH));
    }
    if (a.kind === "large" && !a.shattered) {
      for (const side of [-1, 1] as const) {
        out.push(makeAsteroid("small", a.x + side * 10, a.y, a.vx + side * 0.06, a.vy));
      }
    }
  }
  return out;
}

/**
 * Deterministic 9-point outline for a rock in world space at its current rotation. Shared by
 * both renderers so the shape is identical on native and web (the id seeds the wobble).
 */
export function asteroidOutline(a: Asteroid): Vec2[] {
  const pts: Vec2[] = [];
  const n = 9;
  for (let i = 0; i < n; i++) {
    const wobble = 0.78 + 0.28 * hashFrac(a.id * 12.9898 + i * 78.233);
    const t = a.rotation + (i / n) * Math.PI * 2;
    pts.push({
      x: a.x + Math.cos(t) * a.radius * wobble,
      y: a.y + Math.sin(t) * a.radius * wobble,
    });
  }
  return pts;
}

/** @internal Exported for tests and offline tooling only; no production caller (knip --production, #3126). */
export function asteroidAttention(tier: EnemyTier): AsteroidAttention {
  return ASTEROID_ATTENTION[tier];
}

/**
 * #2844: a ship's next-shot timer after spending attention on a rock. Pure; `kind` picks the cost.
 * The delay is added on top of whatever time is left, so a ship already about to fire is pushed
 * back by the full amount rather than merely reset.
 */
export function withAsteroidAttention(
  shootTimer: number,
  tier: EnemyTier,
  kind: "threat" | "flak"
): number {
  const a = ASTEROID_ATTENTION[tier];
  return Math.max(0, shootTimer) + (kind === "flak" ? a.flakMs : a.threatMs);
}

/**
 * #2844: a ship pays attention to a rock: its next-shot timer slips back AND the same amount is
 * booked as `attentionMs` debt, a floor that tickEnemies re-applies after every tick so a phase
 * change (dive launch, straggler cap) cannot erase it.
 */
function payAttention<E extends Pick<Enemy, "tier" | "shootTimer" | "attentionMs">>(
  e: E,
  kind: "threat" | "flak"
): E {
  const a = ASTEROID_ATTENTION[e.tier];
  return {
    ...e,
    shootTimer: withAsteroidAttention(e.shootTimer, e.tier, kind),
    attentionMs: e.attentionMs + (kind === "flak" ? a.flakMs : a.threatMs),
  };
}

/**
 * #2844: degrade a player-directed shot's aim while its ship is evading. The velocity gets a
 * sideways kick of (0.5–1 × the tier's aimSpread × |vy|) in a random direction — always a real
 * miss, never a no-op, bigger for the more distracted tiers. `rand` supplies two draws.
 */
export function degradeAim(
  vx: number,
  vy: number,
  tier: EnemyTier,
  rand: () => number
): { vx: number; vy: number } {
  const mag = (0.5 + 0.5 * rand()) * ASTEROID_ATTENTION[tier].aimSpread * Math.abs(vy);
  return { vx: vx + (rand() < 0.5 ? -mag : mag), vy };
}

const PATH_PHASES = new Set(["SwoopIn", "Diving", "Returning", "Fleeing", "AttackRun"]);

/** Where the ship will be `ms` from now: on its path if it has one, else where it is. */
function predictEnemyPos(e: Enemy, ms: number): Vec2 {
  if (PATH_PHASES.has(e.phase) && e.path) {
    return evalCubic(e.path, Math.max(0, Math.min(1, e.pathT + ms / e.pathDuration)));
  }
  return { x: e.x, y: e.y };
}

/** Flak envelope shared by formation and diver flak: the rock is approaching and within range. */
function flakEngages(a: Asteroid, e: Enemy): boolean {
  const dx = a.x - e.x;
  const dy = a.y - e.y;
  return a.vx * -dx + a.vy * -dy > 0 && dx * dx + dy * dy < FLAK_RANGE * FLAK_RANGE;
}

/** Will this rock cross the ship's hitbox within the lookahead window? */
function rockThreatens(a: Asteroid, e: Enemy): boolean {
  for (const ms of DODGE_LOOKAHEAD_MS) {
    const p = predictEnemyPos(e, ms);
    if (
      collideCircleAABB(
        a.x + a.vx * ms,
        a.y + a.vy * ms,
        a.radius + DODGE_MARGIN,
        p.x,
        p.y,
        e.width,
        e.height
      )
    )
      return true;
  }
  return false;
}

/**
 * Bend the rest of a ship's path away from a rock without moving the ship: split the curve at
 * its current progress, nudge only the remaining segment, and restart that segment at pathT = 0
 * with the duration it had left, so speed along the path is unchanged. (Nudging the original
 * control points in place would pull the ship's current position sideways by up to ~30 px.)
 */
function nudgeRemainingPath(e: Enemy, dir: 1 | -1, px: number = DODGE_PATH_NUDGE): Enemy {
  const t = Math.max(0, Math.min(1, e.pathT));
  if (t >= 1 || !e.path) return e;
  return {
    ...e,
    path: nudgePath(splitRemaining(e.path, t), dir, px),
    pathT: 0,
    pathDuration: e.pathDuration * (1 - t),
  };
}

/** Current sidestep offset for a ship holding formation (or wiggling); 0 when not dodging. */
export function dodgeOffset(e: Enemy): number {
  if (!e.dodge) return 0;
  return e.dodge.dir * DODGE_SIDESTEP * Math.sin((Math.PI * e.dodge.t) / e.dodge.dur);
}

/**
 * #2487/#2844: each live ship looks at each live rock once. Only a ship the rock actually
 * threatens (`rockThreatens`: nearby, approaching or on a projected path into it) reacts — a
 * far-off ship is untouched. Reacting costs attention, paid out of the ship's own next-shot timer
 * (finite combat capacity, see ASTEROID_ATTENTION):
 *  - a threatening rock is a mild distraction (threatMs), once per rock per ship;
 *  - firing flak (formation ships only; the Carrier's flak is a diverted volley, see
 *    chooseCarrierTarget) adds flakMs to the timer, so the flak displaces player-directed fire
 *    instead of riding on top of it. Flak stays outside bulletCap() — the timer pays for it;
 *  - a successful dodge (sidestep in formation, a path nudge on a path) starts `evadeMs`, during
 *    which the ship's player-directed shots are degraded (degradeAim, applied in tickEnemies).
 * On screen (pathT >= 0) and not the Carrier, a ship rolls once per rock to dodge (a Circling ship
 * has no sidestep or path to bend, so it is detected and pays the threat cost but skips the roll).
 * #2881: ships in REACTION_PHASES (Wiggling, Diving, Returning, Fleeing, Circling) also get, once
 * per rock per phase (reactedAsteroidIds resets on a phase change), while threatened: a flinch
 * (FLINCH_CHANCE; evadeMs + the flinchMs wobble cue), flak at the rock (FLAK_BASE x DIVER_FLAK_FACTOR,
 * paid through payAttention so it displaces a shot), and, if the normal dodge did not happen, a
 * late LATE_NUDGE_PX path nudge that leaves the dive endpoint fixed. The armored Carrier is
 * unchanged and the exposed Carrier never reacts.
 * The armored Carrier ignores rocks (its force field shatters them); an exposed Carrier pays the
 * threat distraction but never dodges — it stays heavy. A failed roll takes no action; the
 * collision then follows naturally. All rolls use the seeded rng().
 */
export function tickAsteroidThreats(
  state: StarSwarmState,
  dtMs: number,
  ctx: TickCtx
): StarSwarmState {
  // #2963: tier stats are copied on their first bump, so a quiet tick keeps the same object
  let ownStats: Record<EnemyTier, TierStats> | null = null;
  const stats = (): Record<EnemyTier, TierStats> => (ownStats ??= { ...state.tierStats });
  const flakShots: Bullet[] = [];
  const paramScale = ctx.paramScale;
  const flakScale = Math.min(FLAK_SCALE_CAP, paramScale);
  const rocks =
    state.asteroids.length === 0 ? state.asteroids : state.asteroids.filter((a) => a.hp > 0);
  // #2963: a live Carrier (carrierStageIn !== null) with no Guardian left (!carrierArmoredIn)
  const carrierExposed = ctx.alive.carrierIdx >= 0 && !ctx.armored;

  const enemies = mapKeep(state.enemies, (e0) => {
    if (!e0.isAlive) return e0;
    let e = e0;
    if (e.flakCooldown > 0) e = { ...e, flakCooldown: Math.max(0, e.flakCooldown - dtMs) };
    if (e.evadeMs > 0) e = { ...e, evadeMs: Math.max(0, e.evadeMs - dtMs) };
    if (e.flinchMs > 0) e = { ...e, flinchMs: Math.max(0, e.flinchMs - dtMs) };
    if (e.reactedPhase !== e.phase) e = { ...e, reactedAsteroidIds: [], reactedPhase: e.phase };
    if (e.attentionMs > 0) e = { ...e, attentionMs: Math.max(0, e.attentionMs - dtMs) };
    if (e.dodge) {
      const t = e.dodge.t + dtMs;
      e = t >= e.dodge.dur ? { ...e, dodge: null } : { ...e, dodge: { ...e.dodge, t } };
    }
    // pathT < 0 means "still off screen" for a swoop-in — a fleeing grunt in its stagger is on
    // screen and fair game (#2489)
    if (rocks.length === 0 || (e.pathT < 0 && e.phase !== "Fleeing")) return e;
    // the armored Carrier's force field handles rocks; it never reacts
    if (e.tier === "Carrier" && !carrierExposed) return e;

    for (const a of rocks) {
      const canFlak =
        e.tier !== "Carrier" &&
        e.phase !== "Fleeing" && // a routed ship never shoots; it has no player shot to displace
        e.flakCooldown <= 0 &&
        weaponsFree(state) && // #2842: no new fire outside combat
        !state.enemyFireDisabled &&
        !state.flakDisabled; // #2491 dev toggle
      const fireFlak = (): void => {
        const tx = a.x + a.vx * FLAK_LEAD_MS;
        const ty = a.y + a.vy * FLAK_LEAD_MS;
        const len = Math.hypot(tx - e.x, ty - e.y) || 1;
        flakShots.push({
          id: nextId(),
          x: e.x,
          y: e.y,
          vx: ((tx - e.x) / len) * FLAK_SPEED,
          vy: ((ty - e.y) / len) * FLAK_SPEED,
          owner: "enemy",
          width: BULLET_E_W,
          height: BULLET_E_H,
          damage: 1,
          flak: true,
        });
        // #2844: the attention cost — this ship's next player-directed shot slips back
        e = payAttention({ ...e, flakCooldown: FLAK_COOLDOWN }, "flak");
        bumpStat(stats(), e.tier, { flak: 1 });
      };

      // Flak: a formation ship shoots at a rock coming its way (the Carrier's is its twin volley)
      if (e.phase === "Formation" && canFlak && rockThreatens(a, e)) {
        if (flakEngages(a, e) && rng() < FLAK_BASE[e.tier] * flakScale) fireFlak();
      }

      // Dodge: one roll per rock per ship (the #2491 dev toggle skips the roll entirely, so the
      // counters only ever describe rolls that were actually taken)
      const alreadyRolled = e.rolledAsteroidIds.includes(a.id);
      const reactive = e.tier !== "Carrier" && REACTION_PHASES.has(e.phase);
      const reacted = reactive && e.reactedAsteroidIds.includes(a.id);
      if (reactive ? reacted : alreadyRolled) continue;
      if (e.tier === "Carrier") {
        // #2844: heavy — no sidestep, but a rock bearing down still takes its attention (once)
        if (rockThreatens(a, e)) {
          e = payAttention({ ...e, rolledAsteroidIds: [...e.rolledAsteroidIds, a.id] }, "threat");
        }
        continue;
      }
      // #2491: dodgeDisabled gates only the dodge roll and the nudges; flinch is ungated and
      // flakDisabled (canFlak) alone gates flak
      if ((state.dodgeDisabled && !reactive) || !rockThreatens(a, e)) continue;
      const onPath = PATH_PHASES.has(e.phase) && e.path !== null;
      let dodgedNow = false;
      if (!alreadyRolled && !state.dodgeDisabled) {
        // #2844 mild distraction
        e = payAttention({ ...e, rolledAsteroidIds: [...e.rolledAsteroidIds, a.id] }, "threat");
        if (e.phase !== "Circling") {
          // a circling ship has no sidestep or path to bend: it is detected and pays, then reacts
          bumpStat(stats(), e.tier, { rolls: 1, pathRolls: onPath ? 1 : 0 });
          if (rng() < dodgeChance(e.tier, paramScale)) {
            dodgedNow = true;
            bumpStat(stats(), e.tier, { dodged: 1, pathDodged: onPath ? 1 : 0 });
            const dir: 1 | -1 = e.x < a.x + a.vx * 400 ? -1 : 1;
            e = onPath
              ? nudgeRemainingPath(e, dir)
              : { ...e, dodge: { dir, t: 0, dur: DODGE_SIDESTEP_MS } };
            e = { ...e, evadeMs: DODGE_SIDESTEP_MS }; // #2844: aim suffers while evading
          }
        }
      }

      // #2881: the visible reactions — once per rock per phase, only for a threatened ship
      if (!reactive) continue;
      e = { ...e, reactedAsteroidIds: [...e.reactedAsteroidIds, a.id] };
      if (rng() < FLINCH_CHANCE[e.tier]) {
        e = { ...e, evadeMs: Math.max(e.evadeMs, FLINCH_MS), flinchMs: FLINCH_MS };
      }
      if (
        canFlak &&
        e.flakCooldown <= 0 &&
        flakEngages(a, e) && // same envelope as formation flak: approaching and within range
        rng() < FLAK_BASE[e.tier] * DIVER_FLAK_FACTOR * flakScale
      ) {
        fireFlak();
      }
      if (
        !state.dodgeDisabled &&
        !dodgedNow &&
        onPath &&
        e.pathT >= 0 &&
        e.pathT < 1 &&
        rng() < LATE_NUDGE_CHANCE[e.tier]
      ) {
        const dir: 1 | -1 = e.x < a.x + a.vx * 400 ? -1 : 1;
        e = nudgeRemainingPath(e, dir, LATE_NUDGE_PX); // p3 untouched: the dive stays committed
      }
    }
    return e;
  });

  if (enemies === state.enemies && flakShots.length === 0 && ownStats === null) return state;
  return {
    ...state,
    enemies,
    enemyBullets: flakShots.length > 0 ? [...state.enemyBullets, ...flakShots] : state.enemyBullets,
    tierStats: ownStats ?? state.tierStats,
  };
}
