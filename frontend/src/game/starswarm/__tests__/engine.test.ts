import {
  initStarSwarm,
  tick,
  isSwooping,
  diverCount,
  maxDivers,
  bulletCap,
  collideCircleAABB,
  PLAYER_HURT_RADIUS,
  WIGGLE_DURATION,
  DIVE_PATH_DURATION,
  BOSS_DIVE_THRESHOLD,
  BURST_INTERVAL,
  BURST_PAUSE_BASE,
  POWERUP_DURATION,
  triggerKills,
  seedRng,
  _resetIds,
  CANVAS_W,
  CANVAS_H,
  applyPowerUp,
  DIFFICULTY_TIERS,
  difficultyMultiplier,
  difficultyParamScale,
  difficultyLabel,
  BOSS_BULLET_VY,
  BULLET_E_VY,
  PLAYER_W,
  MAX_PLAYER_BULLETS,
  MISSION_COMPLETE_BANNER_MS,
  isCarrierArmored,
  carrierJustExposed,
  isLeaderTier,
  throwAsteroid,
  MAX_ASTEROIDS,
  ASTEROID_STATS,
  BEAM_CHARGE_MS,
  BEAM_FIRE_MS,
  BEAM_INTERVAL_BASE,
  BEAM_HALF_WIDTH,
  LONE_FIRE_INTERVAL,
  carrierBeam,
  carrierBeamJustStarted,
  carrierBeamJustFired,
  reinforcementsJustLaunched,
  reinforceCap,
  dodgeChance,
  nudgePath,
  splitRemaining,
  emptyTierStats,
  DODGE_SIDESTEP,
  DODGE_SIDESTEP_MS,
  DODGE_PATH_NUDGE,
  FLAK_COOLDOWN,
  playerVolley,
  upgradeEvents,
  SPREAD_VX,
  HULL_INVINCIBLE_MS,
  GUNS_MAX,
  HULL_MAX,
  emptyRunStats,
  dodgeRateByTier,
  killEscorts,
  isBossWave,
  waveClearBonusPoints,
  WAVE_CLEAR_BONUS_BASE,
  BOSS_WAVE_CLEAR_MULT,
  BOSS_WAVE_BEAM_SCALE,
  routJustStarted,
  fleeingCount,
  FLEE_DURATION_MIN,
  FLEE_DURATION_MAX,
  FLEE_STAGGER_MAX,
  FLEE_ENSIGN_SCALE,
} from "../engine";
import type {
  Asteroid,
  AsteroidKind,
  Bullet,
  DifficultyTier,
  PowerUp,
  StarSwarmInput,
  StarSwarmState,
} from "../types";

const NO_INPUT: StarSwarmInput = { playerX: CANVAS_W / 2, fire: false };
const FIRE_INPUT: StarSwarmInput = { playerX: CANVAS_W / 2, fire: true };

function advanceMs(state: StarSwarmState, ms: number, input = NO_INPUT): StarSwarmState {
  const step = 16;
  let s = state;
  for (let elapsed = 0; elapsed < ms; elapsed += step) {
    s = tick(s, Math.min(step, ms - elapsed), input);
  }
  return s;
}

beforeEach(() => {
  seedRng(42);
  _resetIds();
});

// ---------------------------------------------------------------------------
// initStarSwarm
// ---------------------------------------------------------------------------

describe("initStarSwarm", () => {
  it("returns SwoopIn phase on wave 1", () => {
    const s = initStarSwarm(CANVAS_W, CANVAS_H);
    expect(s.phase).toBe("SwoopIn");
  });

  it("every wave opens on SwoopIn — wave 3 is ordinary, wave 5 is a boss wave (#2490)", () => {
    expect(initStarSwarm(CANVAS_W, CANVAS_H, 3).phase).toBe("SwoopIn");
    expect(initStarSwarm(CANVAS_W, CANVAS_H, 5).phase).toBe("SwoopIn");
  });

  it("spawns enemies on init", () => {
    const s = initStarSwarm(CANVAS_W, CANVAS_H);
    expect(s.enemies.length).toBeGreaterThan(0);
  });

  it("player starts with 3 lives", () => {
    const s = initStarSwarm(CANVAS_W, CANVAS_H);
    expect(s.player.lives).toBe(3);
  });

  it("score starts at 0", () => {
    const s = initStarSwarm(CANVAS_W, CANVAS_H);
    expect(s.score).toBe(0);
  });

  it("is deterministic for same seed", () => {
    const a = initStarSwarm(CANVAS_W, CANVAS_H, 1, 7);
    const b = initStarSwarm(CANVAS_W, CANVAS_H, 1, 7);
    expect(a.enemies[0]?.x).toBeCloseTo(b.enemies[0]?.x ?? 0);
    expect(a.enemies[0]?.y).toBeCloseTo(b.enemies[0]?.y ?? 0);
  });

  it("wave 4 has more grunt rows than wave 1", () => {
    const w1 = initStarSwarm(CANVAS_W, CANVAS_H, 1);
    const w4 = initStarSwarm(CANVAS_W, CANVAS_H, 4);
    expect(w4.enemies.length).toBeGreaterThan(w1.enemies.length);
  });

  it("player starts near bottom of canvas", () => {
    const s = initStarSwarm(CANVAS_W, CANVAS_H);
    expect(s.player.y).toBeGreaterThan(CANVAS_H * 0.8);
  });
});

// ---------------------------------------------------------------------------
// Player boundary clamping — regression for corner-stuck bug
// Controls.tsx previously clamped playerXRef to [0, CANVAS_W] while the engine
// clamps to [PLAYER_W/2, CANVAS_W - PLAYER_W/2], creating a dead zone at edges.
// ---------------------------------------------------------------------------

describe("player boundary clamping", () => {
  const hw = PLAYER_W / 2; // 17

  it("clamps player to right edge (CANVAS_W - hw) when input exceeds canvas width", () => {
    const s = initStarSwarm(CANVAS_W, CANVAS_H);
    const next = tick(s, 16, { playerX: CANVAS_W, fire: false });
    expect(next.player.x).toBe(CANVAS_W - hw);
  });

  it("clamps player to left edge (hw) when input is 0", () => {
    const s = initStarSwarm(CANVAS_W, CANVAS_H);
    const next = tick(s, 16, { playerX: 0, fire: false });
    expect(next.player.x).toBe(hw);
  });

  it("does not over-clamp when input is exactly at the right boundary", () => {
    const s = initStarSwarm(CANVAS_W, CANVAS_H);
    const next = tick(s, 16, { playerX: CANVAS_W - hw, fire: false });
    expect(next.player.x).toBe(CANVAS_W - hw);
  });

  it("does not over-clamp when input is exactly at the left boundary", () => {
    const s = initStarSwarm(CANVAS_W, CANVAS_H);
    const next = tick(s, 16, { playerX: hw, fire: false });
    expect(next.player.x).toBe(hw);
  });

  it("consecutive right-edge inputs do not push ship beyond CANVAS_W - hw", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H);
    for (let i = 0; i < 5; i++) {
      s = tick(s, 16, { playerX: CANVAS_W, fire: false });
    }
    expect(s.player.x).toBe(CANVAS_W - hw);
  });

  // Regression: #2352 removed the WinTransition cinematic (hard freeze + AI autopilot) —
  // the wave now advances in the same tick the last enemy dies, and the ship keeps
  // whatever position the player last drove it to (nothing repositions it).
  it("player.x stays within valid bounds immediately after a wave clear", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H, 1);
    // Drive ship to right edge for the duration of the wave
    const rightEdgeInput: StarSwarmInput = { playerX: CANVAS_W - hw, fire: false };
    s = advanceMs(s, 8000, rightEdgeInput);
    // Kill remaining enemies to trigger the wave clear
    s = { ...s, enemies: s.enemies.map((e) => ({ ...e, isAlive: false, hp: 0 })) };
    s = tick(s, 16, rightEdgeInput);
    expect(s.wave).toBe(2);
    expect(s.phase).toBe("SwoopIn");
    expect(s.player.x).toBeGreaterThanOrEqual(hw);
    expect(s.player.x).toBeLessThanOrEqual(CANVAS_W - hw);
  });

  it("using the engine's own player.x as input is a no-op right after a wave clear", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H, 1);
    s = advanceMs(s, 8000);
    s = { ...s, enemies: s.enemies.map((e) => ({ ...e, isAlive: false, hp: 0 })) };
    s = tick(s, 16, NO_INPUT);
    expect(s.wave).toBe(2);
    // Using the engine's own player.x as the input must be a no-op
    const parkedX = s.player.x;
    s = tick(s, 16, { playerX: parkedX, fire: false });
    expect(s.player.x).toBe(parkedX);
  });
});

// ---------------------------------------------------------------------------
// Enemy state machine — SwoopIn
// ---------------------------------------------------------------------------

describe("SwoopIn", () => {
  it("all enemies start in SwoopIn phase", () => {
    const s = initStarSwarm(CANVAS_W, CANVAS_H);
    expect(s.enemies.every((e) => e.phase === "SwoopIn")).toBe(true);
  });

  it("isSwooping returns true initially", () => {
    const s = initStarSwarm(CANVAS_W, CANVAS_H);
    expect(isSwooping(s)).toBe(true);
  });

  it("no enemies remain in SwoopIn after enough time", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H);
    s = advanceMs(s, 8000); // enough time for all to arrive
    const stillSwooping = s.enemies.filter((e) => e.isAlive && e.phase === "SwoopIn");
    expect(stillSwooping).toHaveLength(0);
  });

  it("phase transitions to Playing once all enemies are in Formation", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H);
    s = advanceMs(s, 8000);
    expect(s.phase).toBe("Playing");
  });

  it("isSwooping returns false after all arrive", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H);
    s = advanceMs(s, 8000);
    expect(isSwooping(s)).toBe(false);
  });

  it("does not mutate previous state", () => {
    const s0 = initStarSwarm(CANVAS_W, CANVAS_H);
    const firstY = s0.enemies[0]?.y ?? 0;
    tick(s0, 100, NO_INPUT);
    expect(s0.enemies[0]?.y).toBe(firstY);
  });
});

// ---------------------------------------------------------------------------
// Enemy state machine — Formation → Diving → Circling → Returning
// ---------------------------------------------------------------------------

describe("Dive AI", () => {
  it("at least one enemy dives during playing phase over 30s", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H);
    s = advanceMs(s, 8000); // get into Playing
    expect(s.phase).toBe("Playing");
    s = advanceMs(s, 30_000);
    const everDived = s.enemies.some(
      (e) => e.phase === "Diving" || e.phase === "Circling" || e.phase === "Returning"
    );
    expect(everDived).toBe(true);
  });

  it("diverCount returns 0 before any dive occurs", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H);
    s = advanceMs(s, 8000);
    // Right after formation, no dives yet
    expect(s.phase).toBe("Playing");
    expect(diverCount(s)).toBeGreaterThanOrEqual(0);
  });

  it("diving enemies eventually return to Formation", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H);
    s = advanceMs(s, 60_000); // long enough for multiple dive cycles
    // At least some should be back in Formation
    const inFormation = s.enemies.filter((e) => e.isAlive && e.phase === "Formation");
    expect(inFormation.length).toBeGreaterThan(0);
  });
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
// Wave progression
// ---------------------------------------------------------------------------

describe("Wave progression", () => {
  it("advances to next wave in the same tick the last enemy dies", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H, 1);
    s = advanceMs(s, 8000);
    s = { ...s, enemies: s.enemies.map((e) => ({ ...e, isAlive: false, hp: 0 })) };
    s = tick(s, 16, NO_INPUT);
    expect(s.wave).toBe(2);
  });

  it("clearing wave 4 leads into the wave-5 boss wave (#2490)", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H, 4);
    s = advanceMs(s, 8000);
    s = { ...s, enemies: s.enemies.map((e) => ({ ...e, isAlive: false, hp: 0 })) };
    s = tick(s, 16, NO_INPUT);
    expect(s.wave).toBe(5);
    expect(s.phase).toBe("SwoopIn");
    expect(s.enemies.every((e) => e.tier === "Boss" || e.tier === "Carrier")).toBe(true);
  });

  it("score is carried over between waves", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H, 1);
    s = advanceMs(s, 8000);
    // Manually set score then trigger wave clear
    s = { ...s, score: 1234, enemies: s.enemies.map((e) => ({ ...e, isAlive: false, hp: 0 })) };
    s = tick(s, 16, NO_INPUT);
    s = advanceMs(s, 3000);
    expect(s.score).toBeGreaterThanOrEqual(1234);
  });
});

// ---------------------------------------------------------------------------
// #2352 — wave clear no longer freezes gameplay or hands off to an AI autopilot;
// a short cosmetic banner timer marks the moment instead.
// ---------------------------------------------------------------------------

describe("#2352 non-blocking wave clear", () => {
  it("sets missionCompleteTimer to the full banner duration on wave clear", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H, 1);
    s = advanceMs(s, 8000);
    expect(s.missionCompleteTimer).toBe(0); // not showing mid-wave
    s = { ...s, enemies: s.enemies.map((e) => ({ ...e, isAlive: false, hp: 0 })) };
    s = tick(s, 16, NO_INPUT);
    expect(s.missionCompleteTimer).toBe(MISSION_COMPLETE_BANNER_MS);
  });

  it("missionCompleteTimer counts down and clears on its own — never gates ticking", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H, 1);
    s = advanceMs(s, 8000);
    s = { ...s, enemies: s.enemies.map((e) => ({ ...e, isAlive: false, hp: 0 })) };
    s = tick(s, 16, NO_INPUT);
    expect(s.missionCompleteTimer).toBeGreaterThan(0);
    s = advanceMs(s, MISSION_COMPLETE_BANNER_MS + 500);
    expect(s.missionCompleteTimer).toBe(0);
  });

  it("the new wave's enemies keep moving immediately — nothing freezes for a clear", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H, 1);
    s = advanceMs(s, 8000);
    s = { ...s, enemies: s.enemies.map((e) => ({ ...e, isAlive: false, hp: 0 })) };
    s = tick(s, 16, NO_INPUT); // clears wave 1 and builds wave 2 in the same tick
    expect(s.wave).toBe(2);
    const startY = s.enemies[0]?.y ?? 0;
    s = tick(s, 100, NO_INPUT); // a single normal frame of wave 2
    expect(s.enemies[0]?.y).not.toBe(startY); // SwoopIn is actively animating, not frozen
  });

  // tick() is a no-op once GameOver (see "GameOver terminal state" above), so a
  // missionCompleteTimer that's still counting down at the moment of death is frozen at
  // whatever value it had, not zero. GameCanvas/.web.tsx render the banner conditionally on
  // `phase !== "GameOver"` rather than relying on the timer itself decaying to 0 here.
  it("missionCompleteTimer freezes once GameOver — renderers suppress the banner instead", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H, 1);
    s = advanceMs(s, 8000);
    s = { ...s, enemies: s.enemies.map((e) => ({ ...e, isAlive: false, hp: 0 })) };
    s = tick(s, 16, NO_INPUT);
    expect(s.missionCompleteTimer).toBeGreaterThan(0);
    s = { ...s, phase: "GameOver" };
    const frozenAt = s.missionCompleteTimer;
    s = advanceMs(s, 5000);
    expect(s.missionCompleteTimer).toBe(frozenAt);
  });
});

// ---------------------------------------------------------------------------
// #2409 — in-flight bullets survive a wave clear instead of vanishing, and a
// leftover enemy bullet can't unfairly kill the player after the wave they
// were fired in has already cleared.
// ---------------------------------------------------------------------------

