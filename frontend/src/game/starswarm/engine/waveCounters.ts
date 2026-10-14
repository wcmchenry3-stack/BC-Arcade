/**
 * Star Swarm engine — the rock, combat, damage and Buddy per-wave counters (#3247, #3248).
 *
 * Every counter path those sections bump is built once here, at module load, so a hot-path bump
 * (`bumpWave(ws, KILLS.Grunt.shot, 1)`) allocates nothing at the call site. The helpers below
 * bump the counters that must move together — a rock kill is a `combat.kills[tier].rock` *and* a
 * `rocks.enemiesDestroyed[tier]`; a rock on the hull is a `damage.hits.rock[result]` *and* a
 * `rocks.playerHits[result]` — so the sections can't drift apart.
 *
 * The counting rules (what each counter means, the multi-hit rule, `contact`, dev throws) are in
 * docs/games/starswarm.md#per-wave-stats.
 */
import type { Enemy } from "../types";
import {
  ASTEROID_KINDS,
  BUDDY_HIT_CAUSES,
  ENEMY_TIERS,
  HIT_CAUSES,
  HIT_RESULTS,
  KILL_METHODS,
  ROCK_BREAKERS,
  type AsteroidKind,
  type BuddyHitCause,
  type EnemyTier,
  type HitCause,
  type HitResult,
  type KillMethod,
  type RockBreaker,
} from "./registries";
import { bumpWave, type WaveCounterPath, type WaveDodge, type WaveStats } from "./waveStats";

type Path = Readonly<WaveCounterPath>;

function paths<K extends string, V>(
  keys: readonly K[],
  make: (key: K) => V
): Readonly<Record<K, V>> {
  const out = {} as Record<K, V>;
  for (const k of keys) out[k] = make(k);
  return out;
}

const DODGE_FIELDS = ["rolls", "dodged", "pathRolls", "pathDodged", "flak"] as const;

// ── rocks (#3247) ─────────────────────────────────────────────────────────────────────────────
export const ROCK_SPAWNED = paths(ASTEROID_KINDS, (k: AsteroidKind): Path => [
  "rocks",
  "spawned",
  k,
]);
export const ROCK_DEV_SPAWNED: Path = ["rocks", "devSpawned"];
export const ROCK_BROKEN = paths(ROCK_BREAKERS, (k: RockBreaker): Path => ["rocks", "broken", k]);
const ROCK_STRUCK = paths(ENEMY_TIERS, (t: EnemyTier): Path => ["rocks", "enemiesStruck", t]);
const ROCK_DESTROYED = paths(ENEMY_TIERS, (t: EnemyTier): Path => ["rocks", "enemiesDestroyed", t]);
const ROCK_PLAYER_HITS = paths(HIT_RESULTS, (r: HitResult): Path => ["rocks", "playerHits", r]);
const ROCK_BUDDY_HITS: Path = ["rocks", "buddyHits"];
const ROCK_BUDDY_DESTROYED: Path = ["rocks", "buddyDestroyed"];
/** `rocks.dodge[tier][field]` — the per-wave twin of the run-wide `tierStats` (#2487). */
export const DODGE = paths(ENEMY_TIERS, (t: EnemyTier) =>
  paths(DODGE_FIELDS, (f: keyof WaveDodge): Path => ["rocks", "dodge", t, f])
);

// ── combat (#3248) ────────────────────────────────────────────────────────────────────────────
export const COMBAT_SPAWNED = paths(ENEMY_TIERS, (t: EnemyTier): Path => ["combat", "spawned", t]);
const KILLS = paths(ENEMY_TIERS, (t: EnemyTier) =>
  // (asserted: 4 tiers × 7 methods is past the union size tsc checks a tuple against)
  paths(KILL_METHODS, (m: KillMethod) => ["combat", "kills", t, m] as Path)
);
export const SHOTS_FIRED: Path = ["combat", "shotsFired"];
export const SHOTS_HIT: Path = ["combat", "shotsHit"];
export const SHOTS_ON_ROCKS: Path = ["combat", "shotsOnRocks"];

