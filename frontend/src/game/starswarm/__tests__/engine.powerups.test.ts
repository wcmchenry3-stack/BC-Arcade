/**
 * Star Swarm engine tests: power-up drops, Lightning, Shield, Smart Bomb and the in-run upgrade
 * ladders.
 *
 * One file per planned `engine/` module (#2988): this file follows `engine/powerups.ts`. Split out
 * of the former monolithic `engine.test.ts` (#2955) with describe blocks moved whole; shared
 * fixtures live in `helpers/engineFixtures.ts`.
 */
import {
  initStarSwarm,
  tick,
  POWERUP_DURATION,
  triggerKills,
  seedRng,
  _resetIds,
  CANVAS_W,
  CANVAS_H,
  applyPowerUp,
  MAX_PLAYER_BULLETS,
  ASTEROID_STATS,
  playerVolley,
  upgradeEvents,
  SPREAD_VX,
  HULL_INVINCIBLE_MS,
  GUNS_MAX,
  HULL_MAX,
} from "../engine";
import type { Asteroid, Bullet, PowerUp, StarSwarmInput, StarSwarmState } from "../types";
import { NO_INPUT, FIRE_INPUT, advanceMs, clearWave, makeBeam } from "./helpers/engineFixtures";

beforeEach(() => {
  seedRng(42);
  _resetIds();
});

// ---------------------------------------------------------------------------
// Lightning power-up engine (#980)
// ---------------------------------------------------------------------------