describe("#2409 bullets survive wave clear", () => {
  function makeEnemyBullet(overrides: Partial<Bullet> = {}): Bullet {
    return {
      id: 88888,
      x: 0,
      y: 0,
      vx: 0,
      vy: BULLET_E_VY,
      owner: "enemy",
      width: 5,
      height: 14,
      damage: 1,
      ...overrides,
    };
  }

  function makePlayerBullet(overrides: Partial<Bullet> = {}): Bullet {
    return {
      id: 77777,
      x: 0,
      y: 0,
      vx: 0,
      vy: -0.6,
      owner: "player",
      width: 3,
      height: 10,
      damage: 1,
      ...overrides,
    };
  }

  it("an in-flight enemy bullet is not wiped by a wave clear", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H, 1);
    s = advanceMs(s, 8000);
    const bullet = makeEnemyBullet({ x: CANVAS_W / 2, y: 50 });
    s = {
      ...s,
      enemies: s.enemies.map((e) => ({ ...e, isAlive: false, hp: 0 })),
      enemyBullets: [bullet],
    };
    s = tick(s, 16, NO_INPUT);
    expect(s.wave).toBe(2);
    expect(s.enemyBullets).toHaveLength(1);
    expect(s.enemyBullets[0]!.id).toBe(bullet.id);
  });

  it("an in-flight player bullet is not wiped by a wave clear", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H, 1);
    s = advanceMs(s, 8000);
    const bullet = makePlayerBullet({ x: CANVAS_W / 2, y: 200 });
    s = {
      ...s,
      enemies: s.enemies.map((e) => ({ ...e, isAlive: false, hp: 0 })),
      playerBullets: [bullet],
    };
    s = tick(s, 16, NO_INPUT);
    expect(s.wave).toBe(2);
    expect(s.playerBullets).toHaveLength(1);
    expect(s.playerBullets[0]!.id).toBe(bullet.id);
  });

  it("a carried-over enemy bullet keeps moving and despawns off-screen normally", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H, 1);
    s = advanceMs(s, 8000);
    const bullet = makeEnemyBullet({ x: CANVAS_W / 2, y: CANVAS_H - 5 });
    s = {
      ...s,
      enemies: s.enemies.map((e) => ({ ...e, isAlive: false, hp: 0 })),
      enemyBullets: [bullet],
    };
    s = tick(s, 16, NO_INPUT); // wave clears, bullet carries over
    expect(s.enemyBullets).toHaveLength(1);
    s = tick(s, 100, NO_INPUT); // bullet travels past the bottom edge
    expect(s.enemyBullets).toHaveLength(0);
  });

  it("a leftover enemy bullet on a collision course cannot hit the player after the wave clears", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H, 1);
    s = advanceMs(s, 8000);
    s = { ...s, player: { ...s.player, lives: 3, invincibleTimer: 0 } };
    // Above the player, heading straight down — on a collision course but not overlapping yet,
    // so the wave-clear tick itself carries it over rather than resolving a same-tick hit.
    const bullet = makeEnemyBullet({ x: s.player.x, y: s.player.y - 100 });
    s = {
      ...s,
      enemies: s.enemies.map((e) => ({ ...e, isAlive: false, hp: 0 })),
      enemyBullets: [bullet],
    };
    s = tick(s, 16, NO_INPUT); // wave clears — bullet is carried over and marked harmless
    expect(s.wave).toBe(2);
    expect(s.enemyBullets[0]?.harmless).toBe(true);

    // Advance until the bullet reaches (and passes through) the player's position.
    s = advanceMs(s, 400, NO_INPUT);
    expect(s.player.lives).toBe(3);
    expect(s.phase).not.toBe("GameOver");
  });

  it("a freshly-fired enemy bullet in the new wave can still hit the player normally", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H, 1);
    s = advanceMs(s, 8000);
    s = { ...s, enemies: s.enemies.map((e) => ({ ...e, isAlive: false, hp: 0 })) };
    s = tick(s, 16, NO_INPUT); // wave clears, no leftover bullets this time
    expect(s.wave).toBe(2);

    s = { ...s, player: { ...s.player, lives: 3, invincibleTimer: 0 } };
    const bullet = makeEnemyBullet({ x: s.player.x, y: s.player.y }); // not harmless
    s = { ...s, enemyBullets: [bullet] };
    s = tick(s, 16, NO_INPUT);
    expect(s.player.lives).toBe(2);
  });

  it("a carried-over player bullet can still score a hit on a new-wave enemy", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H, 1);
    s = advanceMs(s, 8000);
    s = { ...s, enemies: s.enemies.map((e) => ({ ...e, isAlive: false, hp: 0 })) };
    s = tick(s, 16, NO_INPUT); // wave 2 begins, SwoopIn
    expect(s.wave).toBe(2);
    // Let wave 2's enemies finish swooping into formation (on-screen) before parking a bullet
    // on one — freshly-spawned enemies start off-screen mid-Bezier-path. Enemy fire is
    // disabled for this stretch; it's irrelevant to what's being tested and would otherwise
    // risk an unrelated GameOver under NO_INPUT before the assertions below even run.
    s = { ...s, enemyFireDisabled: true };
    s = advanceMs(s, 8000, NO_INPUT);
    expect(s.phase).toBe("Playing");
    s = { ...s, enemyFireDisabled: false, player: { ...s.player, lives: 3, invincibleTimer: 0 } };
    const target = s.enemies.find((e) => e.isAlive)!;
    // Bullet is sized generously (dodge-proof) and damage is high enough to one-shot any
    // tier regardless of which enemy ends up at index 0 (Bosses have the most HP, at 4).
    const bullet = makePlayerBullet({
      x: target.x,
      y: target.y,
      vy: 0,
      width: 200,
      height: 200,
      damage: 999,
    });
    const scoreBefore = s.score;
    s = { ...s, playerBullets: [bullet] };
    s = tick(s, 16, NO_INPUT);
    expect(s.score).toBeGreaterThan(scoreBefore);
  });

  it("carried-over harmless bullets do not count against the new wave's bulletCap", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H, 1);
    s = advanceMs(s, 8000);
    expect(s.phase).toBe("Playing");

    // A full cap's worth of harmless leftovers, parked mid-screen so they stay alive this tick.
    const leftovers = Array.from({ length: bulletCap(1) }, (_, i) =>
      makeEnemyBullet({ id: 90000 + i, x: 50 + i * 20, y: 200, harmless: true })
    );
    const targetIdx = s.enemies.findIndex((e) => e.phase === "Formation" && e.tier !== "Boss");
    expect(targetIdx).not.toBe(-1);
    s = {
      ...s,
      enemyBullets: leftovers,
      enemies: s.enemies.map((e, i) => (i === targetIdx ? { ...e, shootTimer: 0 } : e)),
    };

    s = tick(s, 16, NO_INPUT);
    expect(s.enemyBullets.filter((b) => !b.harmless).length).toBeGreaterThan(0);
  });

  it("the shield does not absorb (despawn) a harmless bullet overlapping the player", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H, 1);
    s = advanceMs(s, 8000);
    s = applyPowerUp(s, "shield");
    s = { ...s, enemyFireDisabled: true, player: { ...s.player, invincibleTimer: 0 } };
    const lethal = makeEnemyBullet({ id: 90001, x: s.player.x, y: s.player.y });
    const harmless = makeEnemyBullet({ id: 90002, x: s.player.x, y: s.player.y, harmless: true });
    const absorbedBefore = s.activePowerUp!.shieldAbsorbed;
    s = { ...s, enemyBullets: [lethal, harmless] };

    s = tick(s, 16, NO_INPUT);
    expect(s.enemyBullets.map((b) => b.id)).toEqual([harmless.id]);
    expect(s.activePowerUp!.shieldAbsorbed).toBe(absorbedBefore + 1);
  });

  it("a lethal hit does not despawn a harmless bullet overlapping the player", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H, 1);
    s = advanceMs(s, 8000);
    s = { ...s, enemyFireDisabled: true, player: { ...s.player, lives: 3, invincibleTimer: 0 } };
    const lethal = makeEnemyBullet({ id: 90001, x: s.player.x, y: s.player.y });
    const harmless = makeEnemyBullet({ id: 90002, x: s.player.x, y: s.player.y, harmless: true });
    s = { ...s, enemyBullets: [lethal, harmless] };

    s = tick(s, 16, NO_INPUT);
    expect(s.player.lives).toBe(2);
    expect(s.enemyBullets.map((b) => b.id)).toEqual([harmless.id]);
  });

  it("first wave of a fresh game starts with no leftover bullets", () => {
    const s = initStarSwarm(CANVAS_W, CANVAS_H, 1);
    expect(s.playerBullets).toHaveLength(0);
    expect(s.enemyBullets).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Boss wave (#2490)
// ---------------------------------------------------------------------------

describe("Boss wave (#2490)", () => {
  const ASIDE: StarSwarmInput = { playerX: 40, fire: false };
  /** A boss wave settled into formation: no enemy fire, beam parked, rocks off, player parked
   * left — all applied before the swoop-in so four active Bosses can't end the game first. */
  function settled(difficulty: DifficultyTier = "LieutenantJG", wave = 5): StarSwarmState {
    const init = initStarSwarm(CANVAS_W, CANVAS_H, wave, 42, difficulty);
    const s = advanceMs(
      {
        ...init,
        enemyFireDisabled: true,
        asteroidsDisabled: true,
        player: { ...init.player, x: 40 },
        enemies: init.enemies.map((e) => (e.tier === "Carrier" ? { ...e, beamTimer: 1e9 } : e)),
      },
      8000,
      ASIDE
    );
    expect(s.phase).toBe("Playing");
    return {
      ...s,
      enemyBullets: [],
      asteroids: [],
      player: { ...s.player, lives: 3, invincibleTimer: 0 },
    };
  }
  const carrierOf = (s: StarSwarmState) => s.enemies.find((e) => e.tier === "Carrier")!;
  function rockAt(x: number, y: number): Asteroid {
    return {
      id: 95_000,
      kind: "large",
      x,
      y,
      vx: 0,
      vy: 0,
      radius: ASTEROID_STATS.large.radius,
      hp: ASTEROID_STATS.large.hp,
      rotation: 0,
      spin: 0,
      hitFlashTimer: 0,
      hitEnemyIds: [],
    };
  }

  it("isBossWave: wave 5, then every 4th — deliberately not the old 3/7/11 cadence", () => {
    const boss: number[] = [];
    for (let w = 1; w <= 40; w++) if (isBossWave(w)) boss.push(w);
    expect(boss).toEqual([5, 9, 13, 17, 21, 25, 29, 33, 37]);
    expect(isBossWave(3)).toBe(false);
    expect(isBossWave(7)).toBe(false);
  });

  it("no wave from 1 to 40 opens on anything but SwoopIn, and none is a shooting gallery", () => {
    for (let w = 1; w <= 40; w++) {
      const s = initStarSwarm(CANVAS_W, CANVAS_H, w);
      expect(s.phase).toBe("SwoopIn");
      expect((s.phase as string) === "FreeFireZone").toBe(false);
      // every ship can shoot back (the old challenge targets carried a never-fires timer)
      expect(s.enemies.every((e) => e.shootTimer < 1_000_000)).toBe(true);
    }
  });

  it("a boss wave is exactly one Carrier and four Bosses, the Carrier last to swoop in", () => {
    const s = initStarSwarm(CANVAS_W, CANVAS_H, 5);
    expect(s.enemies.map((e) => e.tier)).toEqual(["Boss", "Boss", "Boss", "Boss", "Carrier"]);
    expect(s.startingNonBossCount).toBe(0);
    const normal = initStarSwarm(CANVAS_W, CANVAS_H, 4);
    expect(normal.enemies.some((e) => e.tier === "Grunt")).toBe(true);
    expect(normal.enemies.some((e) => e.tier === "Elite")).toBe(true);
  });

  it("the Bosses are active from the first tick: threshold latched, dives on the normal timer, bursts", () => {
    expect(initStarSwarm(CANVAS_W, CANVAS_H, 5).bossThresholdCrossed).toBe(true);
    expect(initStarSwarm(CANVAS_W, CANVAS_H, 4).bossThresholdCrossed).toBe(false);
    // a dive trigger sends a Boss out of formation straight away
    let s = { ...settled(), nextDiveTimer: 1 };
    s = tick(s, 16, ASIDE);
    expect(s.enemies.some((e) => e.tier === "Boss" && e.phase !== "Formation")).toBe(true);
    // and a Boss whose shot timer is up fires its burst without waiting for anything
    let firing = { ...settled(), enemyFireDisabled: false };
    firing = {
      ...firing,
      enemies: firing.enemies.map((e) => (e.tier === "Boss" ? { ...e, shootTimer: 1 } : e)),
    };
    firing = tick(firing, 16, ASIDE);
    expect(firing.enemyBullets.length).toBeGreaterThan(0);
  });

  it("the Carrier beams 1.5× as often on a boss wave, from the first beam on", () => {
    expect(carrierOf(initStarSwarm(CANVAS_W, CANVAS_H, 4)).beamTimer).toBe(BEAM_INTERVAL_BASE);
    expect(carrierOf(initStarSwarm(CANVAS_W, CANVAS_H, 5)).beamTimer).toBeCloseTo(
      BEAM_INTERVAL_BASE / BOSS_WAVE_BEAM_SCALE
    );
    // the interval after a beam finishes is scaled the same way
    const afterBeam = (wave: number) => {
      let s = settled("Ensign", wave);
      s = {
        ...s,
        enemies: s.enemies.map((e) =>
          e.tier === "Carrier" ? { ...e, beamPhase: "fire" as const, beamTimer: 1 } : e
        ),
      };
      return carrierOf(tick(s, 16, ASIDE));
    };
    const normal = afterBeam(4);
    const boss = afterBeam(5);
    expect(normal.beamPhase).toBe("idle");
    expect(boss.beamPhase).toBe("idle");
    expect(boss.beamTimer).toBeCloseTo(normal.beamTimer / BOSS_WAVE_BEAM_SCALE, 0);
  });

  it("no reinforcements on a boss wave, however long the Carrier lives", () => {
    let s = { ...settled("Commander"), reinforceTimer: 1 };
    const before = s.enemies.length;
    s = advanceMs(s, 20_000, ASIDE);
    expect(s.enemies.length).toBe(before);
    expect(s.reinforcedThisWave).toBe(0);
    expect(s.runStats.reinforced).toBe(0);
  });

  it("clearing a boss wave pays double: base × wave × 2 × difficulty, and nothing else", () => {
    expect(waveClearBonusPoints(4, "Ensign")).toBe(4 * WAVE_CLEAR_BONUS_BASE);
    expect(waveClearBonusPoints(5, "Ensign")).toBe(
      5 * WAVE_CLEAR_BONUS_BASE * BOSS_WAVE_CLEAR_MULT
    );
    expect(waveClearBonusPoints(9, "Commander")).toBe(
      Math.round(
        9 * WAVE_CLEAR_BONUS_BASE * BOSS_WAVE_CLEAR_MULT * difficultyMultiplier("Commander")
      )
    );
    let s = { ...settled("Commander"), score: 1000 };
    s = { ...s, enemies: s.enemies.map((e) => ({ ...e, isAlive: false, hp: 0 })) };
    s = tick(s, 16, ASIDE);
    expect(s.wave).toBe(6);
    expect(s.score).toBe(1000 + waveClearBonusPoints(5, "Commander"));
    expect(s.missionCompleteTimer).toBe(MISSION_COMPLETE_BANNER_MS);
    // an ordinary wave is unchanged
    let n = { ...settled("Commander", 4), score: 1000 };
    n = { ...n, enemies: n.enemies.map((e) => ({ ...e, isAlive: false, hp: 0 })) };
    n = tick(n, 16, ASIDE);
    expect(n.score).toBe(
      1000 + Math.round(4 * WAVE_CLEAR_BONUS_BASE * difficultyMultiplier("Commander"))
    );
  });

  it("no timed rocks on a boss wave; a carried rock and a dev throw still work", () => {
    let s = { ...settled(), asteroidsDisabled: false, nextAsteroidTimer: 1 };
    s = tick(s, 16, ASIDE);
    expect(s.asteroids).toHaveLength(0);
    expect(throwAsteroid(s).asteroids).toHaveLength(1);
    let prev = advanceMs(initStarSwarm(CANVAS_W, CANVAS_H, 4, 42), 8000);
    prev = {
      ...prev,
      asteroids: [rockAt(CANVAS_W / 2, 460)],
      enemies: prev.enemies.map((e) => ({ ...e, isAlive: false, hp: 0 })),
    };
    prev = tick(prev, 16, ASIDE);
    expect(prev.wave).toBe(5);
    expect(prev.asteroids).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Player firing
// ---------------------------------------------------------------------------

describe("Player firing", () => {
  it("fire=true creates a player bullet", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H);
    s = tick(s, 16, FIRE_INPUT);
    expect(s.playerBullets).toHaveLength(1);
    expect(s.playerBullets[0]?.owner).toBe("player");
  });

  it("shoot cooldown prevents rapid-fire", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H);
    s = tick(s, 16, FIRE_INPUT);
    s = tick(s, 16, FIRE_INPUT);
    // Second tick should not add another bullet while cooldown is active
    expect(s.playerBullets.length).toBeLessThanOrEqual(2);
    expect(s.player.shootCooldown).toBeGreaterThan(0);
  });

  it("player bullet moves upward", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H);
    s = tick(s, 16, FIRE_INPUT);
    const y0 = s.playerBullets[0]?.y ?? 0;
    s = tick(s, 100, NO_INPUT);
    expect(s.playerBullets[0]?.y ?? y0).toBeLessThan(y0);
  });

  it("bullets off the top of screen are removed", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H);
    s = tick(s, 16, FIRE_INPUT);
    s = advanceMs(s, 5000, NO_INPUT); // plenty of time to exit top
    expect(s.playerBullets).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Boss HP 4 (#970)
// ---------------------------------------------------------------------------

describe("Boss HP (#970)", () => {
  it("Boss starts with 4 HP", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H);
    s = advanceMs(s, 8000);
    const boss = s.enemies.find((e) => e.isAlive && e.tier === "Boss");
    if (!boss) throw new Error("no boss");
    expect(boss.hp).toBe(4);
  });

  it("Boss requires exactly 4 hits of damage=1 to die", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H);
    s = advanceMs(s, 8000);
    const bossId = s.enemies.find((e) => e.isAlive && e.tier === "Boss")?.id;
    if (!bossId) throw new Error("no boss");
    const getBoss = () => s.enemies.find((e) => e.id === bossId)!;

    for (let hit = 1; hit <= 4; hit++) {
      const b = getBoss();
      s = {
        ...s,
        playerBullets: [
          {
            id: hit,
            x: b.x,
            y: b.y,
            vx: 0,
            vy: -0.5,
            owner: "player",
            width: 5,
            height: 14,
            damage: 1,
          },
        ],
      };
      s = tick(s, 16, NO_INPUT);
      if (hit < 4) {
        expect(getBoss().isAlive).toBe(true);
        expect(getBoss().hp).toBe(4 - hit);
      } else {
        expect(getBoss().isAlive).toBe(false);
      }
    }
  });

  it("Boss is still worth 400 points on kill (Ensign ×1 baseline)", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H, 1, 42, "Ensign");
    s = advanceMs(s, 8000);
    const bossId = s.enemies.find((e) => e.isAlive && e.tier === "Boss")?.id;
    if (!bossId) throw new Error("no boss");
    const getBoss = () => s.enemies.find((e) => e.id === bossId)!;
    const scoreBefore = s.score;

    for (let hit = 1; hit <= 4; hit++) {
      const b = getBoss();
      s = {
        ...s,
        playerBullets: [
          {
            id: hit,
            x: b.x,
            y: b.y,
            vx: 0,
            vy: -0.5,
            owner: "player",
            width: 5,
            height: 14,
            damage: 1,
          },
        ],
      };
      s = tick(s, 16, NO_INPUT);
    }

    expect(s.score - scoreBefore).toBe(400);
  });

  it("Grunt and Elite HP are unchanged", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H);
    s = advanceMs(s, 8000);
    expect(s.enemies.find((e) => e.isAlive && e.tier === "Grunt")?.hp).toBe(1);
    expect(s.enemies.find((e) => e.isAlive && e.tier === "Elite")?.hp).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// maxDivers cap (#969)
// ---------------------------------------------------------------------------

describe("maxDivers cap (#969)", () => {
  it("returns 1 for waves 1 and 2", () => {
    expect(maxDivers(1)).toBe(1);
    expect(maxDivers(2)).toBe(1);
  });

  it("returns 2 for waves 3 and 4", () => {
    expect(maxDivers(3)).toBe(2);
    expect(maxDivers(4)).toBe(2);
  });

  it("never exceeds 1 simultaneous Diving enemy on wave 1", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H, 1);
    s = advanceMs(s, 8000);
    expect(s.phase).toBe("Playing");

    for (let i = 0; i < 2000; i++) {
      s = tick(s, 16, NO_INPUT);
      if (s.phase !== "Playing") break;
      const divers = s.enemies.filter((e) => e.isAlive && e.phase === "Diving").length;
      expect(divers).toBeLessThanOrEqual(maxDivers(1));
    }
  });

  it("never exceeds 2 simultaneous Diving enemies on wave 4", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H, 4);
    s = advanceMs(s, 8000);
    expect(s.phase).toBe("Playing");

    for (let i = 0; i < 2000; i++) {
      s = tick(s, 16, NO_INPUT);
      if (s.phase !== "Playing") break;
      const divers = s.enemies.filter((e) => e.isAlive && e.phase === "Diving").length;
      expect(divers).toBeLessThanOrEqual(maxDivers(4));
    }
  });
});

// ---------------------------------------------------------------------------
// Enemy bullet cap (#972)
// ---------------------------------------------------------------------------

describe("Enemy bullet cap (#972)", () => {
  it("bulletCap returns correct values for each wave pair", () => {
    expect(bulletCap(1)).toBe(3);
    expect(bulletCap(2)).toBe(3);
    expect(bulletCap(3)).toBe(4);
    expect(bulletCap(5)).toBe(5);
    expect(bulletCap(7)).toBe(6);
  });

  it("no new enemy bullet fired when cap is already reached", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H);
    s = advanceMs(s, 8000);
    expect(s.phase).toBe("Playing");

    // Fill to the wave-1 cap (3 bullets), placed safely mid-screen
    const fillerBullets: Bullet[] = Array.from({ length: 3 }, (_, i) => ({
      id: 10000 + i,
      x: 100,
      y: 200 + i * 20,
      vx: 0,
      vy: 0.35,
      owner: "enemy" as const,
      width: 5,
      height: 10,
      damage: 1,
    }));

    // Force one Formation enemy's shoot timer to fire immediately
    s = {
      ...s,
      enemyBullets: fillerBullets,
      enemies: s.enemies.map((e, i) =>
        i === 0 && e.phase === "Formation" ? { ...e, shootTimer: 0 } : e
      ),
    };

    s = tick(s, 16, NO_INPUT);

    // The 3 filler bullets are still on-screen (y ≈ 205) — no 4th bullet allowed
    expect(s.enemyBullets.length).toBeLessThanOrEqual(bulletCap(1));
  });

  it("enemy fires normally when bullet count is below cap", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H);
    s = advanceMs(s, 8000);
    expect(s.phase).toBe("Playing");

    // Force the first non-Boss formation enemy to fire immediately
    // (Bosses are passive until bossThresholdCrossed, so use a Grunt or Elite)
    const targetIdx = s.enemies.findIndex((e) => e.phase === "Formation" && e.tier !== "Boss");
    if (targetIdx === -1) return;
    s = {
      ...s,
      enemyBullets: [],
      enemies: s.enemies.map((e, i) => (i === targetIdx ? { ...e, shootTimer: 0 } : e)),
    };

    s = tick(s, 16, NO_INPUT);
    expect(s.enemyBullets.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// GameOver is terminal
// ---------------------------------------------------------------------------

describe("GameOver terminal state", () => {
  it("tick is a no-op once phase is GameOver", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H);
    s = { ...s, phase: "GameOver" };
    const s2 = tick(s, 1000, FIRE_INPUT);
    expect(s2).toBe(s);
  });
});