// ── damage (#3248) ────────────────────────────────────────────────────────────────────────────
const DAMAGE = paths(HIT_CAUSES, (c: HitCause) =>
  paths(HIT_RESULTS, (r: HitResult): Path => ["damage", "hits", c, r])
);

// ── buddy (#3248) ─────────────────────────────────────────────────────────────────────────────
export const BUDDY_LAUNCHED: Path = ["buddy", "launched"];
export const BUDDY_SHOTS_DRAWN: Path = ["buddy", "shotsDrawn"];
const BUDDY_HITS = paths(BUDDY_HIT_CAUSES, (c: BuddyHitCause): Path => ["buddy", "hits", c]);
const BUDDY_DESTROYED = paths(BUDDY_HIT_CAUSES, (c: BuddyHitCause): Path => [
  "buddy",
  "destroyed",
  c,
]);
const BUDDY_KILLS = paths(ENEMY_TIERS, (t: EnemyTier): Path => ["buddy", "kills", t]);

/** Hits or losses by Buddy hit cause (what `resolveBuddyHits` reports). */
export type BuddyCauseCounts = Readonly<Record<BuddyHitCause, number>>;

/**
 * One enemy death: `combat.kills[tier][method]`, plus `rocks.enemiesDestroyed[tier]` for a rock
 * kill and `buddy.kills[tier]` for a Buddy kill.
 */
export function countKill(ws: WaveStats, tier: EnemyTier, method: KillMethod): WaveStats {
  let out = bumpWave(ws, KILLS[tier][method], 1);
  if (method === "rock") out = bumpWave(out, ROCK_DESTROYED[tier], 1);
  else if (method === "buddy") out = bumpWave(out, BUDDY_KILLS[tier], 1);
  return out;
}

/** A rock struck a ship of `tier` (a Carrier field deflect is not a strike). */
export function countRockStrike(ws: WaveStats, tier: EnemyTier): WaveStats {
  return bumpWave(ws, ROCK_STRUCK[tier], 1);
}

/** `n` hits on the player: `damage.hits[cause][result]`, mirrored to `rocks.playerHits` for a rock. */
export function countPlayerHit(
  ws: WaveStats,
  cause: HitCause,
  result: HitResult,
  n = 1
): WaveStats {
  const out = bumpWave(ws, DAMAGE[cause][result], n);
  return cause === "rock" ? bumpWave(out, ROCK_PLAYER_HITS[result], n) : out;
}

/** The cause of the hit that took the last life (`damage.deathCause`). */
export function withDeathCause(ws: WaveStats, cause: HitCause | null): WaveStats {
  if (ws.damage.deathCause === cause) return ws;
  return { ...ws, damage: { ...ws.damage, deathCause: cause } };
}

/** Buddy's hits and losses this tick, by cause; the rock ones mirrored into `rocks`. */
export function countBuddyHits(
  ws: WaveStats,
  hits: BuddyCauseCounts,
  destroyed: BuddyCauseCounts
): WaveStats {
  let out = ws;
  for (const c of BUDDY_HIT_CAUSES) {
    out = bumpWave(out, BUDDY_HITS[c], hits[c]);
    out = bumpWave(out, BUDDY_DESTROYED[c], destroyed[c]);
  }
  out = bumpWave(out, ROCK_BUDDY_HITS, hits.rock);
  return bumpWave(out, ROCK_BUDDY_DESTROYED, destroyed.rock);
}

/** Ships that entered the wave: `combat.spawned[tier]` for each. */
export function countShipsSpawned(ws: WaveStats, enemies: readonly Enemy[]): WaveStats {
  let out = ws;
  for (const e of enemies) out = bumpWave(out, COMBAT_SPAWNED[e.tier], 1);
  return out;
}