describe("Power-up engine (#980)", () => {
  it("triggerKills returns 12 at wave 1 and caps at 20", () => {
    expect(triggerKills(1)).toBe(12);
    expect(triggerKills(2)).toBe(13);
    expect(triggerKills(8)).toBe(20);
    expect(triggerKills(100)).toBe(20);
  });

  it("killsSinceLastDrop and dropJitterTarget initialised at wave start", () => {
    const s = initStarSwarm(CANVAS_W, CANVAS_H);
    expect(s.killsSinceLastDrop).toBe(0);
    expect(s.dropJitterTarget).toBeGreaterThan(0);
  });

  it("activePowerUp is null at wave start", () => {
    const s = initStarSwarm(CANVAS_W, CANVAS_H);
    expect(s.activePowerUp).toBeNull();
  });

  it("kill counter only increments during Playing phase", () => {
    // SwoopIn — a kill on a ship still flying in should NOT increment the counter
    let s = advanceMs(initStarSwarm(CANVAS_W, CANVAS_H, 1), 600);
    expect(s.phase).toBe("SwoopIn");
    const target = s.enemies.find((e) => e.isAlive && e.phase === "SwoopIn" && e.y > 40);
    if (!target) throw new Error("no enemy on screen yet");
    const bullet: Bullet = {
      id: 88001,
      x: target.x,
      y: target.y,
      vx: 0,
      vy: 0,
      owner: "player",
      width: target.width,
      height: target.height,
      damage: 10,
    };
    s = { ...s, playerBullets: [bullet] };
    s = tick(s, 16, NO_INPUT);
    expect(s.killsSinceLastDrop).toBe(0);
  });

  it("power-up spawns when killsSinceLastDrop reaches dropJitterTarget during Playing", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H);
    s = advanceMs(s, 8000);
    expect(s.phase).toBe("Playing");
    // Force counter to be one kill away from the target
    s = { ...s, killsSinceLastDrop: s.dropJitterTarget - 1, powerUps: [] };
    const target = s.enemies.find((e) => e.isAlive);
    if (!target) throw new Error("no enemy");
    const bullet: Bullet = {
      id: 88002,
      x: target.x,
      y: target.y,
      vx: 0,
      vy: 0,
      owner: "player",
      width: target.width,
      height: target.height,
      damage: 10,
    };
    s = { ...s, playerBullets: [bullet] };
    s = tick(s, 16, NO_INPUT);
    expect(s.powerUps.length).toBe(1);
    expect(s.killsSinceLastDrop).toBe(0); // reset after spawn
  });

  it("does not spawn a second power-up if one is already on screen", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H);
    s = advanceMs(s, 8000);
    const existing = {
      id: 9999,
      type: "lightning" as const,
      x: 100,
      y: 100,
      vy: 0.08,
      width: 24,
      height: 24,
      despawnTimer: 5000,
    };
    s = { ...s, killsSinceLastDrop: s.dropJitterTarget - 1, powerUps: [existing] };
    const target = s.enemies.find((e) => e.isAlive);
    if (!target) throw new Error("no enemy");
    const bullet: Bullet = {
      id: 88003,
      x: target.x,
      y: target.y,
      vx: 0,
      vy: 0,
      owner: "player",
      width: target.width,
      height: target.height,
      damage: 10,
    };
    s = { ...s, playerBullets: [bullet] };
    s = tick(s, 16, NO_INPUT);
    // Still 1 (the existing one, not spawning a second)
    expect(s.powerUps.length).toBe(1);
  });

  it("collecting power-up sets activePowerUp with POWERUP_DURATION remainingMs", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H);
    s = advanceMs(s, 8000);
    // Place a power-up directly on the player
    const pu = {
      id: 8001,
      type: "lightning" as const,
      x: s.player.x,
      y: s.player.y,
      vy: 0,
      width: 24,
      height: 24,
      despawnTimer: 6000,
    };
    s = { ...s, powerUps: [pu] };
    s = tick(s, 16, NO_INPUT);
    expect(s.activePowerUp).not.toBeNull();
    expect(s.activePowerUp!.remainingMs).toBeGreaterThan(POWERUP_DURATION - 50);
    expect(s.powerUps.length).toBe(0); // removed on collection
  });

  it("spawned powerup despawnTimer exceeds travel time to player (regression #1004)", () => {
    // Pre-fix: POWERUP_DESPAWN=6000ms → 480px travel → despawned 76px above ship.
    // Fix: despawnTimer is now canvas-height-derived so the powerup always reaches the ship.
    let s = initStarSwarm(CANVAS_W, CANVAS_H);
    s = advanceMs(s, 8000); // reach Playing phase
    expect(s.phase).toBe("Playing");
    // Force a kill-triggered drop on the next tick
    s = { ...s, killsSinceLastDrop: s.dropJitterTarget - 1, powerUps: [] };
    const target = s.enemies.find((e) => e.isAlive);
    if (!target) throw new Error("no alive enemy");
    const killBullet: Bullet = {
      id: 99001,
      x: target.x,
      y: target.y,
      vx: 0,
      vy: 0,
      owner: "player",
      width: target.width,
      height: target.height,
      damage: 999,
    };
    s = { ...s, playerBullets: [killBullet] };
    s = tick(s, 16, NO_INPUT);
    expect(s.powerUps.length).toBe(1);
    const pu = s.powerUps[0]!;
    // Physics: player sits at canvasH - 72 (PLAYER_Y_FROM_BOTTOM), powerup spawns at y≈12.
    // Verify the despawn timer outlasts the fall so collection can happen.
    const playerY = CANVAS_H - 72;
    const msToReachPlayer = (playerY - pu.y) / 0.08; // POWERUP_VY = 0.08 px/ms
    expect(pu.despawnTimer).toBeGreaterThan(msToReachPlayer);
  });

  it("super state applies damage=4, piercing=true, fast cooldown to player bullets", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H);
    s = advanceMs(s, 8000);
    s = {
      ...s,
      activePowerUp: { remainingMs: 3000, type: "lightning" as const, shieldAbsorbed: 0 },
      player: { ...s.player, shootCooldown: 0 },
    };
    s = tick(s, 16, FIRE_INPUT);
    const bullet = s.playerBullets[s.playerBullets.length - 1];
    expect(bullet).toBeDefined();
    expect(bullet!.damage).toBe(4);
    expect(bullet!.piercing).toBe(true);
    // Cooldown should be the super cooldown (70ms), well below normal 280ms
    expect(s.player.shootCooldown).toBeGreaterThan(0);
    expect(s.player.shootCooldown).toBeLessThan(280);
  });

  it("activePowerUp expires after POWERUP_DURATION ms", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H);
    s = advanceMs(s, 8000);
    s = {
      ...s,
      activePowerUp: { remainingMs: 100, type: "lightning" as const, shieldAbsorbed: 0 },
    };
    s = advanceMs(s, 200, NO_INPUT);
    expect(s.activePowerUp).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// #1032 — Power-up foundation: drops, type field, weighted selection