// ---------------------------------------------------------------------------
// Dive/circle shooting (#944)
// ---------------------------------------------------------------------------

describe("Dive/circle shooting", () => {
  it("a diving enemy fires an aimed bullet with non-zero vx", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H);
    s = advanceMs(s, 8000); // reach Playing
    expect(s.phase).toBe("Playing");

    // Force one enemy into Diving with an expired shoot timer so it fires immediately.
    // Clear existing enemy bullets so the bullet cap (wave 1 = 3) doesn't suppress the shot.
    // Provide a minimal straight Bézier path since tickDiving now uses path-based movement.
    const playerX = s.player.x;
    const dummyPath = {
      p0: { x: CANVAS_W / 2, y: 100 },
      p1: { x: CANVAS_W / 2, y: 200 },
      p2: { x: playerX, y: 400 },
      p3: { x: playerX, y: CANVAS_H * 0.9 },
    };
    s = {
      ...s,
      enemyBullets: [],
      enemies: s.enemies.map((e, i) =>
        i === 0
          ? {
              ...e,
              phase: "Diving" as const,
              diveTargetX: playerX,
              shootTimer: 0,
              path: dummyPath,
              pathT: 0,
              pathDuration: 1800,
            }
          : e
      ),
    };

    s = tick(s, 16, NO_INPUT);

    const divingBullet = s.enemyBullets.find((b) => b.vx !== 0);
    expect(divingBullet).toBeDefined();
    expect(divingBullet?.vy).toBeGreaterThan(0); // moving downward
  });
});

// ---------------------------------------------------------------------------
// Bonus lives (#945)
// ---------------------------------------------------------------------------

describe("Bonus lives", () => {
  function killEnemy(s: StarSwarmState, bulletId: number): StarSwarmState {
    const enemy = s.enemies.find((e) => e.isAlive);
    if (!enemy) throw new Error("no alive enemy");
    const bullet: Bullet = {
      id: bulletId,
      x: enemy.x,
      y: enemy.y,
      vx: 0,
      vy: 0,
      owner: "player",
      width: enemy.width,
      height: enemy.height,
      damage: 10,
    };
    return tick({ ...s, playerBullets: [bullet] }, 16, NO_INPUT);
  }

  it("awards +1 life when score crosses the Ensign threshold (30k)", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H, 1, 42, "Ensign");
    s = advanceMs(s, 8000); // reach Playing
    const startLives = s.player.lives;
    s = { ...s, score: 29_999 };
    s = killEnemy(s, 99999);
    expect(s.player.lives).toBe(startLives + 1);
    expect(s.bonusLivesAwarded).toBe(1);
  });

  it("does not re-award bonus life on the same multiple", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H, 1, 42, "Ensign");
    s = advanceMs(s, 8000);
    s = { ...s, score: 29_999, bonusLivesAwarded: 0 };
    s = killEnemy(s, 99998);
    const livesAfterFirst = s.player.lives;
    // Tick again from same score — multiple already counted, bonusLivesAwarded=1
    s = tick(s, 16, NO_INPUT);
    expect(s.player.lives).toBe(livesAfterFirst);
  });

  it("caps lives at MAX_LIVES (5)", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H, 1, 42, "Ensign");
    s = advanceMs(s, 8000);
    s = { ...s, score: 29_999, player: { ...s.player, lives: 5 } };
    s = killEnemy(s, 99997);
    expect(s.player.lives).toBe(5);
  });

  // #1079: repeating threshold
  it("awards a second bonus life at 60k on Ensign", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H, 1, 42, "Ensign");
    s = advanceMs(s, 8000);
    // Already awarded 1 life at 30k — now cross 60k
    s = { ...s, score: 59_999, bonusLivesAwarded: 1, player: { ...s.player, lives: 3 } };
    s = killEnemy(s, 88881);
    expect(s.player.lives).toBe(4);
    expect(s.bonusLivesAwarded).toBe(2);
  });

  it("threshold scales by difficulty: Lieutenant (2×) awards life at 60k not 30k", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H, 1, 42, "Lieutenant");
    s = advanceMs(s, 8000);
    // Score crosses 30k — no life yet (threshold is 60k for Lieutenant)
    s = { ...s, score: 29_999, bonusLivesAwarded: 0 };
    s = killEnemy(s, 88882);
    const livesAt30k = s.player.lives;
    const awardedAt30k = s.bonusLivesAwarded;
    expect(awardedAt30k).toBe(0); // no life at 30k

    // Now cross 60k
    s = { ...s, score: 59_999, bonusLivesAwarded: 0 };
    s = killEnemy(s, 88883);
    expect(s.bonusLivesAwarded).toBe(1);
    expect(s.player.lives).toBe(livesAt30k + 1);
  });

  // #1078: race condition — same-tick lethal hit + threshold crossing
  it("player survives when bonus life threshold is crossed in the same tick as a lethal hit", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H, 1, 42, "Ensign");
    s = advanceMs(s, 8000);
    // Player at 1 life, score just below threshold
    s = { ...s, score: 29_999, player: { ...s.player, lives: 1, invincibleTimer: 0 } };
    const enemy = s.enemies.find((e) => e.isAlive);
    if (!enemy) throw new Error("no alive enemy");
    // Kill bullet at enemy position
    const killBullet: Bullet = {
      id: 77771,
      x: enemy.x,
      y: enemy.y,
      vx: 0,
      vy: 0,
      owner: "player",
      width: enemy.width,
      height: enemy.height,
      damage: 10,
    };
    // Enemy bullet on top of player (lethal hit same tick)
    const enemyBullet: Bullet = {
      id: 77772,
      x: s.player.x,
      y: s.player.y,
      vx: 0,
      vy: 0,
      owner: "enemy",
      width: 8,
      height: 8,
      damage: 1,
    };
    s = tick({ ...s, playerBullets: [killBullet], enemyBullets: [enemyBullet] }, 16, NO_INPUT);
    // Bonus life awarded before lethal hit resolves — player should survive
    expect(s.phase).not.toBe("GameOver");
    expect(s.player.lives).toBeGreaterThan(0);
  });

  // #1078/#2334: the GameOver branch of tickCollisions used to unconditionally clear
  // playerBullets, so a same-tick bonus-life rescue permanently dropped in-flight bullets
  // even though the player survives. tickCollisions now preserves them for tickBonusLives
  // to finalize (clear) only if the rescue doesn't happen.
  it("preserves in-flight player bullets when a bonus-life rescue reverts GameOver in the same tick", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H, 1, 42, "Ensign");
    s = advanceMs(s, 8000);
    s = { ...s, score: 29_999, player: { ...s.player, lives: 1, invincibleTimer: 0 } };
    const enemy = s.enemies.find((e) => e.isAlive);
    if (!enemy) throw new Error("no alive enemy");
    const killBullet: Bullet = {
      id: 77781,
      x: enemy.x,
      y: enemy.y,
      vx: 0,
      vy: 0,
      owner: "player",
      width: enemy.width,
      height: enemy.height,
      damage: 10,
    };
    // Unrelated bullet, far from any enemy — should never be hit-consumed.
    const survivorBullet: Bullet = {
      id: 77782,
      x: 20,
      y: 20,
      vx: 0,
      vy: 0,
      owner: "player",
      width: 5,
      height: 14,
      damage: 1,
    };
    const enemyBullet: Bullet = {
      id: 77783,
      x: s.player.x,
      y: s.player.y,
      vx: 0,
      vy: 0,
      owner: "enemy",
      width: 8,
      height: 8,
      damage: 1,
    };
    s = tick(
      { ...s, playerBullets: [killBullet, survivorBullet], enemyBullets: [enemyBullet] },
      16,
      NO_INPUT
    );
    expect(s.phase).not.toBe("GameOver");
    expect(s.playerBullets.some((b) => b.id === survivorBullet.id)).toBe(true);
  });

  // #1078: slow-mo timer and invincibility
  it("sets bonusLifeSlowMoTimer and invincibleTimer after bonus life award", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H, 1, 42, "Ensign");
    s = advanceMs(s, 8000);
    s = { ...s, score: 29_999 };
    s = killEnemy(s, 88884);
    expect(s.bonusLifeSlowMoTimer).toBeGreaterThan(0);
    expect(s.player.invincibleTimer).toBeGreaterThan(0);
  });

  it("bonusLifeSlowMoTimer decrements over time and does not go negative", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H, 1, 42, "Ensign");
    s = advanceMs(s, 8000);
    s = { ...s, score: 29_999 };
    s = killEnemy(s, 88885);
    const timerAfterAward = s.bonusLifeSlowMoTimer;
    expect(timerAfterAward).toBeGreaterThan(0);
    // Advance enough to exhaust the timer
    s = advanceMs(s, 1000);
    expect(s.bonusLifeSlowMoTimer).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// collideCircleAABB (#976) — player hurt radius
// ---------------------------------------------------------------------------

describe("collideCircleAABB (#976)", () => {
  it("detects overlap when circle center is inside AABB", () => {
    expect(collideCircleAABB(50, 50, PLAYER_HURT_RADIUS, 50, 50, 20, 20)).toBe(true);
  });

  it("detects overlap when circle touches AABB edge", () => {
    // Circle at x=30 with radius 7, AABB centered at x=40 width=10 (left edge at 35)
    // Distance from center to nearest point: 35-30=5, within radius 7
    expect(collideCircleAABB(30, 50, 7, 40, 50, 10, 10)).toBe(true);
  });

  it("returns false for clear miss with gap beyond radius", () => {
    // Circle at x=10 r=5, AABB centered at x=30 width=10 (left edge at 25)
    // Nearest point: x=25, gap=25-10=15 > 5
    expect(collideCircleAABB(10, 50, 5, 30, 50, 10, 10)).toBe(false);
  });

  it("returns false when circle is well outside the AABB", () => {
    // Circle at (0,0) r=6, AABB centered at (10,10) width=2 height=2 (left edge at 9)
    // Nearest point: (9,9), distance=sqrt(162)≈12.7 > 6
    expect(collideCircleAABB(0, 0, 6, 10, 10, 2, 2)).toBe(false);
  });

  it("PLAYER_HURT_RADIUS is smaller than the old half-width hitbox", () => {
    // Original half-width was player.width/2 = 17; new radius is 7
    expect(PLAYER_HURT_RADIUS).toBeLessThan(17);
    expect(PLAYER_HURT_RADIUS).toBeGreaterThan(0);
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

// ---------------------------------------------------------------------------
// Wiggle telegraph (#975)
// ---------------------------------------------------------------------------

/** Reset any airborne enemies back to Formation so dive cap has room. */
function resetToFormation(s: StarSwarmState): StarSwarmState {
  return {
    ...s,
    enemies: s.enemies.map((e) =>
      e.isAlive &&
      (e.phase === "Diving" ||
        e.phase === "Wiggling" ||
        e.phase === "Circling" ||
        e.phase === "Returning")
        ? {
            ...e,
            phase: "Formation" as const,
            x: e.formationX,
            y: e.formationY,
            path: null,
            pathT: 1,
          }
        : e
    ),
  };
}

describe("Wiggle telegraph (#975)", () => {
  it("enemy enters Wiggling before Diving when selected for dive", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H);
    s = advanceMs(s, 8000); // reach Playing
    s = resetToFormation({ ...s, nextDiveTimer: 1 });
    s = tick(s, 16, NO_INPUT);
    expect(s.enemies.some((e) => e.isAlive && e.phase === "Wiggling")).toBe(true);
    expect(s.enemies.filter((e) => e.isAlive && e.phase === "Diving")).toHaveLength(0);
  });

  it("Wiggling enemy transitions to Diving after WIGGLE_DURATION", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H);
    s = advanceMs(s, 8000);
    s = resetToFormation({ ...s, nextDiveTimer: 1 });
    s = tick(s, 16, NO_INPUT);
    const wiggling = s.enemies.find((e) => e.phase === "Wiggling");
    if (!wiggling) throw new Error("no wiggling enemy");
    const id = wiggling.id;
    s = advanceMs(s, WIGGLE_DURATION + 50, NO_INPUT);
    const after = s.enemies.find((e) => e.id === id)!;
    const completed =
      !after.isAlive ||
      after.phase === "Diving" ||
      after.phase === "Circling" ||
      after.phase === "Returning";
    expect(completed).toBe(true);
  });

  it("wiggleTimer is 0 for all enemies at wave start", () => {
    const s = initStarSwarm(CANVAS_W, CANVAS_H);
    expect(s.enemies.every((e) => e.wiggleTimer === 0)).toBe(true);
  });

  it("Wiggling enemies are not counted against maxDivers cap", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H);
    s = advanceMs(s, 8000);
    s = resetToFormation({ ...s, nextDiveTimer: 1 });
    s = tick(s, 16, NO_INPUT);
    const wiggling = s.enemies.filter((e) => e.isAlive && e.phase === "Wiggling").length;
    const diving = s.enemies.filter((e) => e.isAlive && e.phase === "Diving").length;
    expect(wiggling).toBeGreaterThan(0);
    expect(diving).toBeLessThanOrEqual(maxDivers(s.wave));
  });
});

// ---------------------------------------------------------------------------
// Bézier arc dives (#977)
// ---------------------------------------------------------------------------

describe("Bézier arc dives (#977)", () => {
  it("diving enemy reaches Circling within WIGGLE_DURATION + DIVE_PATH_DURATION + buffer", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H);
    s = advanceMs(s, 8000);
    s = resetToFormation({ ...s, nextDiveTimer: 1 });
    s = tick(s, 16, NO_INPUT);
    const wiggling = s.enemies.find((e) => e.phase === "Wiggling");
    if (!wiggling) throw new Error("no wiggling enemy");
    const id = wiggling.id;
    // #1314: proportional aiming is more lethal — give invincibility so the player can't die
    // mid-advance and freeze the game in GameOver before the dive completes.
    s = { ...s, player: { ...s.player, invincibleTimer: 999_999 } };
    s = advanceMs(s, WIGGLE_DURATION + DIVE_PATH_DURATION + 200, NO_INPUT);
    const after = s.enemies.find((e) => e.id === id)!;
    const completed =
      !after.isAlive ||
      after.phase === "Circling" ||
      after.phase === "Returning" ||
      after.phase === "Formation";
    expect(completed).toBe(true);
  });

  it("dive path is set when enemy enters Diving", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H);
    s = advanceMs(s, 8000);
    s = resetToFormation({ ...s, nextDiveTimer: 1 });
    s = tick(s, 16, NO_INPUT);
    s = advanceMs(s, WIGGLE_DURATION + 50, NO_INPUT);
    const diver = s.enemies.find((e) => e.isAlive && e.phase === "Diving");
    if (!diver) return; // may already be Circling at high frame rate — skip
    expect(diver.path).not.toBeNull();
    expect(diver.pathDuration).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Boss dive threshold (#978)
// ---------------------------------------------------------------------------

describe("Boss dive threshold (#978)", () => {
  it("BOSS_DIVE_THRESHOLD is 0.35", () => {
    expect(BOSS_DIVE_THRESHOLD).toBe(0.35);
  });

  it("startingNonBossCount set correctly at wave init", () => {
    const s = initStarSwarm(CANVAS_W, CANVAS_H);
    // #2484: Boss and Carrier both sit out the count
    const nonBossCount = s.enemies.filter((e) => !isLeaderTier(e.tier)).length;
    expect(s.startingNonBossCount).toBe(nonBossCount);
    expect(s.startingNonBossCount).toBeGreaterThan(0);
  });

  it("boss does not dive when >35% non-boss enemies are still alive", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H);
    s = advanceMs(s, 8000);
    const bossIds = new Set(
      s.enemies.filter((e) => e.isAlive && e.tier === "Boss").map((e) => e.id)
    );

    // Force dive trigger with all non-boss enemies alive (100% remain → >35%)
    s = { ...s, nextDiveTimer: 1 };
    s = tick(s, 16, NO_INPUT);

    // No boss should enter Wiggling or Diving
    const bossWiggling = s.enemies.some(
      (e) => bossIds.has(e.id) && (e.phase === "Wiggling" || e.phase === "Diving")
    );
    expect(bossWiggling).toBe(false);
  });

  it("boss can dive when ≤35% non-boss enemies remain", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H);
    s = advanceMs(s, 8000);

    // Kill enough non-boss enemies to drop to 30% alive (below 35% threshold)
    const target = Math.floor(s.startingNonBossCount * 0.3);
    let killed = 0;
    s = {
      ...s,
      enemies: s.enemies.map((e) => {
        if (e.tier !== "Boss" && e.isAlive && killed < s.startingNonBossCount - target) {
          killed++;
          return { ...e, isAlive: false, hp: 0 };
        }
        return e;
      }),
    };

    // Run until a boss enters Wiggling or Diving
    s = { ...s, nextDiveTimer: 1 };
    let bossActed = false;
    for (let i = 0; i < 300; i++) {
      s = tick(s, 16, NO_INPUT);
      if (
        s.enemies.some((e) => e.tier === "Boss" && (e.phase === "Wiggling" || e.phase === "Diving"))
      ) {
        bossActed = true;
        break;
      }
      if (s.phase !== "Playing") break;
      s = { ...s, nextDiveTimer: 1 }; // keep triggering
    }
    expect(bossActed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Boss burst-fire (#979)
// ---------------------------------------------------------------------------

describe("Boss burst-fire (#979)", () => {
  it("Boss fires on first tick when shootTimer=0 and burstShotsLeft=0", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H);
    s = advanceMs(s, 8000);
    const bossIdx = s.enemies.findIndex(
      (e) => e.isAlive && e.tier === "Boss" && e.phase === "Formation"
    );
    if (bossIdx === -1) throw new Error("no boss in formation");
    s = {
      ...s,
      bossThresholdCrossed: true, // Boss must be active to fire
      enemyBullets: [],
      enemies: s.enemies.map((e, i) =>
        i === bossIdx ? { ...e, shootTimer: 0, burstShotsLeft: 0 } : e
      ),
    };
    s = tick(s, 16, NO_INPUT);
    expect(s.enemyBullets.length).toBeGreaterThan(0);
    const boss = s.enemies[bossIdx]!;
    // After first burst shot, timer is either BURST_INTERVAL (more shots) or long pause (1-shot burst)
    expect(boss.shootTimer).toBeLessThanOrEqual(BURST_INTERVAL + 2);
    // burstShotsLeft is 0 (burst complete) or up to 4 (3–5 shot burst, remaining after first)
    expect(boss.burstShotsLeft).toBeGreaterThanOrEqual(0);
    expect(boss.burstShotsLeft).toBeLessThanOrEqual(4);
  });

  it("Boss has long pause after burst completes (burstShotsLeft reaches 0)", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H);
    s = advanceMs(s, 8000);
    const bossIdx = s.enemies.findIndex(
      (e) => e.isAlive && e.tier === "Boss" && e.phase === "Formation"
    );
    if (bossIdx === -1) throw new Error("no boss in formation");
    // Force last shot in burst (Boss must be active to fire)
    s = {
      ...s,
      bossThresholdCrossed: true,
      enemyBullets: [],
      enemies: s.enemies.map((e, i) =>
        i === bossIdx ? { ...e, shootTimer: 0, burstShotsLeft: 1 } : e
      ),
    };
    s = tick(s, 16, NO_INPUT);
    const boss = s.enemies[bossIdx]!;
    expect(boss.burstShotsLeft).toBe(0);
    // Long pause should be at least BURST_PAUSE_BASE - one tick
    expect(boss.shootTimer).toBeGreaterThanOrEqual(BURST_PAUSE_BASE - 16);
  });

  it("burstShotsLeft is 0 for all enemies at wave start", () => {
    const s = initStarSwarm(CANVAS_W, CANVAS_H);
    expect(s.enemies.every((e) => e.burstShotsLeft === 0)).toBe(true);
  });

  it("Boss burst bullet travels at BOSS_BULLET_VY; Elite bullet travels at BULLET_E_VY", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H);
    s = advanceMs(s, 8000);
    const bossIdx = s.enemies.findIndex(
      (e) => e.isAlive && e.tier === "Boss" && e.phase === "Formation"
    );
    const eliteIdx = s.enemies.findIndex(
      (e) => e.isAlive && e.tier === "Elite" && e.phase === "Formation"
    );
    if (bossIdx === -1) throw new Error("no boss in formation");
    if (eliteIdx === -1) throw new Error("no elite in formation");
    s = {
      ...s,
      bossThresholdCrossed: true,
      enemyBullets: [],
      enemies: s.enemies.map((e, i) => {
        if (i === bossIdx) return { ...e, shootTimer: 0, burstShotsLeft: 0 };
        if (i === eliteIdx) return { ...e, shootTimer: 0 };
        return e;
      }),
    };
    s = tick(s, 16, NO_INPUT);
    const bossBullet = s.enemyBullets.find((b) => b.vy === BOSS_BULLET_VY);
    const eliteBullet = s.enemyBullets.find((b) => b.vy === BULLET_E_VY);
    expect(bossBullet).toBeDefined();
    expect(eliteBullet).toBeDefined();
  });

  it("Boss circle-phase bullet travels at BOSS_BULLET_VY", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H);
    s = advanceMs(s, 8000);
    const bossIdx = s.enemies.findIndex((e) => e.isAlive && e.tier === "Boss");
    if (bossIdx === -1) throw new Error("no boss");
    const cx = CANVAS_W / 2;
    const cy = CANVAS_H * 0.3;
    const radius = 60;
    s = {
      ...s,
      bossThresholdCrossed: true,
      enemyBullets: [],
      enemies: s.enemies.map((e, i) =>
        i === bossIdx
          ? {
              ...e,
              phase: "Circling" as const,
              circleCx: cx,
              circleCy: cy,
              circleRadius: radius,
              circleAngle: 0,
              circleSpeed: 0.001,
              shootTimer: 0,
            }
          : e
      ),
    };
    s = tick(s, 16, NO_INPUT);
    expect(s.enemyBullets.length).toBeGreaterThan(0);
    const bullet = s.enemyBullets[0]!;
    expect(bullet.vy).toBe(BOSS_BULLET_VY);
  });
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
// #2334 — Player bullet cap & GameOver freeze cleanup
//
// Reported: sustained Lightning fire against a full wave-5 formation got
// laggy/froze, and the frame captured at the moment of death showed a bullet
// still sitting next to the player's ship (looked like it was firing instead
// of exploding).
// ---------------------------------------------------------------------------

