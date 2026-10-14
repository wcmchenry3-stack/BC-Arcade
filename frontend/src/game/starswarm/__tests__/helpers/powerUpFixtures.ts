/**
 * Scenario builders for the power-up lifecycle counters (#3246): the waveStats.powerUps tests and
 * the contract rows share them. Not a test file.
 */
import { CANVAS_H, CANVAS_W, POWERUP_TYPES, initStarSwarm, tick } from "../../engine";
import { makeAsteroid } from "../../engine/asteroids";
import type { PowerUp, PowerUpSource, PowerUpType, StarSwarmState } from "../../types";
import { NO_INPUT, untilPlaying } from "./engineFixtures";

/** A Playing-phase wave 1, seed 42. */
export function playingWave(): StarSwarmState {
  return untilPlaying(initStarSwarm(CANVAS_W, CANVAS_H, 1, 42, "Commander"));
}

/** A pickup that hangs in the air (no fall, no despawn) at `x, y`, unless `over` says otherwise. */
export function pickup(
  type: PowerUpType,
  source: PowerUpSource,
  x: number,
  y: number,
  over: Partial<PowerUp> = {}
): PowerUp {
  return {
    id: 70_000 + Math.floor(x + y),
    type,
    x,
    y,
    vy: 0,
    width: 24,
    height: 24,
    despawnTimer: 1e9,
    source,
    ...over,
  };
}

/** A pickup parked in the top-left corner, far from the ship, that never moves. */
export const parked = (type: PowerUpType, source: PowerUpSource = "kill"): PowerUp =>
  pickup(type, source, 40, 60);

/** A pickup sitting on the ship: the next tick collects it. */
export const onShip = (s: StarSwarmState, type: PowerUpType): PowerUp =>
  pickup(type, "kill", s.player.x, s.player.y);

/** Sum of the table `spawned[type]` over sources. */
export function spawnedOf(
  spawned: Record<PowerUpType, Record<PowerUpSource, number>>,
  type: PowerUpType
): number {
  return Object.values(spawned[type]).reduce((a, b) => a + b, 0);
}

/** Asserts `spawned = collected + missed + leftover` for every type of a wave's power-up stats. */
export function expectConserved(stats: StarSwarmState["waveStats"]["powerUps"]): void {
  for (const t of POWERUP_TYPES) {
    expect({ t, n: spawnedOf(stats.spawned, t) }).toEqual({
      t,
      n: stats.collected[t] + stats.missed[t] + stats.leftover[t],
    });
  }
}

/** Plays ticks until a large rock broken by a shot drops a salvage crate; returns that state. */
export function rockSalvage(s: StarSwarmState): StarSwarmState {
  for (let i = 0; i < 400; i++) {
    const rock = { ...makeAsteroid("large", 40, 60, 0, 0), hp: 0 };
    const next = tick({ ...s, asteroids: [rock], powerUps: [] }, 16, NO_INPUT);
    if (next.powerUps.some((p) => p.type === "salvage")) return next;
    s = next;
  }
  throw new Error("no salvage dropped");
}

/** A state whose next tick rolls a kill drop (Playing, nothing falling, kills past the target). */
export function dropDue(s: StarSwarmState): StarSwarmState {
  return { ...s, powerUps: [], killsSinceLastDrop: s.dropJitterTarget + 1 };
}

/** The Carrier alone at 1 hp with no escort: a bomb kills it and it drops plating. */
export function lastCarrier(s: StarSwarmState): StarSwarmState {
  const first = s.enemies.find((e) => e.isAlive);
  if (!first) throw new Error("no live enemy");
  return { ...s, enemies: [{ ...first, tier: "Carrier", hp: 1 }] };
}

/** Runs `f` with `Math.random` pinned to 0.5, so a kill drop falls straight onto the ship. */
export function withCentredDrops<T>(f: () => T): T {
  const spy = jest.spyOn(Math, "random").mockReturnValue(0.5);
  try {
    return f();
  } finally {
    spy.mockRestore();
  }
}