// ---------------------------------------------------------------------------

describe("#1032 Power-up foundation", () => {
  it("kill-triggered drop has a valid PowerUpType", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H);
    s = advanceMs(s, 8000);
    expect(s.phase).toBe("Playing");
    s = { ...s, killsSinceLastDrop: s.dropJitterTarget - 1, powerUps: [] };
    const target = s.enemies.find((e) => e.isAlive);
    if (!target) throw new Error("no alive enemy");
    const killBullet: Bullet = {
      id: 77001,
      x: target.x,
      y: target.y,
      vx: 0,
      vy: 0,
      owner: "player",
      width: target.width,
      height: target.height,
      damage: 999,
    };
    s = { ...s, playerBullets: [killBullet] };
    s = tick(s, 16, NO_INPUT);
    expect(s.powerUps.length).toBe(1);
    const pu = s.powerUps[0]!;
    expect(["lightning", "shield", "buddy", "bomb"]).toContain(pu.type);
  });

  it("drop spawn X is within canvas safe bounds", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H);
    s = advanceMs(s, 8000);
    s = { ...s, killsSinceLastDrop: s.dropJitterTarget - 1, powerUps: [] };
    const target = s.enemies.find((e) => e.isAlive);
    if (!target) throw new Error("no alive enemy");
    const killBullet: Bullet = {
      id: 77002,
      x: target.x,
      y: target.y,
      vx: 0,
      vy: 0,
      owner: "player",
      width: target.width,
      height: target.height,
      damage: 999,
    };
    s = { ...s, playerBullets: [killBullet] };
    s = tick(s, 16, NO_INPUT);
    const pu = s.powerUps[0]!;
    expect(pu.x).toBeGreaterThanOrEqual(12);
    expect(pu.x).toBeLessThanOrEqual(CANVAS_W - 12);
  });

  it("pauseStraggler initialises to false", () => {
    const s = initStarSwarm(CANVAS_W, CANVAS_H);
    expect(s.pauseStraggler).toBe(false);
  });

  it("applyPowerUp(lightning) sets activePowerUp with type lightning", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H);
    s = advanceMs(s, 8000);
    s = applyPowerUp(s, "lightning");
    expect(s.activePowerUp).not.toBeNull();
    expect(s.activePowerUp!.type).toBe("lightning");
    expect(s.activePowerUp!.remainingMs).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// #1033 — Shield power-up: absorbs bullets, body collision still kills
// ---------------------------------------------------------------------------

describe("#1033 Shield power-up", () => {
  it("shield absorbs an incoming enemy bullet without player taking damage", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H);
    s = advanceMs(s, 8000);
    s = applyPowerUp(s, "shield");
    expect(s.activePowerUp?.type).toBe("shield");

    // Place an enemy bullet directly on the player
    const eb: Bullet = {
      id: 88001,
      x: s.player.x,
      y: s.player.y,
      vx: 0,
      vy: 0.3,
      owner: "enemy",
      width: 6,
      height: 12,
      damage: 1,
    };
    const livesBefore = s.player.lives;
    s = { ...s, enemyBullets: [eb], player: { ...s.player, invincibleTimer: 0 } };
    s = tick(s, 16, NO_INPUT);
    expect(s.player.lives).toBe(livesBefore); // bullet absorbed
    expect(s.enemyBullets.some((b) => b.id === eb.id)).toBe(false); // bullet removed
    expect(s.activePowerUp?.shieldAbsorbed).toBeGreaterThanOrEqual(1);
  });

  it("applyPowerUp(shield) sets type shield", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H);
    s = advanceMs(s, 8000);
    s = applyPowerUp(s, "shield");
    expect(s.activePowerUp!.type).toBe("shield");
  });
});