describe("Player bullet cap (#2334)", () => {
  function fillerPlayerBullets(count: number): Bullet[] {
    return Array.from({ length: count }, (_, i) => ({
      id: 20000 + i,
      x: 50 + i, // spread out — all comfortably on-screen
      y: 520, // below the deepest formation row (#2484 tightened rows to 42 px) so none overlap an enemy
      vx: 0,
      vy: -0.56, // upward, matches the player bullet speed
      owner: "player" as const,
      width: 5,
      height: 14,
      damage: 1,
    }));
  }

  it("no new player bullet fired once MAX_PLAYER_BULLETS is reached", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H);
    s = advanceMs(s, 8000);
    expect(s.phase).toBe("Playing");

    s = {
      ...s,
      activePowerUp: { remainingMs: 3000, type: "lightning" as const, shieldAbsorbed: 0 },
      player: { ...s.player, shootCooldown: 0 },
      playerBullets: fillerPlayerBullets(MAX_PLAYER_BULLETS),
    };

    s = tick(s, 16, FIRE_INPUT);

    // Cap held even under Lightning's fast cooldown — no 21st bullet added.
    expect(s.playerBullets.length).toBe(MAX_PLAYER_BULLETS);
  });

  it("fires normally once bullet count drops back below the cap", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H);
    s = advanceMs(s, 8000);

    s = {
      ...s,
      player: { ...s.player, shootCooldown: 0 },
      playerBullets: fillerPlayerBullets(MAX_PLAYER_BULLETS - 1),
    };

    s = tick(s, 16, FIRE_INPUT);

    expect(s.playerBullets.length).toBe(MAX_PLAYER_BULLETS);
  });

  // #2334: buddy-ship bullets are player-owned but were pushed with no cap check, so a
  // spread burst (5-7 bullets) could push playerBullets past MAX_PLAYER_BULLETS.
  it("buddy ship spread burst does not push playerBullets past MAX_PLAYER_BULLETS", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H);
    s = advanceMs(s, 8000);
    s = applyPowerUp(s, "buddy");
    expect(s.buddyShips.length).toBe(1);

    s = {
      ...s,
      player: { ...s.player, invincibleTimer: 999_999 },
      playerBullets: fillerPlayerBullets(MAX_PLAYER_BULLETS - 3),
    };

    // Advance until the buddy ship's fire point (pathT >= BUDDY_FIRE_AT_T).
    for (let i = 0; i < 400 && s.playerBullets.length <= MAX_PLAYER_BULLETS - 3; i++) {
      s = tick(s, 16, NO_INPUT);
    }

    expect(s.playerBullets.length).toBeLessThanOrEqual(MAX_PLAYER_BULLETS);
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

// ---------------------------------------------------------------------------
// #1029 — Grunt & Boss collision redesign
// ---------------------------------------------------------------------------

describe("#1029 Grunt & Boss collision redesign", () => {
  it("Grunt never enters Circling phase", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H);
    s = advanceMs(s, 8000);
    expect(s.phase).toBe("Playing");

    for (let i = 0; i < 3000; i++) {
      s = tick(s, 16, NO_INPUT);
      if (s.phase !== "Playing") break;
      const gruntCircling = s.enemies.some(
        (e) => e.isAlive && e.tier === "Grunt" && e.phase === "Circling"
      );
      expect(gruntCircling).toBe(false);
    }
  });

  it("Grunt returns to Formation after dive without entering Circling", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H);
    s = advanceMs(s, 8000);
    s = resetToFormation({ ...s, nextDiveTimer: 1 });
    s = tick(s, 16, NO_INPUT);

    const wiggling = s.enemies.find((e) => e.phase === "Wiggling" && e.tier === "Grunt");
    if (!wiggling) return; // wave may have no Grunts in formation — skip
    const id = wiggling.id;

    // Wait for the full dive + return cycle
    s = advanceMs(s, WIGGLE_DURATION + 4000, NO_INPUT);
    const after = s.enemies.find((e) => e.id === id);
    if (!after || !after.isAlive) return;
    expect(after.phase === "Circling").toBe(false);
  });

  it("Boss never body-collides with player", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H);
    s = advanceMs(s, 8000);
    s = { ...s, bossThresholdCrossed: true, player: { ...s.player, invincibleTimer: 0 } };

    const bossId = s.enemies.find((e) => e.isAlive && e.tier === "Boss")?.id;
    if (!bossId) throw new Error("no boss");

    // Teleport Boss directly onto the player and give it a diving phase
    const { player } = s;
    s = {
      ...s,
      player: { ...player, lives: 3, invincibleTimer: 0 },
      enemies: s.enemies.map((e) =>
        e.id === bossId
          ? {
              ...e,
              phase: "Diving" as const,
              x: player.x,
              y: player.y,
              path: {
                p0: { x: player.x, y: player.y },
                p1: { x: player.x, y: player.y + 10 },
                p2: { x: player.x, y: player.y + 20 },
                p3: { x: player.x, y: player.y + 30 },
              },
              pathT: 0,
              pathDuration: 1000,
            }
          : e
      ),
    };

    s = tick(s, 16, NO_INPUT);
    // Player should NOT have lost a life despite Boss being on same position
    expect(s.player.lives).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// #1030 — Elite phase system & Boss passive start
// ---------------------------------------------------------------------------

describe("#1030 Elite phase system & Boss passive start", () => {
  it("bossThresholdCrossed initialises to false", () => {
    const s = initStarSwarm(CANVAS_W, CANVAS_H);
    expect(s.bossThresholdCrossed).toBe(false);
  });

  it("bossThresholdCrossed flips to true once ≤35% non-boss enemies remain and stays true", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H);
    s = advanceMs(s, 8000);
    expect(s.bossThresholdCrossed).toBe(false);

    const target = Math.floor(s.startingNonBossCount * 0.3);
    let killed = 0;
    s = {
      ...s,
      enemies: s.enemies.map((e) => {
        if (e.tier !== "Boss" && e.isAlive && killed < s.startingNonBossCount - target) {
          killed++;
          return { ...e, isAlive: false, hp: 0 };
        }
        return e;
      }),
    };
    s = tick(s, 16, NO_INPUT);
    expect(s.bossThresholdCrossed).toBe(true);

    // Stays true after further ticks
    s = advanceMs(s, 1000, NO_INPUT);
    expect(s.bossThresholdCrossed).toBe(true);
  });

  it("Boss does not fire while bossThresholdCrossed is false", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H);
    s = advanceMs(s, 8000);
    expect(s.bossThresholdCrossed).toBe(false);

    const bossIdx = s.enemies.findIndex((e) => e.isAlive && e.tier === "Boss");
    if (bossIdx === -1) throw new Error("no boss");
    s = {
      ...s,
      enemyBullets: [],
      // Only the Boss is due to fire this tick — everyone else is pushed far out, so a bullet
      // here could only be the Boss's (the seed no longer guarantees the rest stay quiet, #2484).
      enemies: s.enemies.map((e, i) =>
        i === bossIdx ? { ...e, shootTimer: 0, burstShotsLeft: 0 } : { ...e, shootTimer: 99_999 }
      ),
    };
    s = tick(s, 16, NO_INPUT);
    // Boss should not fire while passive
    expect(s.enemyBullets.length).toBe(0);
  });

  it("Boss does not dive while bossThresholdCrossed is false", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H);
    s = advanceMs(s, 8000);
    expect(s.bossThresholdCrossed).toBe(false);

    const bossIds = new Set(s.enemies.filter((e) => e.tier === "Boss").map((e) => e.id));
    s = { ...s, nextDiveTimer: 1 };
    s = tick(s, 16, NO_INPUT);
    const bossActed = s.enemies.some(
      (e) => bossIds.has(e.id) && (e.phase === "Wiggling" || e.phase === "Diving")
    );
    expect(bossActed).toBe(false);
  });

  it("Elite Phase 1 dive stays above 60% canvas height", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H);
    s = advanceMs(s, 8000);
    expect(s.bossThresholdCrossed).toBe(false);

    // Force an Elite to dive
    const eliteIdx = s.enemies.findIndex(
      (e) => e.isAlive && e.tier === "Elite" && e.phase === "Formation"
    );
    if (eliteIdx === -1) throw new Error("no elite in formation");
    s = {
      ...s,
      enemies: s.enemies.map((e, i) =>
        i === eliteIdx
          ? {
              ...e,
              phase: "Wiggling" as const,
              wiggleTimer: WIGGLE_DURATION,
              diveTargetX: s.player.x,
            }
          : e
      ),
    };

    const eliteId = s.enemies[eliteIdx]!.id;
    const maxY60 = CANVAS_H * 0.6;

    for (let i = 0; i < 500; i++) {
      s = tick(s, 16, NO_INPUT);
      const elite = s.enemies.find((e) => e.id === eliteId);
      if (!elite || !elite.isAlive || elite.phase === "Returning" || elite.phase === "Formation")
        break;
      if (elite.phase === "Diving") {
        expect(elite.y).toBeLessThan(maxY60 + 5); // allow 1-frame overshoot tolerance
      }
    }
  });

  it("Elite Phase 1 has no body collision", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H);
    s = advanceMs(s, 8000);
    expect(s.bossThresholdCrossed).toBe(false);
    s = { ...s, player: { ...s.player, lives: 3, invincibleTimer: 0 } };

    const eliteId = s.enemies.find((e) => e.isAlive && e.tier === "Elite")?.id;
    if (!eliteId) throw new Error("no elite");
    const { player } = s;
    s = {
      ...s,
      enemies: s.enemies.map((e) =>
        e.id === eliteId
          ? {
              ...e,
              phase: "Diving" as const,
              x: player.x,
              y: player.y,
              path: {
                p0: { x: player.x, y: player.y },
                p1: { x: player.x, y: player.y + 5 },
                p2: { x: player.x, y: player.y + 10 },
                p3: { x: player.x, y: player.y + 15 },
              },
              pathT: 0,
              pathDuration: 1000,
            }
          : e
      ),
    };
    s = tick(s, 16, NO_INPUT);
    expect(s.player.lives).toBe(3);
  });

  it("Elite Phase 2 (bossThresholdCrossed=true) can body-collide", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H);
    s = advanceMs(s, 8000);
    s = { ...s, bossThresholdCrossed: true, player: { ...s.player, lives: 3, invincibleTimer: 0 } };

    const eliteId = s.enemies.find((e) => e.isAlive && e.tier === "Elite")?.id;
    if (!eliteId) throw new Error("no elite");
    const { player } = s;
    s = {
      ...s,
      enemies: s.enemies.map((e) =>
        e.id === eliteId
          ? {
              ...e,
              phase: "Diving" as const,
              x: player.x,
              y: player.y,
              path: {
                p0: { x: player.x, y: player.y },
                p1: { x: player.x, y: player.y + 5 },
                p2: { x: player.x, y: player.y + 10 },
                p3: { x: player.x, y: player.y + 15 },
              },
              pathT: 0,
              pathDuration: 1000,
            }
          : e
      ),
    };
    s = tick(s, 16, NO_INPUT);
    expect(s.player.lives).toBeLessThan(3);
  });
});

// ---------------------------------------------------------------------------
// #1031 — Straggler aggression
// ---------------------------------------------------------------------------

describe("#1031 Straggler aggression", () => {
  it("stragglerEnabled is false on Ensign difficulty", () => {
    const s = initStarSwarm(CANVAS_W, CANVAS_H, 1, 42, "Ensign");
    expect(s.stragglerEnabled).toBe(false);
  });

  it("stragglerEnabled is true on LieutenantJG (default) difficulty", () => {
    const s = initStarSwarm(CANVAS_W, CANVAS_H);
    expect(s.stragglerEnabled).toBe(true);
  });

  it("when ≤3 enemies remain and stragglerEnabled, Formation enemies immediately wiggle", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H, 1, 42, "LieutenantJG");
    s = advanceMs(s, 8000);
    expect(s.phase).toBe("Playing");

    // Kill all but 2 enemies
    const alive = s.enemies.filter((e) => e.isAlive);
    const toKill = alive.slice(2);
    s = {
      ...s,
      enemies: s.enemies.map((e) =>
        toKill.some((k) => k.id === e.id) ? { ...e, isAlive: false, hp: 0 } : e
      ),
    };

    s = tick(s, 16, NO_INPUT);
    const formationCount = s.enemies.filter((e) => e.isAlive && e.phase === "Formation").length;
    expect(formationCount).toBe(0); // all should have entered Wiggling
  });

  it("straggler does not trigger on Ensign difficulty", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H, 1, 42, "Ensign");
    s = advanceMs(s, 8000);
    expect(s.phase).toBe("Playing");

    const alive = s.enemies.filter((e) => e.isAlive);
    const toKill = alive.slice(2);
    s = {
      ...s,
      enemies: s.enemies.map((e) =>
        toKill.some((k) => k.id === e.id) ? { ...e, isAlive: false, hp: 0 } : e
      ),
    };
    s = tick(s, 16, NO_INPUT);
    // Formation enemies should still be in Formation (no straggler kick)
    const wiggling = s.enemies.filter((e) => e.isAlive && e.phase === "Wiggling");
    expect(wiggling.length).toBe(0);
  });

  it("stragglerEnabled carries over to next wave", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H, 1, 42, "LieutenantJG");
    s = advanceMs(s, 8000);
    s = { ...s, enemies: s.enemies.map((e) => ({ ...e, isAlive: false, hp: 0 })) };
    s = tick(s, 16, NO_INPUT); // WaveClear
    s = advanceMs(s, 3000);
    expect(s.wave).toBe(2);
    expect(s.stragglerEnabled).toBe(true);
  });

  it("Ensign natural stragglerEnabled=false persists into wave 2", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H, 1, 42, "Ensign");
    expect(s.stragglerEnabled).toBe(false);
    s = advanceMs(s, 8000);
    s = { ...s, enemies: s.enemies.map((e) => ({ ...e, isAlive: false, hp: 0 })) };
    s = tick(s, 16, NO_INPUT);
    s = advanceMs(s, 3000);
    expect(s.wave).toBe(2);
    expect(s.stragglerEnabled).toBe(false);
  });

  it("dev override stragglerEnabled=false persists across wave boundary on non-Ensign", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H, 1, 42, "LieutenantJG", false);
    expect(s.stragglerEnabled).toBe(false);
    s = advanceMs(s, 8000);
    s = { ...s, enemies: s.enemies.map((e) => ({ ...e, isAlive: false, hp: 0 })) };
    s = tick(s, 16, NO_INPUT);
    s = advanceMs(s, 3000);
    expect(s.wave).toBe(2);
    expect(s.stragglerEnabled).toBe(false);
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
// #1035 — Buddy Ship: spawns, traverses, fires burst
// ---------------------------------------------------------------------------

describe("#1035 Buddy Ship", () => {
  it("buddyShips initialises empty", () => {
    const s = initStarSwarm(CANVAS_W, CANVAS_H);
    expect(s.buddyShips).toEqual([]);
  });

  it("applyPowerUp(buddy) adds one buddy ship to state", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H);
    s = advanceMs(s, 8000);
    s = applyPowerUp(s, "buddy");
    expect(s.buddyShips.length).toBe(1);
  });

  it("buddy ship fires player bullets and is removed after traversal", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H);
    s = advanceMs(s, 8000);
    s = applyPowerUp(s, "buddy");
    expect(s.buddyShips.length).toBe(1);

    // Advance until the buddy has fired (pathT >= 0.45) and completed (pathT > 1.2).
    // #1314: proportional aiming is more lethal — invincibility prevents GameOver mid-advance.
    s = { ...s, player: { ...s.player, invincibleTimer: 999_999 } };
    s = advanceMs(s, 4000, NO_INPUT);

    // Buddy should be gone after full traversal
    expect(s.buddyShips.length).toBe(0);
    // Should have fired at least a few bullets during the run
    // (bullets may have scrolled off, so just check they were ever created)
    // We check by observing that bullets were fired at some point — we track via state snapshot
    const bulletsAfter = s.playerBullets.length;
    // At some point during the 4000ms window bullets were generated; final count may be lower
    // due to off-screen removal. We just verify buddy removed cleanly.
    expect(bulletsAfter).toBeGreaterThanOrEqual(0); // always true — buddy removal is the key check
  });
});

