/**
 * Star Swarm engine — small shared entity factories (#2988).
 *
 * Pickups, explosions and the power-up type roll, used by more than one subsystem (rocks drop
 * salvage, the Carrier drops plating, every kill pops an explosion). `pickPowerUpType` and the
 * drop position are the engine's two cosmetic `Math.random` calls (docs/ARCHITECTURE.md §3.2).
 */
import type { Explosion, PowerUp, PowerUpType, StarSwarmState } from "../types";
import { nextId } from "./rng";
import { mapFilterKeep } from "./roster";
import {
  EXPLOSION_FRAMES,
  EXPLOSION_FRAME_MS,
  PLAYER_Y_FROM_BOTTOM,
  POWERUP_H,
  POWERUP_VY,
  POWERUP_W,
} from "./tuning";

// #1032: weighted power-up type selection based on player lives
// Uses Math.random() intentionally — cosmetic choice, should not affect determinism.
export function pickPowerUpType(lives: number): PowerUpType {
  const r = Math.random();
  if (lives <= 1) {
    // Shield and Bomb each 33%, Lightning and Buddy each 17%
    if (r < 0.33) return "shield";
    if (r < 0.66) return "bomb";
    if (r < 0.83) return "lightning";
    return "buddy";
  }
  // lives >= 2: equal 25% each
  if (r < 0.25) return "lightning";
  if (r < 0.5) return "shield";
  if (r < 0.75) return "buddy";
  return "bomb";
}

// Time for a powerup to fall from spawn (y = POWERUP_H/2) to just past the player, plus a
// 2-second collection window. Computed per-canvas so it works at any screen height.
export function powerUpDespawnMs(canvasH: number): number {
  return Math.ceil((canvasH - PLAYER_Y_FROM_BOTTOM - POWERUP_H / 2) / POWERUP_VY) + 2000;
}

/** A falling pickup of any type at a world position. */
export function makePickup(type: PowerUpType, x: number, y: number, canvasH: number): PowerUp {
  return {
    id: nextId(),
    type,
    x,
    y,
    vy: POWERUP_VY,
    width: POWERUP_W,
    height: POWERUP_H,
    despawnTimer: powerUpDespawnMs(canvasH),
  };
}

export function spawnExplosion(x: number, y: number, id: number = nextId()): Explosion {
  return { id, x, y, frame: 0, frameTimer: EXPLOSION_FRAME_MS };
}

// ---------------------------------------------------------------------------
// Explosions
// ---------------------------------------------------------------------------

export function tickExplosions(state: StarSwarmState, dtMs: number): StarSwarmState {
  const explosions = mapFilterKeep(
    state.explosions,
    (ex) => {
      const frameTimer = ex.frameTimer - dtMs;
      if (frameTimer <= 0) {
        return { ...ex, frame: ex.frame + 1, frameTimer: EXPLOSION_FRAME_MS };
      }
      return { ...ex, frameTimer };
    },
    (ex) => ex.frame < EXPLOSION_FRAMES
  );

  return explosions === state.explosions ? state : { ...state, explosions }; // #2963
}
