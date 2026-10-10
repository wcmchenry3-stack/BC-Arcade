/**
 * Star Swarm engine tests: initStarSwarm, the tick pipeline's player step, wave progression, boss
 * waves and bonus lives.
 *
 * One file per planned `engine/` module (#2988): this file follows `engine/wave.ts`. Split out of
 * the former monolithic `engine.test.ts` (#2955) with describe blocks moved whole; shared fixtures
 * live in `helpers/engineFixtures.ts`.
 */
import {
  initStarSwarm,
  tick,
  seedRng,
  _resetIds,
  CANVAS_W,
  CANVAS_H,
  applyPowerUp,
  difficultyMultiplier,
  PLAYER_W,
  MAX_PLAYER_BULLETS,
  MISSION_COMPLETE_BANNER_MS,
  throwAsteroid,
  ASTEROID_STATS,
  carrierCadenceBounds,
  isBossWave,
  waveClearBonusPoints,
  WAVE_CLEAR_BONUS_BASE,
  BOSS_WAVE_CLEAR_MULT,
  BOSS_WAVE_BEAM_SCALE,
} from "../engine";
import type { Asteroid, Bullet, DifficultyTier, StarSwarmInput, StarSwarmState } from "../types";
import {
  NO_INPUT,
  FIRE_INPUT,
  advanceMs,
  runExtraction,
  clearWave,
} from "./helpers/engineFixtures";

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

  // #2842: after the extraction the next wave puts the ship back on station, centred.
  it("player.x stays within valid bounds immediately after a wave clear", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H, 1);
    // Drive ship to right edge for the duration of the wave
    const rightEdgeInput: StarSwarmInput = { playerX: CANVAS_W - hw, fire: false };
    s = advanceMs(s, 8000, rightEdgeInput);
    s = clearWave(s, rightEdgeInput);
    expect(s.wave).toBe(2);
    expect(s.phase).toBe("SwoopIn");
    expect(s.player.x).toBe(CANVAS_W / 2);
    expect(s.player.x).toBeGreaterThanOrEqual(hw);
    expect(s.player.x).toBeLessThanOrEqual(CANVAS_W - hw);
  });

  it("using the engine's own player.x as input is a no-op right after a wave clear", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H, 1);
    s = advanceMs(s, 8000);
    s = clearWave(s);
    expect(s.wave).toBe(2);
    // Using the engine's own player.x as the input must be a no-op
    const parkedX = s.player.x;
    s = tick(s, 16, { playerX: parkedX, fire: false });
    expect(s.player.x).toBe(parkedX);
  });
});

// ---------------------------------------------------------------------------
// Wave progression
// ---------------------------------------------------------------------------

describe("Wave progression", () => {
  it("the last kill starts the extraction; the next wave opens once the ship is out (#2842)", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H, 1);
    s = advanceMs(s, 8000);
    s = { ...s, enemies: s.enemies.map((e) => ({ ...e, isAlive: false, hp: 0 })) };
    s = tick(s, 16, NO_INPUT);
    expect(s.phase).toBe("Extraction");
    expect(s.wave).toBe(1);
    expect(s.extraction).toEqual({ elapsedMs: 0, climbMs: 0 });
    s = runExtraction(s);
    expect(s.wave).toBe(2);
    expect(s.phase).toBe("SwoopIn");
    expect(s.extraction).toBeNull();
  });

  it("clearing wave 4 leads into the wave-5 boss wave (#2490)", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H, 4);
    s = advanceMs(s, 8000);
    s = clearWave(s);
    expect(s.wave).toBe(5);
    expect(s.phase).toBe("SwoopIn");
    expect(s.enemies.every((e) => e.tier === "Guardian" || e.tier === "Carrier")).toBe(true);
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
// Boss wave (#2490)
// ---------------------------------------------------------------------------