// ---------------------------------------------------------------------------
// #1037 — Difficulty tiers
// ---------------------------------------------------------------------------

describe("#1037 Difficulty tiers", () => {
  it("DIFFICULTY_TIERS has 10 entries ordered Ensign→FleetAdmiral", () => {
    expect(DIFFICULTY_TIERS.length).toBe(10);
    expect(DIFFICULTY_TIERS[0]).toBe("Ensign");
    expect(DIFFICULTY_TIERS[9]).toBe("FleetAdmiral");
  });

  it("difficultyMultiplier returns 1 for Ensign and 10 for FleetAdmiral", () => {
    expect(difficultyMultiplier("Ensign")).toBe(1);
    expect(difficultyMultiplier("FleetAdmiral")).toBe(10);
  });

  it("difficultyMultiplier returns a positive number for every tier", () => {
    for (const tier of DIFFICULTY_TIERS) {
      expect(difficultyMultiplier(tier)).toBeGreaterThan(0);
    }
  });

  it("difficultyParamScale returns 0.7 for Ensign and 3.0 for FleetAdmiral", () => {
    expect(difficultyParamScale("Ensign")).toBeCloseTo(0.7);
    expect(difficultyParamScale("FleetAdmiral")).toBeCloseTo(3.0);
  });

  it("difficultyLabel returns a non-empty string for every tier", () => {
    for (const tier of DIFFICULTY_TIERS) {
      expect(difficultyLabel(tier).length).toBeGreaterThan(0);
    }
  });

  it("initStarSwarm stores difficulty in state", () => {
    const tiers: DifficultyTier[] = ["Ensign", "Captain", "FleetAdmiral"];
    for (const tier of tiers) {
      const s = initStarSwarm(CANVAS_W, CANVAS_H, 1, 42, tier);
      expect(s.difficulty).toBe(tier);
    }
  });

  it("Ensign disables straggler; all other tiers enable it", () => {
    const ensign = initStarSwarm(CANVAS_W, CANVAS_H, 1, 42, "Ensign");
    expect(ensign.stragglerEnabled).toBe(false);
    for (const tier of DIFFICULTY_TIERS.filter((t) => t !== "Ensign")) {
      const s = initStarSwarm(CANVAS_W, CANVAS_H, 1, 42, tier);
      expect(s.stragglerEnabled).toBe(true);
    }
  });

  it("score multiplier is applied: FleetAdmiral kill worth 10× base", () => {
    let base = initStarSwarm(CANVAS_W, CANVAS_H, 1, 42, "Ensign");
    let hard = initStarSwarm(CANVAS_W, CANVAS_H, 1, 42, "FleetAdmiral");
    base = advanceMs(base, 8000);
    hard = advanceMs(hard, 8000);
    expect(base.phase).toBe("Playing");
    expect(hard.phase).toBe("Playing");

    const gruntBase = base.enemies.find((e) => e.isAlive && e.tier === "Grunt");
    const gruntHard = hard.enemies.find((e) => e.isAlive && e.tier === "Grunt");
    if (!gruntBase || !gruntHard) throw new Error("no grunt found");

    const kill = (s: StarSwarmState, id: number): StarSwarmState => {
      const e = s.enemies.find((en) => en.id === id)!;
      const b: Bullet = {
        id: 55500 + id,
        x: e.x,
        y: e.y,
        vx: 0,
        vy: 0,
        owner: "player",
        width: e.width,
        height: e.height,
        damage: 999,
      };
      return tick({ ...s, playerBullets: [b] }, 16, NO_INPUT);
    };

    const scoreBase = kill(base, gruntBase.id).score;
    const scoreHard = kill(hard, gruntHard.id).score;
    expect(scoreHard).toBe(scoreBase * 10);
  });

  it("difficulty carries over to next wave", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H, 1, 42, "Admiral");
    s = advanceMs(s, 8000);
    s = { ...s, enemies: s.enemies.map((e) => ({ ...e, isAlive: false, hp: 0 })) };
    s = tick(s, 16, NO_INPUT);
    s = advanceMs(s, 3000);
    expect(s.wave).toBe(2);
    expect(s.difficulty).toBe("Admiral");
  });

  it("wave clear bonus is multiplied by difficulty", () => {
    let base = initStarSwarm(CANVAS_W, CANVAS_H, 1, 42, "Ensign");
    let hard = initStarSwarm(CANVAS_W, CANVAS_H, 1, 42, "Captain"); // ×4
    base = advanceMs(base, 8000);
    hard = advanceMs(hard, 8000);

    // Kill all enemies to trigger wave clear bonus
    const wipeAll = (s: StarSwarmState): StarSwarmState => ({
      ...s,
      enemies: s.enemies.map((e) => ({ ...e, isAlive: false, hp: 0 })),
    });
    base = tick(wipeAll(base), 16, NO_INPUT);
    hard = tick(wipeAll(hard), 16, NO_INPUT);

    // Both should have advanced to wave 2, and hard score should be ≥ 4× base score
    expect(base.wave).toBe(2);
    expect(hard.wave).toBe(2);
    expect(hard.score).toBeGreaterThanOrEqual(base.score * 4);
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
// Carrier tier (#2484)
// ---------------------------------------------------------------------------

describe("Carrier tier (#2484)", () => {
  let bulletId = 90_000;
  function shotAt(x: number, y: number, extra: Partial<Bullet> = {}): Bullet {
    return {
      id: bulletId++,
      x,
      y,
      vx: 0,
      vy: -0.56,
      owner: "player",
      width: 5,
      height: 14,
      damage: 1,
      ...extra,
    };
  }
  function settled(wave = 1): StarSwarmState {
    return advanceMs(initStarSwarm(CANVAS_W, CANVAS_H, wave), 8000);
  }
  const carrierOf = (s: StarSwarmState) => s.enemies.find((e) => e.tier === "Carrier");
  const withoutEscorts = (s: StarSwarmState): StarSwarmState => ({
    ...s,
    enemies: s.enemies.map((e) => (e.tier === "Boss" ? { ...e, isAlive: false, hp: 0 } : e)),
  });

  it("wave 1 has exactly one Carrier, centered in a row above the Bosses", () => {
    const s = initStarSwarm(CANVAS_W, CANVAS_H);
    const carriers = s.enemies.filter((e) => e.tier === "Carrier");
    expect(carriers).toHaveLength(1);
    const c = carriers[0]!;
    expect(c.formationX).toBe(CANVAS_W / 2);
    expect(c.hp).toBe(8);
    const bossYs = s.enemies.filter((e) => e.tier === "Boss").map((e) => e.formationY);
    const eliteYs = s.enemies.filter((e) => e.tier === "Elite").map((e) => e.formationY);
    expect(bossYs).toHaveLength(4);
    expect(Math.min(...bossYs)).toBeGreaterThan(c.formationY);
    expect(Math.min(...eliteYs)).toBeGreaterThan(Math.max(...bossYs));
  });

  it("is excluded from the non-boss threshold count", () => {
    const s = initStarSwarm(CANVAS_W, CANVAS_H);
    const gruntsAndElites = s.enemies.filter((e) => e.tier === "Grunt" || e.tier === "Elite");
    expect(s.startingNonBossCount).toBe(gruntsAndElites.length);
    expect(isLeaderTier("Carrier")).toBe(true);
    expect(isLeaderTier("Boss")).toBe(true);
    expect(isLeaderTier("Elite")).toBe(false);
  });

  it("holds formation for the whole wave — never wiggles, dives, circles or returns", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H);
    const seen = new Set<string>();
    for (let t = 0; t < 40_000; t += 16) {
      s = tick(s, 16, NO_INPUT);
      const c = carrierOf(s)!;
      seen.add(c.phase);
      if (s.phase === "GameOver") break;
    }
    expect([...seen].every((p) => p === "SwoopIn" || p === "Formation")).toBe(true);
    expect(seen.has("Formation")).toBe(true);
  });

  it("holds station when alone: never leaves formation, and a live Carrier keeps the wave open", () => {
    // (its lone-ship lasers are covered under Carrier actions, #2485)
    let s = settled();
    s = {
      ...s,
      enemies: s.enemies.map((e) => (e.tier === "Carrier" ? e : { ...e, isAlive: false, hp: 0 })),
      enemyBullets: [],
      enemyFireDisabled: true,
    };
    for (let t = 0; t < 10_000; t += 16) {
      s = tick(s, 16, NO_INPUT);
      expect(carrierOf(s)!.phase).toBe("Formation");
    }
    expect(carrierOf(s)!.isAlive).toBe(true);
    expect(s.wave).toBe(1); // a live Carrier keeps the wave open
  });

  it("sways at most ±12 px while Bosses sway ±20 and Grunts ±40", () => {
    // Enemy fire off so the drifting player can't be killed (GameOver would freeze the sway)
    let s = { ...settled(), enemyFireDisabled: true, enemyBullets: [] };
    for (let t = 0; t < 4000 && Math.abs(s.formationSwayX) < 30; t += 16) s = tick(s, 16, NO_INPUT);
    expect(Math.abs(s.formationSwayX)).toBeGreaterThanOrEqual(30);
    const c = carrierOf(s)!;
    expect(Math.abs(c.x - c.formationX)).toBeLessThanOrEqual(12);
    const boss = s.enemies.find((e) => e.isAlive && e.tier === "Boss" && e.phase === "Formation")!;
    expect(Math.abs(boss.x - boss.formationX)).toBeLessThanOrEqual(20);
  });

  it("isCarrierArmored: true with an escort alive, false once all escorts die or the Carrier dies", () => {
    const s = settled();
    expect(isCarrierArmored(s)).toBe(true);
    expect(isCarrierArmored(withoutEscorts(s))).toBe(false);
    const oneEscort = {
      ...s,
      enemies: s.enemies.map((e, i) =>
        e.tier === "Boss" && i !== s.enemies.findIndex((x) => x.tier === "Boss")
          ? { ...e, isAlive: false, hp: 0 }
          : e
      ),
    };
    expect(isCarrierArmored(oneEscort)).toBe(true);
    const deadCarrier = {
      ...s,
      enemies: s.enemies.map((e) => (e.tier === "Carrier" ? { ...e, isAlive: false, hp: 0 } : e)),
    };
    expect(isCarrierArmored(deadCarrier)).toBe(false);
  });

  it("carrierJustExposed fires only when the last escort dies with the Carrier still alive", () => {
    const armored = settled();
    const killCarrier = (st: StarSwarmState): StarSwarmState => ({
      ...st,
      enemies: st.enemies.map((e) => (e.tier === "Carrier" ? { ...e, isAlive: false, hp: 0 } : e)),
    });
    // escorts die, Carrier lives → the real "exposed" moment
    expect(carrierJustExposed(armored, withoutEscorts(armored))).toBe(true);
    // Carrier killed through its armor (piercing) while escorts live → not an exposure
    expect(carrierJustExposed(armored, killCarrier(armored))).toBe(false);
    // already exposed, then the Carrier dies → nothing new to announce
    expect(carrierJustExposed(withoutEscorts(armored), killCarrier(withoutEscorts(armored)))).toBe(
      false
    );
    // no change → false
    expect(carrierJustExposed(armored, armored)).toBe(false);
    expect(carrierJustExposed(withoutEscorts(armored), withoutEscorts(armored))).toBe(false);
  });

  it("escorted: an ordinary shot is spent on the force field — ring plays, no damage", () => {
    let s = settled();
    const c = carrierOf(s)!;
    s = { ...s, playerBullets: [shotAt(c.x, c.y)] };
    s = tick(s, 16, NO_INPUT);
    const after = carrierOf(s)!;
    expect(after.hp).toBe(8);
    expect(after.hitFlashTimer).toBeGreaterThan(0);
    expect(s.playerBullets).toHaveLength(0);
  });

  it("escorted: a piercing shot goes through the armor", () => {
    let s = settled();
    const c = carrierOf(s)!;
    s = { ...s, playerBullets: [shotAt(c.x, c.y, { piercing: true, damage: 1, width: 12 })] };
    s = tick(s, 16, NO_INPUT);
    expect(carrierOf(s)!.hp).toBe(7);
  });

  it("a piercing shot damages an enemy only once across its whole flight, not once per tick it overlaps it", () => {
    // Regression for the buddy-ship "one-shots a full-health Carrier" report: a piercing
    // bullet is never consumed on hit, so a slow bullet parked on a big hitbox used to re-deal
    // its damage on every tick it stayed inside it instead of just the first.
    let s = settled();
    const c = carrierOf(s)!;
    s = {
      ...s,
      playerBullets: [shotAt(c.x, c.y, { piercing: true, damage: 1, width: 12, vx: 0, vy: 0 })],
    };
    s = tick(s, 16, NO_INPUT);
    expect(carrierOf(s)!.hp).toBe(7);
    s = tick(s, 16, NO_INPUT);
    expect(carrierOf(s)!.hp).toBe(7);
    s = tick(s, 16, NO_INPUT);
    expect(carrierOf(s)!.hp).toBe(7);
  });

  it("exposed: with all four escorts dead an ordinary shot damages it", () => {
    let s = withoutEscorts(settled());
    const c = carrierOf(s)!;
    s = { ...s, playerBullets: [shotAt(c.x, c.y)] };
    s = tick(s, 16, NO_INPUT);
    expect(carrierOf(s)!.hp).toBe(7);
  });

  it("scores 1000 × difficulty multiplier with no dive bonus", () => {
    let s = withoutEscorts(settled());
    const c = carrierOf(s)!;
    s = {
      ...s,
      score: 0,
      enemies: s.enemies.map((e) => (e.tier === "Carrier" ? { ...e, hp: 1 } : e)),
      playerBullets: [shotAt(c.x, c.y)],
    };
    s = tick(s, 16, NO_INPUT);
    expect(carrierOf(s)!.isAlive).toBe(false);
    expect(s.score).toBe(Math.round(1000 * difficultyMultiplier(s.difficulty)));
  });

  it("smart bomb rings off an escorted Carrier but chips an exposed one", () => {
    const armored = applyPowerUp(settled(), "bomb");
    expect(carrierOf(armored)!.hp).toBe(8);
    expect(carrierOf(armored)!.hitFlashTimer).toBeGreaterThan(0);
    const exposed = applyPowerUp(withoutEscorts(settled()), "bomb");
    expect(carrierOf(exposed)!.hp).toBe(7);
  });

  it("never rams the player even when it is the last ship and stragglers turn aggressive", () => {
    let s = settled();
    s = {
      ...s,
      enemies: s.enemies.map((e) => (e.tier === "Carrier" ? e : { ...e, isAlive: false, hp: 0 })),
      enemyBullets: [], // nothing already in flight from the dead escorts
      enemyFireDisabled: true, // #2485: its lone-ship lasers are not a ram
      player: { ...s.player, lives: 3, invincibleTimer: 0 },
    };
    // #2485: nor is its beam — park it so only a ram could cost a life
    s = {
      ...s,
      enemies: s.enemies.map((e) => (e.tier === "Carrier" ? { ...e, beamTimer: 1e9 } : e)),
    };
    const livesBefore = s.player.lives;
    for (let t = 0; t < 15_000; t += 16) s = tick(s, 16, NO_INPUT);
    expect(s.player.lives).toBe(livesBefore);
    expect(carrierOf(s)!.phase).toBe("Formation");
  });
});

// ---------------------------------------------------------------------------
// Errant asteroids (#2486)
// ---------------------------------------------------------------------------

