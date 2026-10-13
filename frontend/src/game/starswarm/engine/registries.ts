/**
 * Star Swarm engine — content registries (#3245).
 *
 * Every list of known things the per-wave stats are keyed by: power-ups, enemy tiers, rock
 * kinds, hit causes and so on. Each is an `as const` array, and the union type of its values is
 * derived from it, so the list and the type can't drift: add a power-up here and the compiler
 * points at every dense stats table (`emptyWaveStats` in `waveStats.ts`) and the contract test
 * (`__tests__/waveStats.contract.test.ts`) fails until it has a counter row.
 *
 * The values are the `wave_completed` v1 wire vocabulary (epic #3244); the backend mirrors them
 * as `Literal` sets (`StarSwarmWaveStats`, #3250). Renaming a value is a schema change.
 *
 * This module imports nothing, so `types.ts` (imported everywhere) can derive its unions from it
 * without an import cycle.
 *
 * Adding content: docs/games/starswarm.md#adding-content.
 */

/** Pickups. lightning/shield are timed buffs, buddy/bomb instant, salvage/hull in-run upgrades. */
export const POWERUP_TYPES = ["lightning", "shield", "buddy", "bomb", "salvage", "hull"] as const;

/** Where a pickup came from: an enemy kill, a broken rock, the Carrier, or the dev panel. */
export const POWERUP_SOURCES = ["kill", "rock", "carrier", "dev"] as const;

/** Enemy tiers, lightest to heaviest. */
export const ENEMY_TIERS = ["Grunt", "Elite", "Guardian", "Carrier"] as const;

/** Errant asteroid sizes (#2486). */
export const ASTEROID_KINDS = ["large", "small"] as const;

/** What broke a rock: a player shot, an enemy shot (flak included), a Smart Bomb, or an impact. */
export const ROCK_BREAKERS = ["player", "enemy", "bomb", "contact"] as const;

/** What hit the player ship. */
export const HIT_CAUSES = ["bullet", "rock", "beam", "ram"] as const;

/** What hit Buddy. */
export const BUDDY_HIT_CAUSES = ["bullet", "beam", "rock"] as const;

/** What a hit on the player cost: a life, a hull plating level, or nothing (shield absorbed). */
export const HIT_RESULTS = ["life", "plating", "shield"] as const;

/** How an enemy died. */
export const KILL_METHODS = ["shot", "dive", "rout", "bomb", "ram", "rock", "buddy"] as const;

/** The Carrier's aggression stages, in order (#2843). */
export const CARRIER_STAGES = ["protected", "exposed", "finalStand"] as const;

export type PowerUpType = (typeof POWERUP_TYPES)[number];
export type PowerUpSource = (typeof POWERUP_SOURCES)[number];
export type EnemyTier = (typeof ENEMY_TIERS)[number];
export type AsteroidKind = (typeof ASTEROID_KINDS)[number];
export type RockBreaker = (typeof ROCK_BREAKERS)[number];
export type HitCause = (typeof HIT_CAUSES)[number];
export type BuddyHitCause = (typeof BUDDY_HIT_CAUSES)[number];
export type HitResult = (typeof HIT_RESULTS)[number];
export type KillMethod = (typeof KILL_METHODS)[number];
export type CarrierStage = (typeof CARRIER_STAGES)[number];

/** Every registry by name — what the contract harness iterates. */
export const REGISTRIES = {
  POWERUP_TYPES,
  POWERUP_SOURCES,
  ENEMY_TIERS,
  ASTEROID_KINDS,
  ROCK_BREAKERS,
  HIT_CAUSES,
  BUDDY_HIT_CAUSES,
  HIT_RESULTS,
  KILL_METHODS,
  CARRIER_STAGES,
} as const;

/** @internal The contract harness's key type; no production caller. */
export type RegistryName = keyof typeof REGISTRIES;
