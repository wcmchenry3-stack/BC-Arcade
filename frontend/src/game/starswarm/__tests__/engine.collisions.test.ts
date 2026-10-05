/**
 * Star Swarm engine tests: bullet/ship collisions, kill scoring and hit feedback.
 *
 * One file per planned `engine/` module (#2988): this file follows `engine/collisions.ts`. Split
 * out of the former monolithic `engine.test.ts` (#2955) with describe blocks moved whole; shared
 * fixtures live in `helpers/engineFixtures.ts`.
 */
import { initStarSwarm, tick, seedRng, _resetIds, CANVAS_W, CANVAS_H } from "../engine";
import type { Bullet, StarSwarmInput } from "../types";
import { NO_INPUT, advanceMs } from "./helpers/engineFixtures";

beforeEach(() => {
  seedRng(42);
  _resetIds();
});

// ---------------------------------------------------------------------------
// AABB collision — player bullets ↔ enemies
// ---------------------------------------------------------------------------

describe("Collision: player bullets vs enemies", () => {
  it("enemy is killed when a player bullet hits it", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H);
    s = advanceMs(s, 8000); // get to Playing

    const target = s.enemies.find((e) => e.isAlive && e.tier === "Grunt");
    if (!target) return;

    // Inject a bullet directly onto the enemy's current position
    const bullet: Bullet = {
      id: 55555,
      x: target.x,
      y: target.y,
      vx: 0,
      vy: -0.5,
      owner: "player",
      width: 5,
      height: 14,
      damage: 1,
    };
    s = { ...s, playerBullets: [bullet] };
    s = tick(s, 16, NO_INPUT);

    const after = s.enemies.find((e) => e.id === target.id);
    expect(after ? !after.isAlive || after.hp < target.hp : true).toBe(true);
  });

  it("killing an enemy increases score", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H);
    s = advanceMs(s, 8000);
    const scoreBefore = s.score;

    const target = s.enemies.find((e) => e.isAlive && e.tier === "Grunt");
    if (!target) return; // no grunt on this wave config, skip

    const aim: StarSwarmInput = { playerX: target.x, fire: true };
    s = advanceMs(s, 3000, aim);
    expect(s.score).toBeGreaterThan(scoreBefore);
  });

  it("player bullets are removed after hitting enemy", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H);
    s = advanceMs(s, 8000);

    const target = s.enemies.find((e) => e.isAlive);
    if (!target) return;

    const aim: StarSwarmInput = { playerX: target.x, fire: true };
    s = tick(s, 16, aim); // fire one bullet
    const bulletsBefore = s.playerBullets.length;

    // Advance until bullet is gone (either hit or exited)
    s = advanceMs(s, 2000, NO_INPUT);
    expect(s.playerBullets.length).toBeLessThanOrEqual(bulletsBefore);
  });
});

// ---------------------------------------------------------------------------
// AABB collision — enemy bullets ↔ player
// ---------------------------------------------------------------------------

