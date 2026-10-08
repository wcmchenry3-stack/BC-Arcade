/**
 * Star Swarm engine tests: the shared entity factories (`engine/entities.ts`, #2988) — pickups,
 * explosions and the power-up type roll.
 */
import { CANVAS_H, CANVAS_W, _resetIds, initStarSwarm, seedRng } from "../engine";
import {
  makePickup,
  pickPowerUpType,
  powerUpDespawnMs,
  spawnExplosion,
  tickExplosions,
} from "../engine/entities";
import {
  EXPLOSION_FRAMES,
  EXPLOSION_FRAME_MS,
  POWERUP_H,
  POWERUP_VY,
  POWERUP_W,
} from "../engine/tuning";
import type { Explosion, PowerUpType } from "../types";

beforeEach(() => {
  seedRng(42);
  _resetIds();
});

describe("makePickup (#2488)", () => {
  it("builds a falling pickup of the given type with a fresh id and the canvas-sized despawn", () => {
    const p = makePickup("salvage", 100, 200, CANVAS_H);
    expect(p).toEqual({
      id: 1,
      type: "salvage",
      x: 100,
      y: 200,
      vy: POWERUP_VY,
      width: POWERUP_W,
      height: POWERUP_H,
      despawnTimer: powerUpDespawnMs(CANVAS_H),
    });
    expect(makePickup("hull", 0, 0, CANVAS_H).id).toBe(2);
  });

  it("powerUpDespawnMs covers the fall to the player row plus a 2 s collection window", () => {
    const ms = powerUpDespawnMs(CANVAS_H);
    expect(ms).toBeGreaterThan(CANVAS_H / POWERUP_VY);
    expect(powerUpDespawnMs(CANVAS_H * 2)).toBeGreaterThan(ms);
  });
});

describe("spawnExplosion / tickExplosions", () => {
  it("spawnExplosion starts at frame 0 with a fresh id unless one is given", () => {
    expect(spawnExplosion(10, 20)).toEqual({
      id: 1,
      x: 10,
      y: 20,
      frame: 0,
      frameTimer: EXPLOSION_FRAME_MS,
    });
    expect(spawnExplosion(1, 2, 999)).toEqual({
      id: 999,
      x: 1,
      y: 2,
      frame: 0,
      frameTimer: EXPLOSION_FRAME_MS,
    });
    expect(spawnExplosion(0, 0).id).toBe(2); // the explicit id drew nothing from the counter
  });

  it("tickExplosions advances frames on the frame timer and drops a finished explosion", () => {
    const s0 = initStarSwarm(CANVAS_W, CANVAS_H);
    const ex: Explosion = spawnExplosion(5, 5);
    let s = { ...s0, explosions: [ex] };
    s = tickExplosions(s, EXPLOSION_FRAME_MS / 2);
    expect(s.explosions[0]).toEqual({ ...ex, frameTimer: EXPLOSION_FRAME_MS / 2 });
    s = tickExplosions(s, EXPLOSION_FRAME_MS / 2);
    expect(s.explosions[0]).toEqual({ ...ex, frame: 1, frameTimer: EXPLOSION_FRAME_MS });
    for (let i = 0; i < EXPLOSION_FRAMES; i++) s = tickExplosions(s, EXPLOSION_FRAME_MS);
    expect(s.explosions).toEqual([]);
  });

  it("tickExplosions hands back the same state when there is nothing to animate (#2963)", () => {
    const s0 = initStarSwarm(CANVAS_W, CANVAS_H);
    expect(tickExplosions(s0, 16)).toBe(s0);
  });
});

describe("pickPowerUpType (#1032)", () => {
  function pick(r: number, lives: number): PowerUpType {
    const spy = jest.spyOn(Math, "random").mockReturnValue(r);
    try {
      return pickPowerUpType(lives);
    } finally {
      spy.mockRestore();
    }
  }

  it("on the last life weights shield and bomb at a third each, lightning and buddy at a sixth", () => {
    expect(pick(0.1, 1)).toBe("shield");
    expect(pick(0.5, 1)).toBe("bomb");
    expect(pick(0.7, 1)).toBe("lightning");
    expect(pick(0.9, 1)).toBe("buddy");
  });

  it("with two or more lives the four types are equally likely", () => {
    expect(pick(0.1, 3)).toBe("lightning");
    expect(pick(0.3, 3)).toBe("shield");
    expect(pick(0.6, 3)).toBe("buddy");
    expect(pick(0.9, 3)).toBe("bomb");
  });
});