describe("Boss wave (#2490)", () => {
  const ASIDE: StarSwarmInput = { playerX: 40, fire: false };
  /** A boss wave settled into formation: no enemy fire, beam parked, rocks off, player parked
   * left — all applied before the swoop-in so four active Guardians can't end the game first. */
  function settled(
    difficulty: DifficultyTier = "LieutenantJG",
    wave = 5,
    diveTimer?: number
  ): StarSwarmState {
    const init = initStarSwarm(CANVAS_W, CANVAS_H, wave, 42, difficulty);
    const s = advanceMs(
      {
        ...init,
        enemyFireDisabled: true,
        asteroidsDisabled: true,
        ...(diveTimer === undefined ? {} : { nextDiveTimer: diveTimer }),
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
    expect(s.enemies.map((e) => e.tier)).toEqual([
      "Guardian",
      "Guardian",
      "Guardian",
      "Guardian",
      "Carrier",
    ]);
    expect(s.startingNonLeaderCount).toBe(0);
    const normal = initStarSwarm(CANVAS_W, CANVAS_H, 4);
    expect(normal.enemies.some((e) => e.tier === "Grunt")).toBe(true);
    expect(normal.enemies.some((e) => e.tier === "Elite")).toBe(true);
  });

  it("the Guardians are active from the first tick: threshold latched, dives on the normal timer, bursts", () => {
    expect(initStarSwarm(CANVAS_W, CANVAS_H, 5).guardianThresholdCrossed).toBe(true);
    expect(initStarSwarm(CANVAS_W, CANVAS_H, 4).guardianThresholdCrossed).toBe(false);
    // a dive trigger sends a Guardian out of formation straight away
    let s = { ...settled(), nextDiveTimer: 1 };
    s = tick(s, 16, ASIDE);
    expect(s.enemies.some((e) => e.tier === "Guardian" && e.phase !== "Formation")).toBe(true);
    // and a Guardian whose shot timer is up fires its burst without waiting for anything
    // (#3139: with all four Guardians now free to dive, the settle phase can leave every one of
    // them out of formation — park the dive timer so the Guardians are still home to fire)
    let firing = { ...settled("LieutenantJG", 5, 1e9), enemyFireDisabled: false };
    firing = {
      ...firing,
      enemies: firing.enemies.map((e) => (e.tier === "Guardian" ? { ...e, shootTimer: 1 } : e)),
    };
    firing = tick(firing, 16, ASIDE);
    expect(firing.enemyBullets.length).toBeGreaterThan(0);
  });

  it("the Carrier beams 1.5× as often on a boss wave, from the first beam on", () => {
    // #2843: the beam cadence is a seeded range per stage; a boss wave divides it by 1.5
    for (const stage of ["protected", "exposed", "finalStand"] as const) {
      const normal = carrierCadenceBounds("beam", stage, "LieutenantJG", false)!;
      const boss = carrierCadenceBounds("beam", stage, "LieutenantJG", true)!;
      expect(boss.max).toBeCloseTo(Math.max(1500, normal.max / BOSS_WAVE_BEAM_SCALE), 5);
      expect(boss.min).toBeCloseTo(Math.max(1500, normal.min / BOSS_WAVE_BEAM_SCALE), 5);
    }
    // the first beam is rolled from those bounds
    const first = carrierOf(initStarSwarm(CANVAS_W, CANVAS_H, 5)).beamTimer;
    const b = carrierCadenceBounds("beam", "protected", "LieutenantJG", true)!;
    expect(first).toBeGreaterThanOrEqual(b.min);
    expect(first).toBeLessThanOrEqual(b.max);
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
    expect(s.phase).toBe("Extraction");
    expect(s.score).toBe(1000 + waveClearBonusPoints(5, "Commander"));
    expect(s.missionCompleteTimer).toBe(MISSION_COMPLETE_BANNER_MS);
    s = runExtraction(s, ASIDE);
    expect(s.wave).toBe(6);
    expect(s.score).toBe(1000 + waveClearBonusPoints(5, "Commander"));
    // an ordinary wave is unchanged
    let n = { ...settled("Commander", 4), score: 1000 };
    n = { ...n, enemies: n.enemies.map((e) => ({ ...e, isAlive: false, hp: 0 })) };
    n = tick(n, 16, ASIDE);
    expect(n.score).toBe(
      1000 + Math.round(4 * WAVE_CLEAR_BONUS_BASE * difficultyMultiplier("Commander"))
    );
  });

  it("no timed rocks on a boss wave; a dev throw still works, nothing carries in (#2842)", () => {
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
    prev = runExtraction(tick(prev, 16, ASIDE), ASIDE);
    expect(prev.wave).toBe(5);
    expect(prev.asteroids).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Player firing
// ---------------------------------------------------------------------------

describe("Player firing", () => {
  // #2842: the guns are live only in combat (see the wave-entry gating tests)
  const playingNow = (): StarSwarmState => ({
    ...initStarSwarm(CANVAS_W, CANVAS_H),
    phase: "Playing",
  });

  it("fire=true creates a player bullet", () => {
    let s = playingNow();
    s = tick(s, 16, FIRE_INPUT);
    expect(s.playerBullets).toHaveLength(1);
    expect(s.playerBullets[0]?.owner).toBe("player");
  });

  it("shoot cooldown prevents rapid-fire", () => {
    let s = playingNow();
    s = tick(s, 16, FIRE_INPUT);
    s = tick(s, 16, FIRE_INPUT);
    // Second tick should not add another bullet while cooldown is active
    expect(s.playerBullets.length).toBeLessThanOrEqual(2);
    expect(s.player.shootCooldown).toBeGreaterThan(0);
  });

  it("player bullet moves upward", () => {
    let s = playingNow();
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
  // spread burst (3-4 bullets) could push playerBullets past MAX_PLAYER_BULLETS.
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

describe("#2963 the tick keeps what did not change", () => {
  it("a swoop-in tick with nothing in flight hands back the same lists and stats", () => {
    const s0 = initStarSwarm(CANVAS_W, CANVAS_H, 1, 42);
    expect(s0.phase).toBe("SwoopIn");
    const s1 = tick(s0, 16, FIRE_INPUT); // no fire during swoop-in (#2842)
    expect(s1).not.toBe(s0);
    expect(s1.enemies).not.toBe(s0.enemies); // the swoop moved them
    for (const k of [
      "playerBullets",
      "enemyBullets",
      "explosions",
      "powerUps",
      "asteroids",
      "carrierBeams",
      "buddyShips",
      "tierStats",
      "runStats",
    ] as const) {
      expect(s1[k]).toBe(s0[k]);
    }
  });

  it("anything in flight is moved into a new list, and only that list", () => {
    const s0 = initStarSwarm(CANVAS_W, CANVAS_H, 1, 42);
    const shot: Bullet = {
      id: 9_001,
      x: 100,
      y: 300,
      vx: 0,
      vy: -0.5,
      owner: "player",
      width: 4,
      height: 10,
      damage: 1,
    };
    const boom = { id: 9_002, x: 5, y: 5, frame: 0, frameTimer: 999 };
    const s = { ...s0, playerBullets: [shot], explosions: [boom] };
    const s1 = tick(s, 16, NO_INPUT);
    expect(s1.playerBullets).not.toBe(s.playerBullets);
    expect(s1.playerBullets[0]!.y).toBeCloseTo(300 - 0.5 * 16);
    expect(s1.explosions).not.toBe(s.explosions);
    expect(s1.explosions[0]!.frameTimer).toBe(999 - 16);
    expect(s1.enemyBullets).toBe(s.enemyBullets);
    expect(s1.powerUps).toBe(s.powerUps);
    // and a shot that leaves the screen is dropped
    const gone = tick({ ...s, playerBullets: [{ ...shot, y: -20 }] }, 16, NO_INPUT);
    expect(gone.playerBullets).toEqual([]);
  });
});