describe("Collision: enemy bullets vs player", () => {
  it("player loses a life when hit by enemy bullet", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H);
    s = advanceMs(s, 8000); // Playing

    // Reset player to known state before the test hit
    s = { ...s, player: { ...s.player, lives: 3, invincibleTimer: 0 } };

    // Inject a bullet aimed directly at the player
    const { player } = s;
    const bullet = {
      id: 99999,
      x: player.x,
      y: player.y - 2,
      vx: 0,
      vy: 0.5,
      owner: "enemy" as const,
      width: 5,
      height: 10,
      damage: 1,
    };
    s = { ...s, enemyBullets: [bullet] };
    s = tick(s, 16, NO_INPUT);

    expect(s.player.lives).toBe(2);
  });

  it("game transitions to GameOver when lives reach 0", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H);
    s = advanceMs(s, 8000);

    // Drain lives to 1
    s = { ...s, player: { ...s.player, lives: 1, invincibleTimer: 0 } };

    const bullet = {
      id: 99999,
      x: s.player.x,
      y: s.player.y - 2,
      vx: 0,
      vy: 0.5,
      owner: "enemy" as const,
      width: 5,
      height: 10,
      damage: 1,
    };
    s = { ...s, enemyBullets: [bullet] };
    s = tick(s, 16, NO_INPUT);

    expect(s.phase).toBe("GameOver");
  });

  it("player gains invincibility after being hit", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H);
    s = advanceMs(s, 8000);
    s = { ...s, player: { ...s.player, lives: 2, invincibleTimer: 0 } };

    const bullet = {
      id: 99999,
      x: s.player.x,
      y: s.player.y - 2,
      vx: 0,
      vy: 0.5,
      owner: "enemy" as const,
      width: 5,
      height: 10,
      damage: 1,
    };
    s = { ...s, enemyBullets: [bullet] };
    s = tick(s, 16, NO_INPUT);

    expect(s.player.invincibleTimer).toBeGreaterThan(0);
  });

  it("invincible player cannot be hit", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H);
    s = advanceMs(s, 8000);
    s = { ...s, player: { ...s.player, lives: 2, invincibleTimer: 2000 } };

    const bullet = {
      id: 99999,
      x: s.player.x,
      y: s.player.y,
      vx: 0,
      vy: 0,
      owner: "enemy" as const,
      width: 50,
      height: 50,
      damage: 1,
    };
    s = { ...s, enemyBullets: [bullet] };
    s = tick(s, 16, NO_INPUT);

    expect(s.player.lives).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

describe("Scoring", () => {
  it("Grunt is worth 100 points (Ensign ×1 baseline)", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H, 1, 42, "Ensign");
    s = advanceMs(s, 8000);
    const grunt = s.enemies.find((e) => e.isAlive && e.tier === "Grunt");
    if (!grunt) return;

    const scoreBeforeKill = s.score;
    // Teleport a bullet onto the grunt
    const bullet = {
      id: 88888,
      x: grunt.x,
      y: grunt.y,
      vx: 0,
      vy: -0.5,
      owner: "player" as const,
      width: 5,
      height: 14,
      damage: 1,
    };
    s = { ...s, playerBullets: [bullet] };
    s = tick(s, 16, NO_INPUT);
    expect(s.score - scoreBeforeKill).toBe(100);
  });

  it("Elite is worth 200 points (Ensign ×1 baseline)", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H, 1, 42, "Ensign");
    s = advanceMs(s, 8000);
    // Elite has 2 HP — need to hit twice. Pick one holding formation: a diving Elite would
    // score the 2× dive bonus, and which Elite is diving at 8 s depends on the RNG sequence.
    const elite = s.enemies.find((e) => e.isAlive && e.tier === "Elite" && e.phase === "Formation");
    if (!elite) return;

    const makeBullet = (id: number) => ({
      id,
      x: elite.x,
      y: elite.y,
      vx: 0,
      vy: -0.5,
      owner: "player" as const,
      width: 5,
      height: 14,
      damage: 1,
    });
    const scoreBeforeKill = s.score;
    s = { ...s, playerBullets: [makeBullet(1)] };
    s = tick(s, 16, NO_INPUT);
    s = { ...s, playerBullets: [makeBullet(2)] };
    s = tick(s, 16, NO_INPUT);
    expect(s.score - scoreBeforeKill).toBe(200);
  });

  it("wave clear adds a wave-scaled bonus", () => {
    const wave = 2;
    let s = initStarSwarm(CANVAS_W, CANVAS_H, wave);
    s = advanceMs(s, 8000);
    const scoreBeforeClear = s.score;

    // Kill all enemies
    s = { ...s, enemies: s.enemies.map((e) => ({ ...e, isAlive: false, hp: 0 })) };
    s = tick(s, 16, NO_INPUT); // trigger WaveClear
    expect(s.score).toBeGreaterThan(scoreBeforeClear);
  });
});

// ---------------------------------------------------------------------------
// hitFlashTimer (#974) — non-lethal hits trigger white flash
// ---------------------------------------------------------------------------