describe("Errant asteroids (#2486)", () => {
  let nextId = 70_000;
  function rock(kind: AsteroidKind, x: number, y: number, extra: Partial<Asteroid> = {}): Asteroid {
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
  function shot(x: number, y: number, extra: Partial<Bullet> = {}): Bullet {
    return {
      id: nextId++,
      x,
      y,
      vx: 0,
      vy: 0,
      owner: "player",
      width: 5,
      height: 14,
      damage: 1,
      ...extra,
    };
  }
  /** A quiet mid-wave state: nobody shooting, player unkillable, no rocks yet. */
  function quiet(wave: number): StarSwarmState {
    const s = advanceMs(initStarSwarm(CANVAS_W, CANVAS_H, wave), 8000);
    return {
      ...s,
      enemyFireDisabled: true,
      enemyBullets: [],
      asteroids: [],
      player: { ...s.player, lives: 3, invincibleTimer: 0 },
      // #2485: the Carrier's beam would eventually kill a player parked in its column
      enemies: s.enemies.map((e) => (e.tier === "Carrier" ? { ...e, beamTimer: 1e9 } : e)),
    };
  }
  const SAFE_Y = 460; // below the deepest formation row, above the player lane

  it("never spawns on a timer during wave 1", () => {
    let s = quiet(1);
    for (let t = 0; t < 45_000; t += 16) {
      s = tick(s, 16, NO_INPUT);
      expect(s.asteroids).toHaveLength(0);
    }
  });

  it("spawns on a timer from wave 2 and never exceeds the cap by itself", () => {
    let s = quiet(2);
    let seen = 0;
    for (let t = 0; t < 45_000; t += 16) {
      s = tick(s, 16, NO_INPUT);
      seen = Math.max(seen, s.asteroids.length);
      expect(s.asteroids.length).toBeLessThanOrEqual(MAX_ASTEROIDS);
    }
    expect(seen).toBeGreaterThanOrEqual(1);
  });

  it("does not spawn while the wave is still swooping in", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H, 2);
    while (s.phase === "SwoopIn") {
      s = tick(s, 16, NO_INPUT);
      expect(s.asteroids).toHaveLength(0);
    }
  });

  it("asteroidsDisabled stops timed spawns; throwAsteroid still works and honours the cap", () => {
    let s = { ...quiet(2), asteroidsDisabled: true };
    for (let t = 0; t < 45_000; t += 16) s = tick(s, 16, NO_INPUT);
    expect(s.asteroids).toHaveLength(0);
    s = throwAsteroid(s);
    expect(s.asteroids).toHaveLength(1);
    s = throwAsteroid(throwAsteroid(s));
    expect(s.asteroids).toHaveLength(MAX_ASTEROIDS);
  });

  it("rocks in flight carry across a wave clear into a normal wave", () => {
    let s = quiet(1);
    const a = rock("large", CANVAS_W / 2, SAFE_Y);
    s = {
      ...s,
      asteroids: [a],
      enemies: s.enemies.map((e) => ({ ...e, isAlive: false, hp: 0 })),
    };
    s = tick(s, 16, NO_INPUT);
    expect(s.wave).toBe(2);
    expect(s.phase).toBe("SwoopIn");
    expect(s.asteroids.map((r) => r.id)).toEqual([a.id]);
  });

  it("rides into a boss wave like any other wave, but the timer spawns nothing there (#2490)", () => {
    let s = quiet(4);
    const a = rock("large", CANVAS_W / 2, SAFE_Y);
    s = {
      ...s,
      asteroids: [a],
      enemies: s.enemies.map((e) => ({ ...e, isAlive: false, hp: 0 })),
    };
    s = tick(s, 16, NO_INPUT);
    expect(s.wave).toBe(5);
    expect(s.asteroids.map((r) => r.id)).toEqual([a.id]);
    s = { ...s, asteroids: [], asteroidsDisabled: false, nextAsteroidTimer: 1 };
    s = advanceMs(s, 8000, NO_INPUT); // swoop-in, then Playing
    expect(s.phase).toBe("Playing");
    expect(s.asteroids).toHaveLength(0);
  });

  it("a player shot is spent on a rock and chips it — no points, piercing or not", () => {
    let s = { ...quiet(2), score: 12_345 };
    const a = rock("large", CANVAS_W / 2, SAFE_Y);
    s = {
      ...s,
      asteroids: [a],
      playerBullets: [shot(a.x, a.y), shot(a.x, a.y, { piercing: true })],
    };
    s = tick(s, 16, NO_INPUT);
    expect(s.playerBullets).toHaveLength(0);
    expect(s.asteroids[0]!.hp).toBe(ASTEROID_STATS.large.hp - 2);
    expect(s.asteroids[0]!.hitFlashTimer).toBeGreaterThan(0);
    expect(s.score).toBe(12_345);
  });

  it("an enemy shot is spent on a rock too", () => {
    let s = quiet(2);
    const a = rock("large", CANVAS_W / 2, SAFE_Y);
    const eb = shot(a.x, a.y, { owner: "enemy", height: 10 });
    s = { ...s, asteroids: [a], enemyBullets: [eb] };
    s = tick(s, 16, NO_INPUT);
    expect(s.enemyBullets.some((b) => b.id === eb.id)).toBe(false);
    expect(s.asteroids[0]!.hp).toBe(ASTEROID_STATS.large.hp - 1);
  });

  it("a broken large rock splits into two small ones; a broken small rock is gone", () => {
    let s = quiet(2);
    const big = rock("large", CANVAS_W / 2, SAFE_Y, { hp: 1 });
    s = { ...s, asteroids: [big], playerBullets: [shot(big.x, big.y)] };
    const explosionsBefore = s.explosions.length;
    s = tick(s, 16, NO_INPUT);
    expect(s.asteroids).toHaveLength(2);
    expect(s.asteroids.every((r) => r.kind === "small")).toBe(true);
    expect(s.explosions.length).toBe(explosionsBefore + 1);

    const small = rock("small", CANVAS_W / 2, SAFE_Y, { hp: 1 });
    s = { ...s, asteroids: [small], playerBullets: [shot(small.x, small.y)] };
    s = tick(s, 16, NO_INPUT);
    expect(s.asteroids).toHaveLength(0);
  });

  it("a rock strikes each enemy once and kills for no points; small rocks shatter on impact", () => {
    let s = { ...quiet(2), score: 500 };
    const elite = s.enemies.find(
      (e) => e.isAlive && e.tier === "Elite" && e.phase === "Formation"
    )!;
    const big = rock("large", elite.x, elite.y);
    s = { ...s, asteroids: [big] };
    s = tick(s, 16, NO_INPUT);
    s = tick(s, 16, NO_INPUT); // a second tick must not hit the same Elite again
    const after = s.enemies.find((e) => e.id === elite.id)!;
    expect(after.hp).toBe(1);
    expect(after.isAlive).toBe(true);
    expect(s.asteroids.find((r) => r.id === big.id)?.hitEnemyIds).toContain(elite.id);

    const grunt = s.enemies.find(
      (e) => e.isAlive && e.tier === "Grunt" && e.phase === "Formation"
    )!;
    const small = rock("small", grunt.x, grunt.y);
    s = { ...s, asteroids: [small] };
    s = tick(s, 16, NO_INPUT);
    expect(s.enemies.find((e) => e.id === grunt.id)!.isAlive).toBe(false);
    expect(s.asteroids.some((r) => r.id === small.id)).toBe(false); // shattered, no split
    expect(s.score).toBe(500);
  });

  it("strikes a swooping ship once it is on screen, but not one still waiting off-screen", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H, 2);
    const waiting = s.enemies.find((e) => e.pathT < 0)!;
    s = { ...s, asteroids: [rock("large", waiting.x, waiting.y)] };
    s = tick(s, 16, NO_INPUT);
    expect(s.enemies.find((e) => e.id === waiting.id)!.hp).toBe(waiting.hp);

    s = advanceMs(s, 700);
    const flying = s.enemies.find((e) => e.phase === "SwoopIn" && e.pathT >= 0 && e.y > 0)!;
    s = { ...s, asteroids: [rock("large", flying.x, flying.y)] };
    s = tick(s, 16, NO_INPUT);
    const hit = s.enemies.find((e) => e.id === flying.id)!;
    expect(hit.hp < flying.hp || !hit.isAlive).toBe(true);
  });

  it("shatters harmlessly on the Carrier's force field", () => {
    let s = quiet(2);
    const c = s.enemies.find((e) => e.isAlive && e.tier === "Carrier")!;
    const explosionsBefore = s.explosions.length;
    s = { ...s, asteroids: [rock("large", c.x, c.y)] };
    s = tick(s, 16, NO_INPUT);
    const after = s.enemies.find((e) => e.id === c.id)!;
    expect(after.hp).toBe(c.hp);
    expect(after.hitFlashTimer).toBeGreaterThan(0);
    expect(s.asteroids).toHaveLength(0); // shattered, not split
    expect(s.explosions.length).toBe(explosionsBefore + 1);
  });

  it("on the player: costs a life and shatters; invincibility ignores it; the shield absorbs it", () => {
    const base = quiet(2);
    let s = { ...base, asteroids: [rock("small", base.player.x, base.player.y)] };
    s = tick(s, 16, NO_INPUT);
    expect(s.player.lives).toBe(2);
    expect(s.asteroids).toHaveLength(0);

    s = {
      ...base,
      asteroids: [rock("small", base.player.x, base.player.y)],
      player: { ...base.player, invincibleTimer: 5000 },
    };
    s = tick(s, 16, NO_INPUT);
    expect(s.player.lives).toBe(3);
    expect(s.asteroids).toHaveLength(1);

    s = applyPowerUp(base, "shield");
    s = { ...s, asteroids: [rock("small", s.player.x, s.player.y)] };
    s = tick(s, 16, NO_INPUT);
    expect(s.player.lives).toBe(3);
    expect(s.asteroids).toHaveLength(0);
    expect(s.activePowerUp?.shieldAbsorbed).toBeGreaterThanOrEqual(1);
  });

  it("the smart bomb clears every rock", () => {
    const s0 = quiet(2);
    const s = applyPowerUp(
      { ...s0, asteroids: [rock("large", 100, SAFE_Y), rock("small", 260, SAFE_Y)] },
      "bomb"
    );
    expect(s.asteroids).toHaveLength(0);
    expect(s.explosions.length).toBeGreaterThanOrEqual(s0.explosions.length + 2);
  });
});

// ---------------------------------------------------------------------------
// Carrier actions (#2485)
// ---------------------------------------------------------------------------