// ---------------------------------------------------------------------------
// #1034 — Smart Bomb: clears bullets, damages all enemies, flash timer
// ---------------------------------------------------------------------------

describe("#1034 Smart Bomb", () => {
  it("bomb clears all enemy bullets on collection", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H);
    s = advanceMs(s, 8000);
    // Seed some enemy bullets
    const fakeBullets: Bullet[] = [1, 2, 3].map((id) => ({
      id,
      x: 100,
      y: 100,
      vx: 0,
      vy: 0.3,
      owner: "enemy" as const,
      width: 6,
      height: 12,
      damage: 1,
    }));
    // Place bomb power-up on player
    const pu = {
      id: 9901,
      type: "bomb" as const,
      x: s.player.x,
      y: s.player.y,
      vy: 0,
      width: 24,
      height: 24,
      despawnTimer: 6000,
    };
    s = { ...s, enemyBullets: fakeBullets, powerUps: [pu] };
    s = tick(s, 16, NO_INPUT);
    expect(s.enemyBullets.length).toBe(0);
    expect(s.powerUps.length).toBe(0);
  });

  it("bomb deals 1 HP to all alive enemies", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H);
    s = advanceMs(s, 8000);
    const hpsBefore = s.enemies.filter((e) => e.isAlive).map((e) => ({ id: e.id, hp: e.hp }));
    const pu = {
      id: 9902,
      type: "bomb" as const,
      x: s.player.x,
      y: s.player.y,
      vy: 0,
      width: 24,
      height: 24,
      despawnTimer: 6000,
    };
    s = { ...s, powerUps: [pu] };
    s = tick(s, 16, NO_INPUT);
    for (const { id, hp } of hpsBefore) {
      const after = s.enemies.find((e) => e.id === id);
      if (!after) continue; // might have died (hp was 1)
      if (after.tier === "Carrier") continue; // #2484: armored while its escorts live
      if (after.isAlive) {
        expect(after.hp).toBeLessThanOrEqual(hp - 1);
      }
    }
  });

  it("bomb sets bombFlashTimer > 0 immediately after collection", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H);
    s = advanceMs(s, 8000);
    const pu = {
      id: 9903,
      type: "bomb" as const,
      x: s.player.x,
      y: s.player.y,
      vy: 0,
      width: 24,
      height: 24,
      despawnTimer: 6000,
    };
    s = { ...s, powerUps: [pu] };
    s = tick(s, 16, NO_INPUT);
    expect(s.bombFlashTimer).toBeGreaterThan(0);
    // Bomb does NOT set activePowerUp (instant effect)
    expect(s.activePowerUp).toBeNull();
  });

  it("bombFlashTimer decrements to zero over time", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H);
    s = advanceMs(s, 8000);
    s = applyPowerUp(s, "bomb");
    expect(s.bombFlashTimer).toBeGreaterThan(0);
    s = advanceMs(s, 500, NO_INPUT);
    expect(s.bombFlashTimer).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Laser sound gating — only fires during lightning power-up
// The canvas checks: shootCooldown > prevCooldown && activePowerUp?.type === "lightning"
// ---------------------------------------------------------------------------

