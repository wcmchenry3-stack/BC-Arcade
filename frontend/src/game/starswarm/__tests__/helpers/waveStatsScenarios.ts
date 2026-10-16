/**
 * Scenario builders for the rock, combat, damage and Buddy per-wave counters (#3247, #3248):
 * shared by `waveStats.rocks.test.ts`, `waveStats.combat.test.ts` and the contract rows in
 * `waveStatsContract/{rocks,combat,damage,buddy}.ts`. Not a test file.
 *
 * Most scenarios run one collision pass (`collide`) over a hand-placed state: the pass is where
 * every one of these counters moves, and nothing moves first, so a rock or a shot sits exactly
 * where it was put.
 */
import { ASTEROID_STATS, CANVAS_H, CANVAS_W, initStarSwarm } from "../../engine";
import { POWERUP_H, POWERUP_W } from "../../engine/tuning";
import { makeBuddy } from "../../engine/buddy";
import { tickCollisions } from "../../engine/collisions";
import { closeWave, type WaveStatsSnapshot } from "../../engine/waveStats";
import type {
  Asteroid,
  AsteroidKind,
  BuddyShip,
  Bullet,
  DifficultyTier,
  Enemy,
  EnemyTier,
  PowerUp,
  PowerUpType,
  StarSwarmState,
} from "../../types";
import { untilPlaying } from "./engineFixtures";

let nextId = 600_000;

/** A clear spot: left of the formation's columns and above the player's lane. */
export const OPEN = { x: 40, y: 460 } as const;

/**
 * Wave `wave` in combat with nothing in flight and nothing about to happen on its own: no enemy
 * fire, no timed rocks, no dives, no straggler wiggle or rout, the beam far off.
 */
export function arena(wave = 1, difficulty: DifficultyTier = "Commander"): StarSwarmState {
  const s = untilPlaying(initStarSwarm(CANVAS_W, CANVAS_H, wave, 42, difficulty));
  return {
    ...s,
    enemyFireDisabled: true,
    asteroidsDisabled: true,
    stragglerEnabled: false,
    routDisabled: true,
    nextDiveTimer: 1e9,
    enemyBullets: [],
    playerBullets: [],
    asteroids: [],
    powerUps: [],
    carrierBeams: [],
    player: { ...s.player, lives: 3, hull: 0, invincibleTimer: 0 },
    enemies: s.enemies.map((e) => (e.tier === "Carrier" ? { ...e, beamTimer: 1e9 } : e)),
  };
}

/**
 * The arena with one ship of `tier` left alive (patched with `patch`) — plus, with `armored`, one
 * Guardian, so an escorted Carrier's field is up. Returns the state and the ship.
 */
export function lone(
  s: StarSwarmState,
  tier: EnemyTier,
  patch: Partial<Enemy> = {},
  armored = false
): { state: StarSwarmState; ship: Enemy } {
  const target = s.enemies.find((e) => e.isAlive && e.tier === tier);
  if (!target) throw new Error(`no live ${tier}`);
  const escort = armored ? s.enemies.find((e) => e.isAlive && e.tier === "Guardian") : undefined;
  const ship = { ...target, ...patch };
  const enemies = s.enemies.map((e) =>
    e.id === target.id ? ship : e.id === escort?.id ? e : { ...e, isAlive: false, hp: 0 }
  );
  return { state: { ...s, enemies }, ship };
}

export function rock(
  kind: AsteroidKind,
  x: number,
  y: number,
  extra: Partial<Asteroid> = {}
): Asteroid {
  return {
    id: nextId++,
    kind,
    x,
    y,
    vx: 0,
    vy: 0,
    radius: ASTEROID_STATS[kind].radius,
    hp: ASTEROID_STATS[kind].hp,
    rotation: 0,
    spin: 0,
    hitFlashTimer: 0,
    hitEnemyIds: [],
    ...extra,
  };
}

/** A shot at (x, y), the player's unless `extra` says otherwise. */
export function shot(x: number, y: number, extra: Partial<Bullet> = {}): Bullet {
  return {
    id: nextId++,
    x,
    y,
    vx: 0,
    vy: 0,
    owner: "player",
    width: 6,
    height: 6,
    damage: 1,
    ...extra,
  };
}

/** An enemy shot at (x, y). */
export function enemyShot(x: number, y: number, extra: Partial<Bullet> = {}): Bullet {
  return shot(x, y, { owner: "enemy", ...extra });
}

/** One of Buddy's burst shots at (x, y). */
export function buddyShot(x: number, y: number): Bullet {
  return shot(x, y, { piercing: true, pierceLeft: 3, source: "buddy", damage: 10 });
}

/** A pickup on the ship, collected by the next collision pass. */
export function pickupOnShip(s: StarSwarmState, type: PowerUpType): PowerUp {
  return {
    id: nextId++,
    type,
    x: s.player.x,
    y: s.player.y,
    vy: 0,
    width: POWERUP_W,
    height: POWERUP_H,
    despawnTimer: 10_000,
  };
}

/** A Buddy holding still at (x, y) with `hp` hit points. */
export function buddyAt(s: StarSwarmState, x: number, y: number, hp: number): BuddyShip {
  return {
    ...makeBuddy(s),
    x,
    y,
    hp,
    phase: "OnStation",
    planMs: 1e9,
    goalX: x,
    goalY: y,
  };
}

/** One collision pass. */
export function collide(s: StarSwarmState): StarSwarmState {
  return tickCollisions(s);
}

/** The snapshot of the wave `s` is on, closed as the engine would close it now. */
export function snap(s: StarSwarmState): WaveStatsSnapshot {
  return closeWave(s, s.phase === "GameOver" ? "died" : "cleared");
}