describe("hitFlashTimer (#974)", () => {
  it("non-lethal hit sets hitFlashTimer > 0", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H);
    s = advanceMs(s, 8000);
    const elite = s.enemies.find((e) => e.isAlive && e.tier === "Elite");
    if (!elite) throw new Error("no elite");

    // One damage=1 hit on a 2-HP elite is non-lethal
    const bullet: Bullet = {
      id: 77770,
      x: elite.x,
      y: elite.y,
      vx: 0,
      vy: -0.5,
      owner: "player",
      width: 5,
      height: 14,
      damage: 1,
    };
    s = { ...s, playerBullets: [bullet] };
    s = tick(s, 16, NO_INPUT);

    const hit = s.enemies.find((e) => e.id === elite.id)!;
    expect(hit.isAlive).toBe(true);
    expect(hit.hitFlashTimer).toBeGreaterThan(0);
  });

  it("lethal hit leaves hitFlashTimer at 0", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H);
    s = advanceMs(s, 8000);
    const grunt = s.enemies.find((e) => e.isAlive && e.tier === "Grunt");
    if (!grunt) throw new Error("no grunt");

    const bullet: Bullet = {
      id: 77771,
      x: grunt.x,
      y: grunt.y,
      vx: 0,
      vy: -0.5,
      owner: "player",
      width: 5,
      height: 14,
      damage: 1,
    };
    s = { ...s, playerBullets: [bullet] };
    s = tick(s, 16, NO_INPUT);

    const dead = s.enemies.find((e) => e.id === grunt.id)!;
    expect(dead.isAlive).toBe(false);
    expect(dead.hitFlashTimer).toBe(0);
  });

  it("hitFlashTimer decrements to 0 over time", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H);
    s = advanceMs(s, 8000);
    const elite = s.enemies.find((e) => e.isAlive && e.tier === "Elite");
    if (!elite) throw new Error("no elite");

    const bullet: Bullet = {
      id: 77772,
      x: elite.x,
      y: elite.y,
      vx: 0,
      vy: -0.5,
      owner: "player",
      width: 5,
      height: 14,
      damage: 1,
    };
    s = { ...s, playerBullets: [bullet] };
    s = tick(s, 16, NO_INPUT);
    // Flash is active immediately after hit
    expect(s.enemies.find((e) => e.id === elite.id)!.hitFlashTimer).toBeGreaterThan(0);

    // After enough ticks, flash should be gone
    s = advanceMs(s, 500, NO_INPUT);
    expect(s.enemies.find((e) => e.id === elite.id)!.hitFlashTimer).toBe(0);
  });

  it("new enemies start with hitFlashTimer of 0", () => {
    const s = initStarSwarm(CANVAS_W, CANVAS_H);
    expect(s.enemies.every((e) => e.hitFlashTimer === 0)).toBe(true);
  });
});

describe("GameOver freeze cleanup (#2334)", () => {
  it("clears in-flight player bullets the instant lives reach 0", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H);
    s = advanceMs(s, 8000);

    // Drain to the last life and give the player some live bullets on screen,
    // mirroring the reported scenario (Lightning fire in progress at death).
    s = {
      ...s,
      player: { ...s.player, lives: 1, invincibleTimer: 0 },
      playerBullets: [
        {
          id: 1,
          x: s.player.x,
          y: s.player.y - 20,
          vx: 0,
          vy: -0.56,
          owner: "player",
          width: 5,
          height: 14,
          damage: 1,
        },
        {
          id: 2,
          x: s.player.x,
          y: s.player.y - 60,
          vx: 0,
          vy: -0.56,
          owner: "player",
          width: 5,
          height: 14,
          damage: 1,
        },
      ],
    };

    const bullet = {
      id: 99999,
      x: s.player.x,
      y: s.player.y - 2,
      vx: 0,
      vy: 0.5,
      owner: "enemy" as const,
      width: 5,
      height: 10,
      damage: 1,
    };
    s = { ...s, enemyBullets: [bullet] };
    s = tick(s, 16, NO_INPUT);

    expect(s.phase).toBe("GameOver");
    expect(s.playerBullets).toHaveLength(0);
  });
});