describe("laser sound gating", () => {
  function playingState(): StarSwarmState {
    let s = initStarSwarm(CANVAS_W, CANVAS_H);
    s = advanceMs(s, 8000); // advance past SwoopIn into Playing
    return s;
  }

  // Mirrors exactly the condition checked in GameCanvas.tsx / GameCanvas.web.tsx
  function laserSoundWouldFire(prev: StarSwarmState, next: StarSwarmState): boolean {
    return (
      next.player.shootCooldown > prev.player.shootCooldown &&
      next.activePowerUp?.type === "lightning"
    );
  }

  it("does not trigger laser sound on normal fire (no power-up)", () => {
    const before = playingState();
    expect(before.player.shootCooldown).toBe(0); // ready to fire
    const after = tick(before, 16, FIRE_INPUT);
    expect(after.player.shootCooldown).toBeGreaterThan(0); // shot was fired, cooldown reset
    expect(laserSoundWouldFire(before, after)).toBe(false);
  });

  it("triggers laser sound on fire during lightning power-up", () => {
    const before = applyPowerUp(playingState(), "lightning");
    expect(before.activePowerUp?.type).toBe("lightning");
    expect(before.player.shootCooldown).toBe(0);
    const after = tick(before, 16, FIRE_INPUT);
    expect(after.player.shootCooldown).toBeGreaterThan(0); // shot was fired
    expect(laserSoundWouldFire(before, after)).toBe(true);
  });

  it("does not trigger laser sound once lightning power-up expires", () => {
    let s = applyPowerUp(playingState(), "lightning");
    // #1314: proportional aiming is more lethal — invincibility prevents GameOver freezing the
    // power-up timer before it can expire.
    s = { ...s, player: { ...s.player, invincibleTimer: 999_999 } };
    s = advanceMs(s, POWERUP_DURATION + 100, FIRE_INPUT); // advance past expiry while firing
    expect(s.activePowerUp).toBeNull();
    // Advance one more frame: cooldown may already be 0 from continuous fire
    const before = { ...s, player: { ...s.player, shootCooldown: 0 } };
    const after = tick(before, 16, FIRE_INPUT);
    expect(after.player.shootCooldown).toBeGreaterThan(0); // still fires shots
    expect(laserSoundWouldFire(before, after)).toBe(false); // but no laser sound
  });

  it("does not trigger laser sound for shield power-up fire", () => {
    const before = applyPowerUp(playingState(), "shield");
    expect(before.activePowerUp?.type).toBe("shield");
    const after = tick(before, 16, FIRE_INPUT);
    expect(laserSoundWouldFire(before, after)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// In-run ship upgrades (#2488)
// ---------------------------------------------------------------------------

describe("In-run ship upgrades (#2488)", () => {
  let nextId = 90_000;
  function quiet(): StarSwarmState {
    const s = advanceMs(initStarSwarm(CANVAS_W, CANVAS_H, 2), 8000);
    return {
      ...s,
      enemyFireDisabled: true,
      enemyBullets: [],
      playerBullets: [],
      asteroids: [],
      asteroidsDisabled: true,
      nextDiveTimer: 1e9,
      pauseStraggler: true,
      powerUps: [],
      player: { ...s.player, x: 40, lives: 3, invincibleTimer: 0, shootCooldown: 0 },
      enemies: s.enemies.map((e) => (e.tier === "Carrier" ? { ...e, beamTimer: 1e9 } : e)),
    };
  }
  const ASIDE: StarSwarmInput = { playerX: 40, fire: false };
  const FIRE_ASIDE: StarSwarmInput = { playerX: 40, fire: true };
  const withPlayer = (s: StarSwarmState, patch: Partial<StarSwarmState["player"]>) => ({
    ...s,
    player: { ...s.player, ...patch },
  });
  const enemyShotOn = (s: StarSwarmState): Bullet => ({
    id: nextId++,
    x: s.player.x,
    y: s.player.y,
    vx: 0,
    vy: 0.3,
    owner: "enemy",
    width: 5,
    height: 10,
    damage: 1,
  });
  const pickupOn = (s: StarSwarmState, type: PowerUp["type"]): PowerUp => ({
    id: nextId++,
    type,
    x: s.player.x,
    y: s.player.y,
    vy: 0,
    width: 24,
    height: 24,
    despawnTimer: 5000,
  });

  it("a new run starts at guns 1, hull 0", () => {
    const s = initStarSwarm(CANVAS_W, CANVAS_H);
    expect(s.player.guns).toBe(1);
    expect(s.player.hull).toBe(0);
    expect(s.player.hullFlashTimer).toBe(0);
  });

  it("a volley is 1, 2 or 4 bullets by gun level; lightning keeps its piercing shots", () => {
    expect(playerVolley(100, 500, 1, false).map((b) => b.x)).toEqual([100]);
    expect(playerVolley(100, 500, 2, false).map((b) => b.x)).toEqual([93, 107]);
    const l3 = playerVolley(100, 500, 3, false);
    expect(l3).toHaveLength(4);
    expect(l3.map((b) => b.vx).sort((a, b) => a - b)).toEqual([-SPREAD_VX, 0, 0, SPREAD_VX]);
    const superL3 = playerVolley(100, 500, 3, true);
    expect(superL3.every((b) => b.piercing === true && b.damage === 4)).toBe(true);

    let s = withPlayer(quiet(), { guns: 3 });
    s = tick(s, 16, FIRE_ASIDE);
    expect(s.playerBullets).toHaveLength(4);
  });

  it("the volley never pushes past MAX_PLAYER_BULLETS", () => {
    let s = withPlayer(quiet(), { guns: 3 });
    const filler: Bullet[] = Array.from({ length: MAX_PLAYER_BULLETS - 1 }, (_, i) => ({
      id: nextId++,
      x: 50 + i,
      y: 520,
      vx: 0,
      vy: -0.56,
      owner: "player",
      width: 5,
      height: 14,
      damage: 1,
    }));
    s = tick({ ...s, playerBullets: filler }, 16, FIRE_ASIDE);
    expect(s.playerBullets.length).toBe(MAX_PLAYER_BULLETS);
  });

  it("hit order is shield → hull → life; a death costs one gun level, floored at 1", () => {
    // hull takes the hit: no life lost, plating flash, short grace, bullet spent
    let s = withPlayer(quiet(), { hull: 1 });
    s = tick({ ...s, enemyBullets: [enemyShotOn(s)] }, 16, ASIDE);
    expect(s.player.lives).toBe(3);
    expect(s.player.hull).toBe(0);
    expect(s.player.hullFlashTimer).toBeGreaterThan(0);
    expect(s.player.invincibleTimer).toBeGreaterThanOrEqual(HULL_INVINCIBLE_MS - 16);
    expect(s.enemyBullets).toHaveLength(0);

    // shield first: plating untouched
    s = applyPowerUp(withPlayer(quiet(), { hull: 1 }), "shield");
    s = tick({ ...s, enemyBullets: [enemyShotOn(s)] }, 16, ASIDE);
    expect(s.player.lives).toBe(3);
    expect(s.player.hull).toBe(1);

    // no plating: a life and a gun level
    s = withPlayer(quiet(), { guns: 3, hull: 0 });
    s = tick({ ...s, enemyBullets: [enemyShotOn(s)] }, 16, ASIDE);
    expect(s.player.lives).toBe(2);
    expect(s.player.guns).toBe(2);
    s = withPlayer(quiet(), { guns: 1 });
    s = tick({ ...s, enemyBullets: [enemyShotOn(s)] }, 16, ASIDE);
    expect(s.player.guns).toBe(1);
  });

  it("plating absorbs a ram, and the rammer still dies", () => {
    let s = withPlayer(quiet(), { hull: 1 });
    const grunt = s.enemies.find((e) => e.isAlive && e.tier === "Grunt")!;
    const ram = { x: s.player.x, y: s.player.y };
    s = {
      ...s,
      enemies: s.enemies.map((e) =>
        e.id === grunt.id
          ? {
              ...e,
              phase: "Circling" as const,
              x: ram.x,
              y: ram.y,
              circleCx: ram.x,
              circleCy: ram.y,
              circleRadius: 0,
              circleAngle: 0,
            }
          : e
      ),
    };
    s = tick(s, 16, ASIDE);
    expect(s.player.lives).toBe(3);
    expect(s.player.hull).toBe(0);
    expect(s.enemies.find((e) => e.id === grunt.id)!.isAlive).toBe(false);
  });

  it("a broken large rock can drop salvage, whoever broke it", () => {
    let byPlayer = 0;
    let byEnemy = 0;
    const N = 60;
    for (let i = 0; i < N; i++) {
      const base = quiet();
      // consecutive LCG seeds give near-identical first outputs — scatter them
      seedRng(Math.imul(5000 + i, 2654435761) >>> 0);
      const rock: Asteroid = {
        id: nextId++,
        kind: "large",
        x: CANVAS_W / 2,
        y: 460,
        vx: 0,
        vy: 0,
        radius: ASTEROID_STATS.large.radius,
        hp: 1,
        rotation: 0,
        spin: 0,
        hitFlashTimer: 0,
        hitEnemyIds: [],
      };
      const shot = (owner: "player" | "enemy"): Bullet => ({
        id: nextId++,
        x: rock.x,
        y: rock.y,
        vx: 0,
        vy: 0,
        owner,
        width: 5,
        height: 10,
        damage: 1,
      });
      let s = tick({ ...base, asteroids: [rock], playerBullets: [shot("player")] }, 16, ASIDE);
      if (s.powerUps.some((p) => p.type === "salvage")) byPlayer++;
      seedRng(Math.imul(7000 + i, 2654435761) >>> 0);
      s = tick({ ...base, asteroids: [rock], enemyBullets: [shot("enemy")] }, 16, ASIDE);
      if (s.powerUps.some((p) => p.type === "salvage")) byEnemy++;
    }
    expect(byPlayer).toBeGreaterThan(N * 0.2);
    expect(byPlayer).toBeLessThan(N * 0.65);
    expect(byEnemy).toBeGreaterThan(N * 0.2);
  });

  it("salvage raises the gun level up to 3 for no points; plating stacks up to 2", () => {
    let s = { ...quiet(), score: 777 };
    s = tick({ ...s, powerUps: [pickupOn(s, "salvage")] }, 16, ASIDE);
    expect(s.player.guns).toBe(2);
    expect(s.score).toBe(777);
    s = withPlayer(s, { guns: GUNS_MAX });
    s = tick({ ...s, powerUps: [pickupOn(s, "salvage")] }, 16, ASIDE);
    expect(s.player.guns).toBe(GUNS_MAX);
    expect(s.powerUps).toHaveLength(0);

    s = tick({ ...s, powerUps: [pickupOn(s, "hull")] }, 16, ASIDE);
    expect(s.player.hull).toBe(1);
    s = withPlayer(s, { hull: HULL_MAX });
    s = tick({ ...s, powerUps: [pickupOn(s, "hull")] }, 16, ASIDE);
    expect(s.player.hull).toBe(HULL_MAX);
  });

  it("the Carrier drops hull plating when it dies", () => {
    let s = quiet();
    const c = s.enemies.find((e) => e.isAlive && e.tier === "Carrier")!;
    s = {
      ...s,
      enemies: s.enemies.map((e) =>
        e.tier === "Guardian"
          ? { ...e, isAlive: false, hp: 0 }
          : e.id === c.id
            ? { ...e, hp: 1 }
            : e
      ),
      playerBullets: [
        {
          id: nextId++,
          x: c.x,
          y: c.y,
          vx: 0,
          vy: 0,
          owner: "player",
          width: 5,
          height: 14,
          damage: 1,
        },
      ],
    };
    s = tick(s, 16, ASIDE);
    expect(s.enemies.find((e) => e.id === c.id)!.isAlive).toBe(false);
    const drop = s.powerUps.find((p) => p.type === "hull");
    expect(drop).toBeDefined();
    expect(Math.abs(drop!.x - c.x)).toBeLessThan(1);
  });

  it("dev-panel applyPowerUp raises the ladders too", () => {
    const s = quiet();
    expect(applyPowerUp(s, "salvage").player.guns).toBe(2);
    expect(applyPowerUp(s, "hull").player.hull).toBe(1);
  });

  it("upgradeEvents reports ladder changes", () => {
    const a = quiet();
    const kinds = (b: StarSwarmState) => upgradeEvents(a, b).map((e) => e.kind);
    expect(kinds(withPlayer(a, { guns: 2 }))).toEqual(["gunsUp"]);
    expect(kinds(withPlayer(a, { hull: 1 }))).toEqual(["hullUp"]);
    expect(
      upgradeEvents(withPlayer(a, { guns: 3 }), withPlayer(a, { guns: 2 })).map((e) => e.kind)
    ).toEqual(["gunsDown"]);
    const armored = withPlayer(a, { hull: 1 });
    expect(upgradeEvents(armored, withPlayer(armored, { hull: 0 })).map((e) => e.kind)).toEqual([
      "hullHit",
    ]);
    expect(kinds(a)).toEqual([]);
  });

  it("one beam costs at most one plate: it is spent on the ship", () => {
    let s = withPlayer(quiet(), { hull: 2, x: CANVAS_W / 2 });
    // #2843: a long bolt still overlapping the ship after the plating's grace would run out
    s = { ...s, carrierBeams: [makeBeam(CANVAS_W / 2, s.player.y, { vy: 0.02 })] };
    const inBeam: StarSwarmInput = { playerX: CANVAS_W / 2, fire: false };
    for (let t = 0; t < 2000; t += 16) s = tick(s, 16, inBeam);
    expect(s.player.hull).toBe(1);
    expect(s.player.lives).toBe(3);
    expect(s.carrierBeams).toHaveLength(0);
  });

  it("a rock that shatters on the ship never pays salvage", () => {
    for (let i = 0; i < 30; i++) {
      const base = quiet();
      seedRng(Math.imul(9000 + i, 2654435761) >>> 0);
      const rock: Asteroid = {
        id: nextId++,
        kind: "large",
        x: base.player.x,
        y: base.player.y,
        vx: 0,
        vy: 0,
        radius: ASTEROID_STATS.large.radius,
        hp: ASTEROID_STATS.large.hp,
        rotation: 0,
        spin: 0,
        hitFlashTimer: 0,
        hitEnemyIds: [],
      };
      const s = tick({ ...base, asteroids: [rock] }, 16, ASIDE);
      expect(s.asteroids).toHaveLength(0); // shattered on the hull
      expect(s.powerUps.some((p) => p.type === "salvage")).toBe(false);
    }
  });

  it("the Carrier drops plating when a bomb kills it — pickup and dev-panel paths", () => {
    const exposedAtOneHp = (s: StarSwarmState) => ({
      ...s,
      enemies: s.enemies.map((e) =>
        e.tier === "Guardian"
          ? { ...e, isAlive: false, hp: 0 }
          : e.tier === "Carrier"
            ? { ...e, hp: 1 }
            : e
      ),
    });
    let s = exposedAtOneHp(quiet());
    s = tick({ ...s, powerUps: [pickupOn(s, "bomb")] }, 16, ASIDE);
    expect(s.enemies.find((e) => e.tier === "Carrier")!.isAlive).toBe(false);
    expect(s.powerUps.some((p) => p.type === "hull")).toBe(true);

    const dev = applyPowerUp(exposedAtOneHp(quiet()), "bomb");
    expect(dev.enemies.find((e) => e.tier === "Carrier")!.isAlive).toBe(false);
    expect(dev.powerUps.some((p) => p.type === "hull")).toBe(true);
  });

  it("a falling salvage crate does not block the next power-up drop", () => {
    let s = quiet();
    const crate = { ...pickupOn(s, "salvage"), x: 300, y: 100 }; // falling, nowhere near the ship
    const target = s.enemies.find(
      (e) => e.isAlive && e.tier === "Grunt" && e.phase === "Formation"
    )!;
    s = {
      ...s,
      powerUps: [crate],
      killsSinceLastDrop: s.dropJitterTarget - 1,
      playerBullets: [
        {
          id: nextId++,
          x: target.x,
          y: target.y,
          vx: 0,
          vy: 0,
          owner: "player",
          width: 24,
          height: 24,
          damage: 10,
        },
      ],
    };
    s = tick(s, 16, ASIDE);
    expect(s.powerUps.some((p) => p.id === crate.id)).toBe(true);
    expect(s.powerUps.some((p) => p.type !== "salvage" && p.type !== "hull")).toBe(true);
  });

  it("the ladders survive a wave clear but reset on a new game", () => {
    let s = withPlayer(quiet(), { guns: 3, hull: 2 });
    s = clearWave(s, ASIDE);
    expect(s.wave).toBe(3);
    expect(s.player.guns).toBe(3);
    expect(s.player.hull).toBe(2);
    const fresh = initStarSwarm(CANVAS_W, CANVAS_H);
    expect(fresh.player.guns).toBe(1);
    expect(fresh.player.hull).toBe(0);
  });
});