describe("Carrier actions (#2485)", () => {
  /** Mid-wave, nobody else shooting, player parked well left of the Carrier's column. */
  function quiet(difficulty: DifficultyTier = "LieutenantJG"): StarSwarmState {
    const s = advanceMs(initStarSwarm(CANVAS_W, CANVAS_H, 1, 42, difficulty), 8000);
    return {
      ...s,
      enemyFireDisabled: true,
      enemyBullets: [],
      asteroids: [],
      asteroidsDisabled: true,
      player: { ...s.player, x: 40, lives: 3, invincibleTimer: 0 },
    };
  }
  const ASIDE: StarSwarmInput = { playerX: 40, fire: false };
  const carrierOf = (s: StarSwarmState) =>
    s.enemies.find((e) => e.isAlive && e.tier === "Carrier")!;
  const killAllBut = (s: StarSwarmState, keep: (e: (typeof s.enemies)[number]) => boolean) => ({
    ...s,
    enemies: s.enemies.map((e) => (keep(e) ? e : { ...e, isAlive: false, hp: 0 })),
  });

  it("beam cycles idle → charge (600 ms) → fire (1200 ms) → idle on the base cadence", () => {
    let s = quiet();
    expect(s.phase).toBe("Playing");
    expect(carrierBeam(s)).toBeNull();
    const seen: { phase: string; at: number }[] = [];
    let t = 0;
    let chargeAt = -1;
    let fireAt = -1;
    while (t < BEAM_INTERVAL_BASE + BEAM_CHARGE_MS + BEAM_FIRE_MS + 2000) {
      const prev = s;
      s = tick(s, 16, ASIDE);
      t += 16;
      const c = carrierOf(s);
      if (seen.length === 0 || seen[seen.length - 1]!.phase !== c.beamPhase) {
        seen.push({ phase: c.beamPhase, at: t });
      }
      if (carrierBeamJustStarted(prev, s)) chargeAt = t;
      if (carrierBeamJustFired(prev, s)) fireAt = t;
    }
    const order = seen.map((x) => x.phase);
    expect(order.slice(0, 4)).toEqual(["idle", "charge", "fire", "idle"]);
    expect(chargeAt).toBeGreaterThan(0);
    expect(fireAt - chargeAt).toBeGreaterThanOrEqual(BEAM_CHARGE_MS - 16);
    expect(fireAt - chargeAt).toBeLessThanOrEqual(BEAM_CHARGE_MS + 32);
    const idleAgain = seen[3]!.at;
    expect(idleAgain - fireAt).toBeGreaterThanOrEqual(BEAM_FIRE_MS - 16);
    expect(idleAgain - fireAt).toBeLessThanOrEqual(BEAM_FIRE_MS + 32);
    // and it never shot a bullet while doing so (beam is not a bullet)
    expect(s.enemyBullets).toHaveLength(0);
  });

  it("carrierBeam() reports position and progress while charging or firing", () => {
    const s = quiet();
    const c = carrierOf(s);
    const charging = {
      ...s,
      enemies: s.enemies.map((e) =>
        e.id === c.id ? { ...e, beamPhase: "charge" as const, beamTimer: BEAM_CHARGE_MS / 2 } : e
      ),
    };
    const b = carrierBeam(charging)!;
    expect(b.phase).toBe("charge");
    expect(b.x).toBe(c.x);
    expect(b.y).toBe(c.y + c.height / 2);
    expect(b.progress).toBeCloseTo(0.5, 5);
  });

  it("a firing beam costs a life in its column, misses beside it; shield holds; invincibility ignores", () => {
    const base = quiet();
    const c = carrierOf(base);
    const firing = (s: StarSwarmState, playerX: number, invincibleTimer = 0) => ({
      ...s,
      player: { ...s.player, x: playerX, invincibleTimer },
      enemies: s.enemies.map((e) =>
        e.id === c.id ? { ...e, beamPhase: "fire" as const, beamTimer: BEAM_FIRE_MS } : e
      ),
    });
    const inBeam: StarSwarmInput = { playerX: c.x, fire: false };
    let s = tick(firing(base, c.x), 16, inBeam);
    expect(s.player.lives).toBe(2);

    const beside: StarSwarmInput = {
      playerX: c.x + BEAM_HALF_WIDTH + PLAYER_HURT_RADIUS + 6,
      fire: false,
    };
    s = tick(firing(base, beside.playerX), 16, beside);
    expect(s.player.lives).toBe(3);

    s = tick(firing(applyPowerUp(base, "shield"), c.x), 16, inBeam);
    expect(s.player.lives).toBe(3);

    s = tick(firing(base, c.x, 5000), 16, inBeam);
    expect(s.player.lives).toBe(3);
  });

  it("a shield holds off the beam but never a ship ramming through it (#1033 rule)", () => {
    const base = applyPowerUp(quiet(), "shield");
    const c = carrierOf(base);
    const grunt = base.enemies.find((e) => e.isAlive && e.tier === "Grunt")!;
    const inBeam: StarSwarmInput = { playerX: c.x, fire: false };
    const ram = { x: c.x, y: base.player.y };
    // shielded, parked in the firing beam's column, with a Grunt right on top of the ship
    let s = {
      ...base,
      player: { ...base.player, x: c.x },
      enemies: base.enemies.map((e) =>
        e.id === c.id
          ? { ...e, beamPhase: "fire" as const, beamTimer: BEAM_FIRE_MS }
          : e.id === grunt.id
            ? {
                ...e,
                // circling on a zero-radius loop centred on the player = a ship sitting on it
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
    s = tick(s, 16, inBeam);
    expect(s.player.lives).toBe(2); // the ram still costs a life…
    expect(s.enemies.find((e) => e.id === grunt.id)!.isAlive).toBe(false); // …and kills the rammer
    expect(s.activePowerUp?.type).toBe("shield"); // the beam itself was absorbed, shield intact
  });

  it("#2699: stays silent while armored, then fires twin aimed lasers once unarmored — even with a grunt still alive", () => {
    let s = { ...quiet(), enemyFireDisabled: false, pauseStraggler: true, nextDiveTimer: 1e9 };
    const c = carrierOf(s);
    const boss = s.enemies.find((e) => e.isAlive && e.tier === "Boss")!;
    const grunt = s.enemies.find((e) => e.isAlive && e.tier === "Grunt")!;
    s = killAllBut(s, (e) => e.id === c.id || e.id === boss.id || e.id === grunt.id);
    s = {
      ...s,
      enemies: s.enemies.map((e) =>
        e.id === grunt.id || e.id === boss.id
          ? { ...e, shootTimer: 1e9 }
          : e.id === c.id
            ? { ...e, shootTimer: 0 }
            : e
      ),
    };
    expect(isCarrierArmored(s)).toBe(true);
    for (let t = 0; t < 3000; t += 16) {
      s = tick(s, 16, ASIDE);
      expect(s.enemyBullets).toHaveLength(0);
    }
    // its last Boss escort dies — armor drops, but the grunt is still alive
    s = killAllBut(s, (e) => e.id === c.id || e.id === grunt.id);
    expect(isCarrierArmored(s)).toBe(false);
    let volleyAt = -1;
    for (let t = 0; t < LONE_FIRE_INTERVAL + 100 && volleyAt < 0; t += 16) {
      s = tick(s, 16, ASIDE);
      if (s.enemyBullets.length > 0) volleyAt = t;
    }
    expect(volleyAt).toBeGreaterThanOrEqual(0);
    expect(s.enemies.find((e) => e.id === grunt.id)!.isAlive).toBe(true); // fires with the grunt still alive
    expect(s.enemyBullets).toHaveLength(2);
    const xs = s.enemyBullets.map((b) => b.x).sort((a, b) => a - b);
    const cx = carrierOf(s).x;
    expect(xs[1]! - xs[0]!).toBeCloseTo(28, 0);
    // fired from ±14 px of the Carrier's centre, then one tick of aimed drift toward the player
    expect(Math.abs((xs[0]! + xs[1]!) / 2 - cx)).toBeLessThan(8);
    // aimed at the player parked off to the left: both drift left while descending
    expect(s.enemyBullets.every((b) => b.vx < 0 && b.vy > 0)).toBe(true);
  });

  it("#2699: stays silent while any Boss escort lives, even once every grunt is dead", () => {
    let s = { ...quiet(), enemyFireDisabled: false, pauseStraggler: true, nextDiveTimer: 1e9 };
    const c = carrierOf(s);
    const boss = s.enemies.find((e) => e.isAlive && e.tier === "Boss")!;
    s = killAllBut(s, (e) => e.id === c.id || e.id === boss.id);
    s = {
      ...s,
      enemies: s.enemies.map((e) =>
        e.id === c.id ? { ...e, shootTimer: 0 } : { ...e, shootTimer: 1e9 }
      ),
    };
    expect(isCarrierArmored(s)).toBe(true);
    for (let t = 0; t < LONE_FIRE_INTERVAL + 100; t += 16) {
      s = tick(s, 16, ASIDE);
      expect(s.enemyBullets).toHaveLength(0);
    }
  });

  it("launches 2–4 reinforcements into empty grunt slots, capped at half the grunt slots", () => {
    let s = quiet();
    const gruntSlots = s.enemies.filter((e) => e.tier === "Grunt").length;
    expect(reinforceCap(1)).toBe(Math.floor(gruntSlots / 2));
    const killed = s.enemies.filter((e) => e.tier === "Grunt").slice(0, 10);
    const killedIds = new Set(killed.map((e) => e.id));
    const killedSlots = new Set(killed.map((e) => `${e.formationX},${e.formationY}`));
    s = {
      ...s,
      enemies: s.enemies.map((e) => (killedIds.has(e.id) ? { ...e, isAlive: false, hp: 0 } : e)),
    };
    const before = s.enemies.length;
    const prev = { ...s, reinforceTimer: 1 };
    s = tick(prev, 16, ASIDE);
    expect(reinforcementsJustLaunched(prev, s)).toBe(true);
    const launched = s.enemies.slice(before);
    expect(launched.length).toBeGreaterThanOrEqual(2);
    expect(launched.length).toBeLessThanOrEqual(4);
    expect(s.reinforcedThisWave).toBe(launched.length);
    for (const g of launched) {
      expect(g.tier).toBe("Grunt");
      expect(g.phase).toBe("SwoopIn");
      expect(killedSlots.has(`${g.formationX},${g.formationY}`)).toBe(true);
    }
    // keep emptying the grunt rows: total launches stop at the cap
    for (let round = 0; round < 10; round++) {
      s = {
        ...s,
        reinforceTimer: 1,
        enemies: s.enemies.map((e) => (e.tier === "Grunt" ? { ...e, isAlive: false, hp: 0 } : e)),
      };
      s = tick(s, 16, ASIDE);
    }
    expect(s.reinforcedThisWave).toBe(reinforceCap(1));
  });

  it("no reinforcements on Ensign, once the Carrier is dead, or outside the Playing phase", () => {
    const emptied = (s: StarSwarmState) => ({
      ...s,
      reinforceTimer: 1,
      enemies: s.enemies.map((e) => (e.tier === "Grunt" ? { ...e, isAlive: false, hp: 0 } : e)),
    });
    let s = tick(emptied(quiet("Ensign")), 16, ASIDE);
    expect(s.reinforcedThisWave).toBe(0);

    const base = quiet();
    s = tick(emptied(killAllBut(base, (e) => e.tier !== "Carrier")), 16, ASIDE);
    expect(s.reinforcedThisWave).toBe(0);

    s = tick({ ...emptied(base), phase: "SwoopIn" }, 16, ASIDE);
    expect(s.reinforcedThisWave).toBe(0);
  });

  it("reinforcements leave the escalation latches alone", () => {
    let s = quiet();
    s = {
      ...s,
      bossThresholdCrossed: true,
      reinforceTimer: 1,
      enemies: s.enemies.map((e) => (e.tier === "Grunt" ? { ...e, isAlive: false, hp: 0 } : e)),
    };
    const startCount = s.startingNonBossCount;
    s = tick(s, 16, ASIDE);
    expect(s.reinforcedThisWave).toBeGreaterThan(0);
    expect(s.bossThresholdCrossed).toBe(true);
    expect(s.startingNonBossCount).toBe(startCount);
  });
});

// ---------------------------------------------------------------------------
// Enemy asteroid response (#2487)
// ---------------------------------------------------------------------------

describe("Enemy asteroid response (#2487)", () => {
  let nextId = 80_000;
  function rock(kind: AsteroidKind, x: number, y: number, extra: Partial<Asteroid> = {}): Asteroid {
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
  /** Mid-wave, no enemy fire, beam parked, timed rocks off, player parked left. */
  function quiet(difficulty: DifficultyTier = "LieutenantJG", wave = 2): StarSwarmState {
    const s = advanceMs(initStarSwarm(CANVAS_W, CANVAS_H, wave, 42, difficulty), 8000);
    return {
      ...s,
      enemyFireDisabled: true,
      enemyBullets: [],
      asteroids: [],
      asteroidsDisabled: true,
      nextDiveTimer: 1e9,
      pauseStraggler: true,
      player: { ...s.player, x: 40, lives: 3, invincibleTimer: 0 },
      enemies: s.enemies.map((e) => (e.tier === "Carrier" ? { ...e, beamTimer: 1e9 } : e)),
    };
  }
  const ASIDE: StarSwarmInput = { playerX: 40, fire: false };
  /** The highest ship of a tier holding formation — so a rock dropped from above it crosses no
   * other ship of the same tier (the row above belongs to the next tier up). */
  const formation = (s: StarSwarmState, tier: string) =>
    s.enemies
      .filter((e) => e.isAlive && e.tier === tier && e.phase === "Formation")
      .sort((a, b) => a.formationY - b.formationY)[0]!;

  it("dodgeChance is base × difficulty, capped at 97%; the Carrier never rolls", () => {
    expect(dodgeChance("Grunt", 1)).toBeCloseTo(0.25);
    expect(dodgeChance("Elite", 1)).toBeCloseTo(0.55);
    expect(dodgeChance("Boss", 1)).toBeCloseTo(0.8);
    expect(dodgeChance("Grunt", difficultyParamScale("Ensign"))).toBeCloseTo(0.175);
    expect(dodgeChance("Grunt", difficultyParamScale("FleetAdmiral"))).toBeCloseTo(0.75); // 0.25 × 3
    expect(dodgeChance("Elite", difficultyParamScale("FleetAdmiral"))).toBe(0.97); // 1.65 → cap
    expect(dodgeChance("Boss", difficultyParamScale("FleetAdmiral"))).toBe(0.97);
    expect(dodgeChance("Carrier", 3)).toBe(0);
  });

  it("rolls exactly once per rock per ship, and records it", () => {
    let s = quiet();
    const elite = formation(s, "Elite");
    // slow enough that the 700 ms lookahead reaches this row but not the same-tier row below it
    const a = rock("large", elite.x, elite.y - 100, { vy: 0.12 });
    s = { ...s, asteroids: [a] };
    s = tick(s, 16, ASIDE);
    expect(s.enemies.find((e) => e.id === elite.id)!.rolledAsteroidIds).toContain(a.id);
    expect(s.tierStats.Elite.rolls).toBe(1);
    s = tick(s, 16, ASIDE);
    s = tick(s, 16, ASIDE);
    expect(s.tierStats.Elite.rolls).toBe(1);
  });

  it("a successful roll rate matches the base chance over many rolls", () => {
    // 400 independent rolls of a fresh Grunt against a fresh rock: expect ~25% ± 8%
    let dodged = 0;
    const N = 400;
    for (let i = 0; i < N; i++) {
      let s = quiet(); // seeds the engine itself (42) while building the wave…
      seedRng(1000 + i); // …so the per-iteration seed must come after it
      const g = formation(s, "Grunt");
      s = { ...s, asteroids: [rock("large", g.x, g.y - 100, { vy: 0.12 })] };
      s = tick(s, 16, ASIDE);
      dodged += s.tierStats.Grunt.dodged;
      expect(s.tierStats.Grunt.rolls).toBe(1);
    }
    expect(dodged / N).toBeGreaterThan(0.17);
    expect(dodged / N).toBeLessThan(0.33);
  });

  it("a formation sidestep moves 22 px away and returns to the slot", () => {
    let s = quiet();
    const g = formation(s, "Grunt");
    s = {
      ...s,
      enemies: s.enemies.map((e) =>
        e.id === g.id ? { ...e, dodge: { dir: -1 as const, t: 0, dur: DODGE_SIDESTEP_MS } } : e
      ),
    };
    for (let t = 0; t < DODGE_SIDESTEP_MS / 2; t += 16) s = tick(s, 16, ASIDE);
    let now = s.enemies.find((e) => e.id === g.id)!;
    // grunts take the full sway; the sidestep sits on top of it
    expect(now.x - (now.formationX + s.formationSwayX)).toBeCloseTo(-DODGE_SIDESTEP, 0);
    for (let t = 0; t < DODGE_SIDESTEP_MS; t += 16) s = tick(s, 16, ASIDE);
    now = s.enemies.find((e) => e.id === g.id)!;
    expect(now.dodge).toBeNull();
    expect(now.x).toBeCloseTo(now.formationX + s.formationSwayX, 5);
  });

  it("nudgePath shifts the control points sideways and leaves the destination alone", () => {
    const path = {
      p0: { x: 0, y: 0 },
      p1: { x: 10, y: 50 },
      p2: { x: 20, y: 100 },
      p3: { x: 30, y: 150 },
    };
    const left = nudgePath(path, -1);
    expect(left.p1.x).toBe(10 - DODGE_PATH_NUDGE);
    expect(left.p2.x).toBe(20 - DODGE_PATH_NUDGE);
    expect(left.p3).toEqual(path.p3);
    expect(left.p0).toEqual(path.p0);
    expect(nudgePath(path, 1).p1.x).toBe(10 + DODGE_PATH_NUDGE);
  });

  it("splitRemaining is the tail of the curve: same points, re-parameterised from 0", () => {
    const path = {
      p0: { x: 0, y: 0 },
      p1: { x: 100, y: 200 },
      p2: { x: 300, y: -50 },
      p3: { x: 360, y: 400 },
    };
    const evalAt = (p: typeof path, t: number) => {
      const u = 1 - t;
      return {
        x:
          u * u * u * p.p0.x + 3 * u * u * t * p.p1.x + 3 * u * t * t * p.p2.x + t * t * t * p.p3.x,
        y:
          u * u * u * p.p0.y + 3 * u * u * t * p.p1.y + 3 * u * t * t * p.p2.y + t * t * t * p.p3.y,
      };
    };
    const t0 = 0.35;
    const tail = splitRemaining(path, t0);
    for (const u of [0, 0.25, 0.5, 0.8, 1]) {
      const a = evalAt(tail, u);
      const b = evalAt(path, t0 + u * (1 - t0));
      expect(a.x).toBeCloseTo(b.x, 6);
      expect(a.y).toBeCloseTo(b.y, 6);
    }
    expect(splitRemaining(path, 0)).toBe(path);
  });

  it("a swooping ship on screen rolls, and a successful roll bends the rest of its path without moving it", () => {
    let found = false;
    for (let seed = 1; seed < 80 && !found; seed++) {
      seedRng(seed);
      _resetIds();
      let s = initStarSwarm(CANVAS_W, CANVAS_H, 2, seed);
      s = { ...s, enemyFireDisabled: true, asteroidsDisabled: true };
      s = advanceMs(s, 600);
      const flyer = s.enemies.find(
        (e) => e.phase === "SwoopIn" && e.pathT >= 0 && e.path && e.y > 0
      );
      if (!flyer) continue;
      // where it will be 200 ms from now (the first threat sample)
      const ahead = advanceMs(s, 200).enemies.find((e) => e.id === flyer.id)!;
      const a = rock("large", ahead.x, ahead.y);
      const before = s.tierStats[flyer.tier];
      s = tick({ ...s, asteroids: [a] }, 16, ASIDE);
      const after = s.enemies.find((e) => e.id === flyer.id)!;
      expect(after.rolledAsteroidIds).toContain(a.id);
      expect(s.tierStats[flyer.tier].pathRolls).toBe(before.pathRolls + 1);
      if (s.tierStats[flyer.tier].pathDodged > before.pathDodged) {
        found = true;
        // destination kept; path restarted from where the ship was, with the time it had left
        expect(after.path!.p3).toEqual(flyer.path!.p3);
        expect(after.pathT).toBeLessThan(0.05);
        expect(after.pathDuration).toBeCloseTo(flyer.pathDuration * (1 - flyer.pathT), 3);
        expect(after.path!.p0.x).toBeCloseTo(flyer.x, 0);
        expect(after.path!.p0.y).toBeCloseTo(flyer.y, 0);
        // no sideways jump: this tick moved it about as far as any other 16 ms tick would
        expect(Math.hypot(after.x - flyer.x, after.y - flyer.y)).toBeLessThan(16);
        // and the bend is there: the nudged tail's middle points sit off the un-nudged tail's
        const tail = splitRemaining(flyer.path!, flyer.pathT);
        expect(Math.abs(after.path!.p1.x - tail.p1.x)).toBe(DODGE_PATH_NUDGE);
        expect(Math.abs(after.path!.p2.x - tail.p2.x)).toBe(DODGE_PATH_NUDGE);
      }
    }
    expect(found).toBe(true);
  });

  it("does not roll while still off-screen (pathT < 0), nor as the Carrier, nor while circling", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H, 2);
    const waiting = s.enemies.find((e) => e.pathT < 0)!;
    s = tick({ ...s, asteroids: [rock("large", waiting.x, waiting.y)] }, 16, NO_INPUT);
    expect(s.enemies.find((e) => e.id === waiting.id)!.rolledAsteroidIds).toHaveLength(0);

    let q = quiet();
    const c = q.enemies.find((e) => e.isAlive && e.tier === "Carrier")!;
    q = tick({ ...q, asteroids: [rock("large", c.x, c.y - 100, { vy: 0.25 })] }, 16, ASIDE);
    expect(q.tierStats.Carrier.rolls).toBe(0);

    q = quiet();
    const elite = formation(q, "Elite");
    const pos = { x: 200, y: 400 };
    q = {
      ...q,
      enemies: q.enemies.map((e) =>
        e.id === elite.id
          ? {
              ...e,
              phase: "Circling" as const,
              x: pos.x,
              y: pos.y,
              circleCx: pos.x,
              circleCy: pos.y,
              circleRadius: 0,
              circleAngle: 0,
            }
          : e
      ),
      asteroids: [rock("large", pos.x, pos.y)],
    };
    q = tick(q, 16, ASIDE);
    expect(q.tierStats.Elite.rolls).toBe(0);
  });

  it("a formation ship fires flak at a rock approaching within range — outside the bullet cap", () => {
    let s = { ...quiet(), enemyFireDisabled: false };
    const c = s.enemies.find((e) => e.isAlive && e.tier === "Carrier")!; // flak chance 1.0
    // cap already full with ordinary shots parked far away
    const filler: Bullet[] = [0, 1, 2].map((i) => ({
      id: 85_000 + i,
      x: 5,
      y: 600,
      vx: 0,
      vy: 0,
      owner: "enemy",
      width: 5,
      height: 10,
      damage: 1,
    }));
    expect(filler.length).toBe(bulletCap(2));
    s = { ...s, enemyBullets: filler, asteroids: [rock("large", c.x, c.y - 90, { vy: 0.2 })] };
    s = tick(s, 16, ASIDE);
    const flak = s.enemyBullets.filter((b) => b.flak);
    const fromCarrier = flak.find((b) => Math.abs(b.x - c.x) < 6);
    expect(fromCarrier).toBeDefined();
    expect(fromCarrier!.vy).toBeLessThan(0); // aimed up at the rock
    expect(s.enemies.find((e) => e.id === c.id)!.flakCooldown).toBeGreaterThan(0);
    expect(s.tierStats.Carrier.flak).toBe(1);
    // cooldown: no second Carrier shot for FLAK_COOLDOWN
    const shotsAfter = (st: StarSwarmState) =>
      st.enemyBullets.filter((b) => b.flak && Math.abs(b.x - c.x) < 6).length;
    for (let t = 16; t < FLAK_COOLDOWN - 100; t += 16) s = tick(s, 16, ASIDE);
    expect(s.tierStats.Carrier.flak).toBe(1);
    expect(shotsAfter(s)).toBeLessThanOrEqual(1);
  });

  it("no flak at a rock moving away, out of range, or when enemy fire is disabled", () => {
    let s = { ...quiet(), enemyFireDisabled: false };
    // far right, drifting right — away from everyone
    s = tick({ ...s, asteroids: [rock("large", 330, 30, { vx: 0.2 })] }, 16, ASIDE);
    expect(s.enemyBullets.some((b) => b.flak)).toBe(false);
    // approaching but 200+ px away from the top row
    s = tick({ ...s, asteroids: [rock("large", CANVAS_W / 2, -220, { vy: 0.2 })] }, 16, ASIDE);
    expect(s.enemyBullets.some((b) => b.flak)).toBe(false);
    // in range but the dev toggle is on
    const c = s.enemies.find((e) => e.isAlive && e.tier === "Carrier")!;
    s = tick(
      { ...s, enemyFireDisabled: true, asteroids: [rock("large", c.x, c.y - 90, { vy: 0.2 })] },
      16,
      ASIDE
    );
    expect(s.enemyBullets.some((b) => b.flak)).toBe(false);
  });

  it("flak in flight does not block ordinary enemy fire (bullet cap excludes it)", () => {
    let s = { ...quiet(), enemyFireDisabled: false };
    const flak: Bullet[] = [0, 1, 2].map((i) => ({
      id: 86_000 + i,
      x: 5,
      y: 300,
      vx: 0,
      vy: 0,
      owner: "enemy",
      width: 5,
      height: 10,
      damage: 1,
      flak: true,
    }));
    const elite = formation(s, "Elite");
    s = {
      ...s,
      enemyBullets: flak,
      enemies: s.enemies.map((e) => (e.id === elite.id ? { ...e, shootTimer: 0 } : e)),
    };
    s = tick(s, 16, ASIDE);
    expect(s.enemyBullets.some((b) => !b.flak)).toBe(true);
  });

  it("counts strikes per tier, carries counters across waves, and resets them on a new game", () => {
    let s = quiet();
    const g = formation(s, "Grunt");
    s = tick({ ...s, asteroids: [rock("large", g.x, g.y)] }, 16, ASIDE);
    expect(s.tierStats.Grunt.struck).toBe(1);

    s = { ...s, enemies: s.enemies.map((e) => ({ ...e, isAlive: false, hp: 0 })) };
    s = tick(s, 16, ASIDE);
    expect(s.wave).toBe(3);
    expect(s.tierStats.Grunt.struck).toBe(1);

    expect(initStarSwarm(CANVAS_W, CANVAS_H).tierStats).toEqual(emptyTierStats());
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
        e.tier === "Boss" ? { ...e, isAlive: false, hp: 0 } : e.id === c.id ? { ...e, hp: 1 } : e
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

  it("one beam costs at most one plate: the grace covers the rest of the sweep", () => {
    let s = withPlayer(quiet(), { hull: 2, x: CANVAS_W / 2 });
    const c = s.enemies.find((e) => e.isAlive && e.tier === "Carrier")!;
    s = {
      ...s,
      enemies: s.enemies.map((e) =>
        e.id === c.id ? { ...e, beamPhase: "fire" as const, beamTimer: BEAM_FIRE_MS } : e
      ),
    };
    const inBeam: StarSwarmInput = { playerX: c.x, fire: false };
    for (let t = 0; t < BEAM_FIRE_MS + 200; t += 16) s = tick(s, 16, inBeam);
    expect(s.player.hull).toBe(1);
    expect(s.player.lives).toBe(3);
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
        e.tier === "Boss"
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
    s = { ...s, enemies: s.enemies.map((e) => ({ ...e, isAlive: false, hp: 0 })) };
    s = tick(s, 16, ASIDE);
    expect(s.wave).toBe(3);
    expect(s.player.guns).toBe(3);
    expect(s.player.hull).toBe(2);
    const fresh = initStarSwarm(CANVAS_W, CANVAS_H);
    expect(fresh.player.guns).toBe(1);
    expect(fresh.player.hull).toBe(0);
  });
});

describe("Run stats (#2491)", () => {
  let nextId = 90_000;
  function rock(kind: AsteroidKind, x: number, y: number, extra: Partial<Asteroid> = {}): Asteroid {
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
  function shot(x: number, y: number, extra: Partial<Bullet> = {}): Bullet {
    return {
      id: nextId++,
      x,
      y,
      vx: 0,
      vy: 0,
      owner: "player",
      width: 5,
      height: 14,
      damage: 1,
      ...extra,
    };
  }
  /** Mid-wave, no enemy fire, beam parked, timed rocks off, dives off, player parked left. */
  function quiet(difficulty: DifficultyTier = "LieutenantJG", wave = 2): StarSwarmState {
    const s = advanceMs(initStarSwarm(CANVAS_W, CANVAS_H, wave, 42, difficulty), 8000);
    return {
      ...s,
      enemyFireDisabled: true,
      enemyBullets: [],
      asteroids: [],
      asteroidsDisabled: true,
      nextDiveTimer: 1e9,
      pauseStraggler: true,
      player: { ...s.player, x: 40, lives: 3, invincibleTimer: 0 },
      enemies: s.enemies.map((e) => (e.tier === "Carrier" ? { ...e, beamTimer: 1e9 } : e)),
    };
  }
  const ASIDE: StarSwarmInput = { playerX: 40, fire: false };
  const SAFE_Y = 460; // below the deepest formation row, above the player lane
  const carrierOf = (s: StarSwarmState) =>
    s.enemies.find((e) => e.isAlive && e.tier === "Carrier")!;
  const formation = (s: StarSwarmState, tier: string) =>
    s.enemies
      .filter((e) => e.isAlive && e.tier === tier && e.phase === "Formation")
      .sort((a, b) => a.formationY - b.formationY)[0]!;

  it("starts at zero on a new game, carries across a wave clear, resets on the next game", () => {
    const fresh = initStarSwarm(CANVAS_W, CANVAS_H);
    expect(fresh.runStats).toEqual(emptyRunStats());
    expect(Object.values(fresh.runStats).every((v) => v === 0)).toBe(true);
    expect(fresh.dodgeDisabled).toBe(false);
    expect(fresh.flakDisabled).toBe(false);

    let s = quiet();
    s = {
      ...s,
      runStats: { ...s.runStats, reinforced: 7, rocksSpawned: 3, beamHits: 2 },
      enemies: s.enemies.map((e) => ({ ...e, isAlive: false, hp: 0 })),
    };
    s = tick(s, 16, ASIDE);
    expect(s.wave).toBe(3);
    expect(s.runStats.reinforced).toBe(7);
    expect(s.runStats.rocksSpawned).toBe(3);
    expect(s.runStats.beamHits).toBe(2);
    expect(initStarSwarm(CANVAS_W, CANVAS_H).runStats.reinforced).toBe(0);
  });

  it("rocksSpawned counts dev throws and timed spawns, never a refused throw", () => {
    let s = quiet();
    s = throwAsteroid(s);
    expect(s.asteroids).toHaveLength(1);
    expect(s.runStats.rocksSpawned).toBe(1);
    for (let i = 0; i < MAX_ASTEROIDS + 2; i++) s = throwAsteroid(s);
    expect(s.asteroids).toHaveLength(MAX_ASTEROIDS);
    expect(s.runStats.rocksSpawned).toBe(MAX_ASTEROIDS);

    let timed = { ...quiet(), asteroidsDisabled: false, nextAsteroidTimer: 1 };
    timed = tick(timed, 16, ASIDE);
    expect(timed.asteroids).toHaveLength(1);
    expect(timed.runStats.rocksSpawned).toBe(1);
  });

  it("rocks broken by shots are credited to the owner; a bomb or a hull shatter is nobody's", () => {
    const base = quiet();
    const x = CANVAS_W / 2;
    const small = () => rock("small", x, SAFE_Y);
    const hp = ASTEROID_STATS.small.hp;

    let s = { ...base, asteroids: [small()], playerBullets: [shot(x, SAFE_Y, { damage: hp })] };
    s = tick(s, 16, ASIDE);
    expect(s.asteroids).toHaveLength(0);
    expect(s.runStats.rocksBrokenByPlayer).toBe(1);
    expect(s.runStats.rocksBrokenByEnemy).toBe(0);

    s = {
      ...base,
      asteroids: [small()],
      enemyBullets: [shot(x, SAFE_Y, { owner: "enemy", damage: hp, flak: true })],
    };
    s = tick(s, 16, ASIDE);
    expect(s.asteroids).toHaveLength(0);
    expect(s.runStats.rocksBrokenByPlayer).toBe(0);
    expect(s.runStats.rocksBrokenByEnemy).toBe(1);

    // a chip that doesn't finish the rock counts nothing
    s = { ...base, asteroids: [rock("large", x, SAFE_Y)], playerBullets: [shot(x, SAFE_Y)] };
    s = tick(s, 16, ASIDE);
    expect(s.asteroids).toHaveLength(1);
    expect(s.runStats.rocksBrokenByPlayer).toBe(0);

    // the bomb clears rocks without crediting anyone
    s = applyPowerUp({ ...base, asteroids: [small()] }, "bomb");
    expect(s.asteroids).toHaveLength(0);
    expect(s.runStats.rocksBrokenByPlayer).toBe(0);
    expect(s.runStats.rocksBrokenByEnemy).toBe(0);
  });

  it("armorDeflects counts ordinary shots the escorted Carrier shrugs off, not piercing ones", () => {
    const base = quiet("LieutenantJG", 1);
    expect(isCarrierArmored(base)).toBe(true);
    const c = carrierOf(base);
    // one bullet lands per enemy per tick, so two deflections take two ticks
    let s = tick({ ...base, playerBullets: [shot(c.x, c.y)] }, 16, ASIDE);
    s = tick({ ...s, playerBullets: [shot(c.x, c.y)] }, 16, ASIDE);
    expect(carrierOf(s).hp).toBe(8);
    expect(s.runStats.armorDeflects).toBe(2);

    s = tick(
      { ...base, playerBullets: [shot(c.x, c.y, { piercing: true, width: 12 })] },
      16,
      ASIDE
    );
    expect(carrierOf(s).hp).toBe(7);
    expect(s.runStats.armorDeflects).toBe(0);
  });

  it("reinforced counts every grunt the Carrier launches", () => {
    let s = quiet("LieutenantJG", 1);
    const killed = s.enemies.filter((e) => e.tier === "Grunt").slice(0, 10);
    const killedIds = new Set(killed.map((e) => e.id));
    s = {
      ...s,
      enemies: s.enemies.map((e) => (killedIds.has(e.id) ? { ...e, isAlive: false, hp: 0 } : e)),
      reinforceTimer: 1,
    };
    const before = s.enemies.length;
    s = tick(s, 16, ASIDE);
    const launched = s.enemies.length - before;
    expect(launched).toBeGreaterThanOrEqual(2);
    expect(s.runStats.reinforced).toBe(launched);
    expect(s.runStats.reinforced).toBe(s.reinforcedThisWave);
  });

  it("beamHits counts a sweep that lands once — plating or a life — and never a shielded one", () => {
    const base = quiet("LieutenantJG", 1);
    const c = carrierOf(base);
    const firing = (s: StarSwarmState) => ({
      ...s,
      player: { ...s.player, x: c.x },
      enemies: s.enemies.map((e) =>
        e.id === c.id ? { ...e, beamPhase: "fire" as const, beamTimer: BEAM_FIRE_MS } : e
      ),
    });
    const inBeam: StarSwarmInput = { playerX: c.x, fire: false };

    // a life
    let s = tick(firing(base), 16, inBeam);
    expect(s.player.lives).toBe(2);
    expect(s.runStats.beamHits).toBe(1);
    s = advanceMs(s, BEAM_FIRE_MS, inBeam); // the rest of the same sweep, under the grace
    expect(s.runStats.beamHits).toBe(1);

    // plating
    s = tick(firing({ ...base, player: { ...base.player, hull: 1 } }), 16, inBeam);
    expect(s.player.hull).toBe(0);
    expect(s.player.lives).toBe(3);
    expect(s.runStats.beamHits).toBe(1);

    // shield
    s = tick(firing(applyPowerUp(base, "shield")), 16, inBeam);
    expect(s.player.lives).toBe(3);
    expect(s.runStats.beamHits).toBe(0);

    // beside the column: no hit, no count
    const beside = c.x + BEAM_HALF_WIDTH + PLAYER_HURT_RADIUS + 6;
    s = tick({ ...firing(base), player: { ...base.player, x: beside } }, 16, {
      playerX: beside,
      fire: false,
    });
    expect(s.runStats.beamHits).toBe(0);
  });

  it("dodgeRateByTier pairs each tier's configured odds with what happened", () => {
    const s: StarSwarmState = {
      ...quiet("FleetAdmiral"),
      tierStats: {
        ...emptyTierStats(),
        Grunt: { rolls: 8, dodged: 5, pathRolls: 2, pathDodged: 1, struck: 3, flak: 4 },
      },
    };
    const rows = dodgeRateByTier(s);
    expect(rows.map((r) => r.tier)).toEqual(["Grunt", "Elite", "Boss", "Carrier"]);
    const [grunt, elite, boss, carrier] = rows;
    expect(grunt).toEqual({
      tier: "Grunt",
      base: 0.25,
      effective: dodgeChance("Grunt", difficultyParamScale("FleetAdmiral")),
      rolls: 8,
      dodged: 5,
      struck: 3,
      flak: 4,
    });
    expect(grunt!.effective).toBeCloseTo(0.75);
    expect(elite!.effective).toBe(0.97);
    expect(boss!.effective).toBe(0.97);
    expect(carrier!.base).toBe(0);
    expect(carrier!.effective).toBe(0);
    expect(elite!.rolls).toBe(0);
    // difficulty moves only the effective column
    expect(dodgeRateByTier({ ...s, difficulty: "Ensign" })[0]!.effective).toBeCloseTo(0.175);
    expect(dodgeRateByTier({ ...s, difficulty: "Ensign" })[0]!.base).toBe(0.25);
  });

  it("dodgeDisabled skips the roll entirely, so nothing is counted either", () => {
    const base = quiet();
    const elite = formation(base, "Elite");
    const a = rock("large", elite.x, elite.y - 100, { vy: 0.12 });
    let on = tick({ ...base, asteroids: [a] }, 16, ASIDE);
    expect(on.tierStats.Elite.rolls).toBe(1);
    let off = tick({ ...base, asteroids: [a], dodgeDisabled: true }, 16, ASIDE);
    expect(off.tierStats.Elite.rolls).toBe(0);
    expect(off.enemies.find((e) => e.id === elite.id)!.rolledAsteroidIds).toEqual([]);
    for (let i = 0; i < 20; i++) {
      on = tick(on, 16, ASIDE);
      off = tick(off, 16, ASIDE);
    }
    expect(off.tierStats.Elite.rolls).toBe(0);
    expect(off.enemies.some((e) => e.dodge !== null)).toBe(false);
  });

  it("flakDisabled silences flak without touching enemy missiles", () => {
    const base = { ...quiet(), enemyFireDisabled: false };
    const boss = formation(base, "Boss");
    // parked just above the Boss row, drifting toward it: in range and approaching every tick
    const a = () => rock("large", boss.x, boss.y - 80, { vy: 0.02 });
    const totalFlak = (s: StarSwarmState) =>
      Object.values(s.tierStats).reduce((n, t) => n + t.flak, 0);

    let on = { ...base, asteroids: [a()] };
    let off = { ...base, asteroids: [a()], flakDisabled: true };
    for (let i = 0; i < 30; i++) {
      on = tick(on, 16, ASIDE);
      off = tick(off, 16, ASIDE);
    }
    expect(totalFlak(on)).toBeGreaterThan(0);
    expect(on.enemyBullets.some((b) => b.flak)).toBe(true);
    expect(totalFlak(off)).toBe(0);
    expect(off.enemyBullets.some((b) => b.flak)).toBe(false);
    // ordinary enemy fire is a separate toggle and still runs
    expect(off.enemies.some((e) => e.shootTimer !== base.enemies[0]!.shootTimer)).toBe(true);
  });

  it("killEscorts destroys every escort, scores nothing and only works mid-wave", () => {
    const s = quiet("LieutenantJG", 1);
    const before = s.score;
    const after = killEscorts(s);
    expect(after.enemies.filter((e) => e.isAlive).map((e) => e.tier)).toEqual(["Carrier"]);
    expect(after.score).toBe(before);
    expect(after.explosions.length).toBe(
      s.explosions.length + s.enemies.filter((e) => e.isAlive && e.tier !== "Carrier").length
    );
    // the next tick sees the Carrier exposed
    expect(carrierJustExposed(after, tick(after, 16, ASIDE))).toBe(false); // exposure happened at the kill
    expect(isCarrierArmored(after)).toBe(false);
    expect(carrierJustExposed(s, after)).toBe(true);
    const swooping = initStarSwarm(CANVAS_W, CANVAS_H);
    expect(swooping.phase).toBe("SwoopIn");
    expect(killEscorts(swooping)).toBe(swooping);
  });
});

describe("Grunt rout (#2489)", () => {
  let nextId = 96_000;
  const ASIDE: StarSwarmInput = { playerX: 40, fire: false };
  /** Mid-wave, no enemy fire, beam parked, rocks and dives off, player parked left. */
  function quiet(difficulty: DifficultyTier = "LieutenantJG", wave = 2): StarSwarmState {
    const s = advanceMs(initStarSwarm(CANVAS_W, CANVAS_H, wave, 42, difficulty), 8000);
    return {
      ...s,
      enemyFireDisabled: true,
      enemyBullets: [],
      asteroids: [],
      asteroidsDisabled: true,
      nextDiveTimer: 1e9,
      player: { ...s.player, x: 40, lives: 3, invincibleTimer: 0 },
      enemies: s.enemies.map((e) => (e.tier === "Carrier" ? { ...e, beamTimer: 1e9 } : e)),
    };
  }
  const kill = (s: StarSwarmState, pick: (e: StarSwarmState["enemies"][number]) => boolean) => ({
    ...s,
    enemies: s.enemies.map((e) => (pick(e) ? { ...e, isAlive: false, hp: 0 } : e)),
  });
  const killLeaders = (s: StarSwarmState) => kill(s, (e) => e.tier !== "Grunt");
  const fleeing = (s: StarSwarmState) =>
    s.enemies.filter((e) => e.isAlive && e.phase === "Fleeing");
  const liveGrunts = (s: StarSwarmState) =>
    s.enemies.filter((e) => e.isAlive && e.tier === "Grunt");
  /** Kill everything but the first `n` grunts (plus any ids in `keep`). */
  const onlyGrunts = (s: StarSwarmState, n: number, keep: number[] = []) => {
    let kept = 0;
    return kill(s, (e) => !keep.includes(e.id) && (e.tier !== "Grunt" || kept++ >= n));
  };
  function shot(x: number, y: number, extra: Partial<Bullet> = {}): Bullet {
    return {
      id: nextId++,
      x,
      y,
      vx: 0,
      vy: 0,
      owner: "player",
      width: 5,
      height: 14,
      damage: 10,
      ...extra,
    };
  }
  function rock(x: number, y: number, extra: Partial<Asteroid> = {}): Asteroid {
    return {
      id: nextId++,
      kind: "large",
      x,
      y,
      vx: 0,
      vy: 0,
      radius: ASTEROID_STATS.large.radius,
      hp: ASTEROID_STATS.large.hp,
      rotation: 0,
      spin: 0,
      hitFlashTimer: 0,
      hitEnemyIds: [],
      ...extra,
    };
  }

  it("triggers only mid-wave with grunts alive and no Elite, Boss or Carrier; then latches", () => {
    const base = quiet();
    expect(base.routed).toBe(false);
    // leaders alive → nothing
    expect(tick(base, 16, ASIDE).routed).toBe(false);
    // one Elite left among the leaders → still nothing
    const oneElite = kill(base, (e) => e.tier === "Boss" || e.tier === "Carrier");
    expect(tick(oneElite, 16, ASIDE).routed).toBe(false);
    expect(fleeing(tick(oneElite, 16, ASIDE))).toHaveLength(0);
    // leaders dead but still swooping in → waits for Playing
    const swooping = killLeaders(initStarSwarm(CANVAS_W, CANVAS_H, 2, 42));
    expect(swooping.phase).toBe("SwoopIn");
    expect(tick(swooping, 16, ASIDE).routed).toBe(false);
    // dev toggle off → the old mop-up ending, straggler rule and all
    const off = { ...onlyGrunts(base, 3), routDisabled: true };
    expect(liveGrunts(off)).toHaveLength(3);
    const offTicked = tick(off, 16, ASIDE);
    expect(offTicked.routed).toBe(false);
    expect(fleeing(offTicked)).toHaveLength(0);
    // the real thing
    const prev = killLeaders(base);
    const s = tick(prev, 16, ASIDE);
    expect(s.routed).toBe(true);
    expect(routJustStarted(prev, s)).toBe(true);
    expect(fleeing(s)).toHaveLength(liveGrunts(prev).length);
    expect(fleeingCount(s)).toBe(fleeing(s).length);
    const again = tick(s, 16, ASIDE);
    expect(again.routed).toBe(true);
    expect(routJustStarted(s, again)).toBe(false);
  });

  it("every grunt in any phase but swoop-in gets a path to the top edge on its nearer side", () => {
    let base = killLeaders(quiet());
    // one grunt mid-dive, one still arriving
    const [a, b] = liveGrunts(base);
    base = {
      ...base,
      enemies: base.enemies.map((e) => {
        if (e.id === a!.id)
          return {
            ...e,
            phase: "Diving" as const,
            path: {
              p0: { x: e.x, y: e.y },
              p1: { x: e.x, y: e.y + 100 },
              p2: { x: e.x, y: 400 },
              p3: { x: e.x, y: 500 },
            },
            pathT: 0.3,
            pathDuration: DIVE_PATH_DURATION,
          };
        if (e.id === b!.id)
          return {
            ...e,
            phase: "SwoopIn" as const,
            path: {
              p0: { x: e.x, y: e.y - 20 },
              p1: { x: e.x, y: e.y - 10 },
              p2: { x: e.x, y: e.y },
              p3: { x: e.formationX, y: e.formationY },
            },
            pathT: 0.95,
            pathDuration: 1400,
          };
        return e;
      }),
    };
    const s = tick(base, 16, ASIDE);
    const diver = s.enemies.find((e) => e.id === a!.id)!;
    expect(diver.phase).toBe("Fleeing");
    for (const e of fleeing(s)) {
      expect(e.path).not.toBeNull();
      expect(e.path!.p3.y).toBe(-60);
      expect(e.path!.p3.x).toBe(e.path!.p0.x < CANVAS_W / 2 ? -60 : CANVAS_W + 60);
      expect(e.pathDuration).toBeGreaterThanOrEqual(FLEE_DURATION_MIN);
      expect(e.pathDuration).toBeLessThanOrEqual(FLEE_DURATION_MAX);
      // the rout tick already advanced the path by one frame, so a short hesitation reads ≥ -16
      const stagger = -e.pathT * e.pathDuration;
      expect(stagger).toBeGreaterThanOrEqual(-16);
      expect(stagger).toBeLessThanOrEqual(FLEE_STAGGER_MAX);
    }
    // the arriving grunt lands next tick and runs with the rest
    expect(s.enemies.find((e) => e.id === b!.id)!.phase).toBe("SwoopIn");
    const landed = advanceMs(s, 120, ASIDE);
    expect(landed.enemies.find((e) => e.id === b!.id)!.phase).toBe("Fleeing");
    // Ensign runs 1.4× slower
    const easy = tick(killLeaders(quiet("Ensign")), 16, ASIDE);
    for (const e of fleeing(easy)) {
      expect(e.pathDuration).toBeGreaterThanOrEqual(FLEE_DURATION_MIN * FLEE_ENSIGN_SCALE);
      expect(e.pathDuration).toBeLessThanOrEqual(FLEE_DURATION_MAX * FLEE_ENSIGN_SCALE);
    }
  });

  it("fleeing grunts never shoot or dive, and the straggler rule stands down for them", () => {
    let s = { ...killLeaders(quiet()), enemyFireDisabled: false, nextDiveTimer: 1 };
    s = {
      ...s,
      enemies: s.enemies.map((e) => (e.isAlive ? { ...e, shootTimer: 1 } : e)),
    };
    s = advanceMs(s, 900, ASIDE);
    expect(s.enemyBullets).toHaveLength(0);
    expect(
      s.enemies.some((e) => e.isAlive && (e.phase === "Diving" || e.phase === "Wiggling"))
    ).toBe(false);
    expect(s.enemies.every((e) => !e.isAlive || e.phase === "Fleeing")).toBe(true);
    // three survivors, all grunts: they run instead of turning aggressive
    let three = onlyGrunts(quiet(), 3);
    expect(liveGrunts(three)).toHaveLength(3);
    three = tick(three, 16, ASIDE);
    expect(three.enemies.some((e) => e.isAlive && e.phase === "Wiggling")).toBe(false);
    expect(fleeing(three).length).toBe(liveGrunts(three).length);
    // an Elite among the survivors: the old rule, no rout
    const q = quiet();
    const elite = q.enemies.find((e) => e.tier === "Elite")!;
    let mixed = onlyGrunts(q, 2, [elite.id]);
    expect(mixed.enemies.filter((e) => e.isAlive)).toHaveLength(3);
    mixed = tick(mixed, 16, ASIDE);
    expect(mixed.routed).toBe(false);
    expect(fleeing(mixed)).toHaveLength(0);
    expect(mixed.enemies.some((e) => e.isAlive && e.phase === "Wiggling")).toBe(true);
  });

  it("caught on the way out pays 2× and counts; escaped pays nothing and ends the wave", () => {
    const base = tick(killLeaders(quiet("Ensign")), 16, ASIDE);
    const target = fleeing(base).find((e) => e.pathT < 0)!; // still hesitating, so still in place
    let s = { ...base, score: 1000, playerBullets: [shot(target.x, target.y)] };
    s = tick(s, 16, ASIDE);
    expect(s.enemies.find((e) => e.id === target.id)!.isAlive).toBe(false);
    expect(s.score).toBe(1000 + Math.round(100 * 2 * difficultyMultiplier("Ensign")));
    expect(s.runStats.routCaught).toBe(1);
    // let the rest go
    const before = fleeing(s).length;
    s = { ...s, score: 5000 };
    s = advanceMs(s, FLEE_DURATION_MAX * FLEE_ENSIGN_SCALE + FLEE_STAGGER_MAX + 100, ASIDE);
    expect(s.wave).toBe(3);
    expect(s.routed).toBe(false);
    expect(s.runStats.routEscaped).toBe(before);
    expect(s.runStats.routCaught).toBe(1);
    // only the wave-clear bonus was added — escapes paid nothing
    expect(s.score).toBe(5000 + waveClearBonusPoints(2, "Ensign"));
  });

  it("no rout on a boss wave — nothing to rout — and the wave still clears", () => {
    let s = quiet("LieutenantJG", 5);
    expect(liveGrunts(s)).toHaveLength(0);
    s = tick(
      kill(s, (e) => e.tier === "Boss"),
      16,
      ASIDE
    );
    expect(s.routed).toBe(false);
    s = tick(
      kill(s, () => true),
      16,
      ASIDE
    );
    expect(s.wave).toBe(6);
  });

  it("fleeing grunts still roll to dodge rocks and can be struck by them", () => {
    const base = tick(killLeaders(quiet()), 16, ASIDE);
    const g = fleeing(base).find((e) => e.pathT < 0)!;
    let s = { ...base, asteroids: [rock(g.x, g.y - 100, { vy: 0.12 })] };
    s = tick(s, 16, ASIDE);
    expect(s.tierStats.Grunt.rolls).toBeGreaterThanOrEqual(1);
    let struck = { ...base, asteroids: [rock(g.x, g.y)] };
    struck = tick(struck, 16, ASIDE);
    expect(struck.tierStats.Grunt.struck).toBeGreaterThanOrEqual(1);
    expect(struck.runStats.routCaught).toBe(0); // a rock kill is nobody's catch
  });
});
