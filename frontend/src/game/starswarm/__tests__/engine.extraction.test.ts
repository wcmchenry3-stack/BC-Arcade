/**
 * Star Swarm engine tests: the #2842 wave lifecycle (safe entry, live extraction, projectile
 * persistence, hard reset) and the #2352 non-blocking clear.
 *
 * One file per planned `engine/` module (#2988): this file follows `engine/extraction.ts`. Split
 * out of the former monolithic `engine.test.ts` (#2955) with describe blocks moved whole; shared
 * fixtures live in `helpers/engineFixtures.ts`.
 */
import {
  initStarSwarm,
  tick,
  seedRng,
  _resetIds,
  CANVAS_W,
  CANVAS_H,
  applyPowerUp,
  BULLET_E_VY,
  MISSION_COMPLETE_BANNER_MS,
  throwAsteroid,
  ASTEROID_STATS,
  BEAM_HALF_WIDTH,
  BEAM_SPEED,
  carrierBeamCharge,
  waveClearBonusPoints,
  EXTRACTION_HOLD_MIN_MS,
  EXTRACTION_HOLD_MAX_MS,
  EXTRACTION_MAX_MS,
  clearTransientCombat,
  weaponsFree,
  hazardsLive,
  isAutopilot,
  waveJustCleared,
  liveHazards,
} from "../engine";
import type { Asteroid, Bullet, StarSwarmState } from "../types";
import { NO_INPUT, FIRE_INPUT, advanceMs, runExtraction, makeBeam } from "./helpers/engineFixtures";

beforeEach(() => {
  seedRng(42);
  _resetIds();
});

// ---------------------------------------------------------------------------
// #2842 — wave lifecycle: safe entry, live extraction, projectile persistence, hard reset
// ---------------------------------------------------------------------------

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

function makeRock(overrides: Partial<Asteroid> = {}): Asteroid {
  return {
    id: 66666,
    kind: "large",
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    radius: ASTEROID_STATS.large.radius,
    hp: ASTEROID_STATS.large.hp,
    rotation: 0,
    spin: 0,
    hitFlashTimer: 0,
    hitEnemyIds: [],
    ...overrides,
  };
}

/** A wave in combat with nobody shooting on their own (so tests place every shot). */
function quietPlaying(wave = 1): StarSwarmState {
  let s = initStarSwarm(CANVAS_W, CANVAS_H, wave);
  s = { ...s, enemyFireDisabled: true, asteroidsDisabled: true, flakDisabled: true };
  s = advanceMs(s, 8000);
  expect(s.phase).toBe("Playing");
  return { ...s, enemyFireDisabled: false, player: { ...s.player, invincibleTimer: 0 } };
}

/** The first tick of a wave's extraction, with `extra` in flight as the last enemy dies. */
function enterExtraction(extra: Partial<StarSwarmState> = {}): StarSwarmState {
  const s = quietPlaying();
  const killed = { ...s, enemies: s.enemies.map((e) => ({ ...e, isAlive: false, hp: 0 })) };
  const next = tick({ ...killed, ...extra }, 16, NO_INPUT);
  expect(next.phase).toBe("Extraction");
  return { ...next, player: { ...next.player, invincibleTimer: 0 } };
}

/** A wave still swooping in, with one ship already arrived in formation. */
function swoopingWithOneArrived(): { s: StarSwarmState; arrivedId: number } {
  let s = initStarSwarm(CANVAS_W, CANVAS_H, 3);
  s = advanceMs(s, 400);
  expect(s.phase).toBe("SwoopIn");
  const e0 = s.enemies.find((e) => e.tier === "Grunt")!;
  const arrived = {
    ...e0,
    phase: "Formation" as const,
    x: e0.formationX,
    y: e0.formationY,
    path: null,
    pathT: 1,
    shootTimer: 0,
  };
  s = { ...s, enemies: s.enemies.map((e) => (e.id === e0.id ? arrived : e)) };
  return { s, arrivedId: e0.id };
}

// ---------------------------------------------------------------------------
// #2352 — wave clear never freezes gameplay; a short cosmetic banner timer marks the moment.
// (#2842 hands the ship to an extraction autopilot, but nothing stops moving.)
// ---------------------------------------------------------------------------

describe("#2352 non-blocking wave clear", () => {
  it("sets missionCompleteTimer to the full banner duration on the last kill", () => {
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

  it("nothing freezes for a clear — the ship flies out, then the new wave animates at once", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H, 1);
    s = advanceMs(s, 8000);
    const bullet = {
      id: 77777,
      x: 40,
      y: 300,
      vx: 0,
      vy: -0.6,
      owner: "player" as const,
      width: 3,
      height: 10,
      damage: 1,
    };
    s = {
      ...s,
      playerBullets: [bullet],
      enemies: s.enemies.map((e) => ({ ...e, isAlive: false, hp: 0 })),
    };
    s = tick(s, 16, NO_INPUT);
    expect(s.phase).toBe("Extraction");
    const y0 = s.playerBullets[0]!.y;
    s = tick(s, 16, NO_INPUT);
    expect(s.playerBullets[0]!.y).toBeLessThan(y0); // shots keep flying
    const shipY = s.player.y;
    s = advanceMs(s, EXTRACTION_HOLD_MIN_MS + 200);
    expect(s.player.y).toBeLessThan(shipY); // the ship is climbing out
    s = runExtraction(s);
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

describe("#2842 wave entry: swoop-in is safe setup time", () => {
  it("the central gates: weapons free only in combat, hazards live in combat and extraction", () => {
    const base = initStarSwarm(CANVAS_W, CANVAS_H);
    const at = (phase: StarSwarmState["phase"]) => ({ ...base, phase });
    expect(weaponsFree(at("SwoopIn"))).toBe(false);
    expect(weaponsFree(at("Playing"))).toBe(true);
    expect(weaponsFree(at("Extraction"))).toBe(false);
    expect(hazardsLive(at("SwoopIn"))).toBe(false);
    expect(hazardsLive(at("Playing"))).toBe(true);
    expect(hazardsLive(at("Extraction"))).toBe(true);
    expect(isAutopilot(at("Extraction"))).toBe(true);
    expect(isAutopilot(at("Playing"))).toBe(false);
  });

  it("the player cannot fire during swoop-in, and can the moment combat starts", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H);
    s = { ...s, enemyFireDisabled: true };
    while (s.phase === "SwoopIn") {
      s = tick(s, 16, FIRE_INPUT);
      if (s.phase === "SwoopIn") expect(s.playerBullets).toHaveLength(0);
    }
    s = tick(s, 16, FIRE_INPUT);
    expect(s.phase).toBe("Playing");
    expect(s.playerBullets.length).toBeGreaterThan(0);
  });

  it("an enemy already in formation holds its fire until combat starts", () => {
    const { s, arrivedId } = swoopingWithOneArrived();
    const next = tick(s, 16, NO_INPUT);
    expect(next.phase).toBe("SwoopIn");
    expect(next.enemyBullets).toHaveLength(0);
    // the same ship, same timer, in combat: it fires
    const playing = tick({ ...s, phase: "Playing" }, 16, NO_INPUT);
    expect(playing.enemies.find((e) => e.id === arrivedId)).toBeDefined();
    expect(playing.enemyBullets.length).toBeGreaterThan(0);
  });

  it("the player is invulnerable to shots and rocks during swoop-in", () => {
    let { s } = swoopingWithOneArrived();
    s = {
      ...s,
      player: { ...s.player, invincibleTimer: 0 },
      enemyBullets: [makeEnemyBullet({ x: s.player.x, y: s.player.y, vy: 0, width: 40 })],
      asteroids: [makeRock({ x: s.player.x, y: s.player.y })],
    };
    const next = tick(s, 16, NO_INPUT);
    expect(next.phase).not.toBe("GameOver");
    expect(next.player.lives).toBe(s.player.lives);
    expect(next.player.hull).toBe(s.player.hull);
  });

  it("no incoming enemy can be pre-damaged — shots and rocks do nothing to it", () => {
    const setup = swoopingWithOneArrived();
    const { arrivedId } = setup;
    let s = setup.s;
    const target = s.enemies.find((e) => e.id === arrivedId)!;
    s = {
      ...s,
      playerBullets: [
        makePlayerBullet({ x: target.x, y: target.y, vy: 0, width: 60, height: 60, damage: 9 }),
      ],
      asteroids: [makeRock({ x: target.x, y: target.y })],
    };
    const next = tick(s, 16, NO_INPUT);
    const after = next.enemies.find((e) => e.id === arrivedId)!;
    expect(after.isAlive).toBe(true);
    expect(after.hp).toBe(target.hp);
    expect(next.score).toBe(s.score);
  });

  it("no asteroid can spawn during swoop-in — timed or thrown", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H, 3);
    s = { ...s, nextAsteroidTimer: 1 };
    expect(throwAsteroid(s)).toBe(s);
    s = advanceMs(s, 500);
    expect(s.phase).toBe("SwoopIn");
    expect(s.asteroids).toHaveLength(0);
    expect(s.runStats.rocksSpawned).toBe(0);
  });

  it("the Carrier's beam cannot charge during swoop-in", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H, 3);
    s = {
      ...s,
      enemies: s.enemies.map((e) =>
        e.tier === "Carrier"
          ? { ...e, phase: "Formation" as const, path: null, pathT: 1, beamTimer: 1 }
          : e
      ),
    };
    s = advanceMs(s, 300);
    expect(s.phase).toBe("SwoopIn");
    expect(carrierBeamCharge(s)).toBeNull();
    expect(s.carrierBeams).toEqual([]);
  });

  it("combat starts only once every ship has arrived", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H);
    while (s.phase === "SwoopIn") {
      expect(s.enemies.some((e) => e.isAlive && e.phase === "SwoopIn")).toBe(true);
      s = tick(s, 16, NO_INPUT);
    }
    expect(s.phase).toBe("Playing");
    expect(s.enemies.every((e) => !e.isAlive || e.phase !== "SwoopIn")).toBe(true);
  });
});

describe("#2842 wave clear: live extraction", () => {
  it("fires waveJustCleared on the last kill, once", () => {
    const s = quietPlaying();
    const killed = { ...s, enemies: s.enemies.map((e) => ({ ...e, isAlive: false, hp: 0 })) };
    const next = tick(killed, 16, NO_INPUT);
    expect(waveJustCleared(s, next)).toBe(true);
    expect(waveJustCleared(next, tick(next, 16, NO_INPUT))).toBe(false);
  });

  it("awards the wave-clear bonus once, on the last kill", () => {
    const s = quietPlaying();
    const killed = { ...s, enemies: s.enemies.map((e) => ({ ...e, isAlive: false, hp: 0 })) };
    const bonus = waveClearBonusPoints(1, s.difficulty);
    const next = tick(killed, 16, NO_INPUT);
    expect(next.score).toBe(s.score + bonus);
    expect(runExtraction(next).score).toBe(s.score + bonus);
  });

  it("stops manual fire after the last kill", () => {
    let s = enterExtraction();
    s = { ...s, player: { ...s.player, shootCooldown: 0 } };
    s = advanceMs(s, 500, FIRE_INPUT);
    expect(s.phase).toBe("Extraction");
    expect(s.playerBullets).toHaveLength(0);
  });

  it("the AI has the ship — input is ignored", () => {
    let s = enterExtraction();
    const x0 = s.player.x;
    s = advanceMs(s, 200, { playerX: 0, fire: true });
    expect(s.player.x).toBe(x0); // nothing to dodge, so it holds its lane
  });

  it("already-fired player shots keep flying through the extraction", () => {
    let s = enterExtraction({ playerBullets: [makePlayerBullet({ x: 40, y: 400 })] });
    expect(s.playerBullets.map((b) => b.id)).toEqual([77777]);
    const y0 = s.playerBullets[0]!.y;
    s = advanceMs(s, 200);
    expect(s.playerBullets[0]!.y).toBeLessThan(y0);
  });

  it("already-fired enemy shots stay harmful during the extraction", () => {
    let s = enterExtraction();
    const lives = s.player.lives;
    // too wide to sidestep in one tick
    s = {
      ...s,
      enemyBullets: [makeEnemyBullet({ x: s.player.x, y: s.player.y, vy: 0, width: 60 })],
    };
    s = tick(s, 16, NO_INPUT);
    expect(s.player.lives).toBe(lives - 1);
  });

  it("rocks stay harmful during the extraction", () => {
    let s = enterExtraction();
    const lives = s.player.lives;
    s = { ...s, asteroids: [makeRock({ x: s.player.x, y: s.player.y })] };
    s = tick(s, 16, NO_INPUT);
    expect(s.player.lives).toBe(lives - 1);
  });

  it("a shield still absorbs a hit during the extraction", () => {
    let s = enterExtraction();
    s = {
      ...s,
      activePowerUp: { type: "shield", remainingMs: 3000, shieldAbsorbed: 0 },
      enemyBullets: [makeEnemyBullet({ x: s.player.x, y: s.player.y, vy: 0, width: 60 })],
    };
    const lives = s.player.lives;
    s = tick(s, 16, NO_INPUT);
    expect(s.player.lives).toBe(lives);
    expect(s.activePowerUp?.shieldAbsorbed).toBe(1);
  });

  it("no new rocks enter during the extraction", () => {
    let s = enterExtraction();
    s = { ...s, asteroidsDisabled: false, nextAsteroidTimer: 1, wave: 3 };
    expect(throwAsteroid(s)).toBe(s);
    s = advanceMs(s, 300);
    expect(s.asteroids).toHaveLength(0);
  });

  it("the autopilot sidesteps a column of shots coming straight at it", () => {
    let s = enterExtraction();
    const x0 = s.player.x;
    const lives = s.player.lives;
    s = {
      ...s,
      enemyBullets: [150, 200, 250].map((dy, i) =>
        makeEnemyBullet({ id: 91000 + i, x: x0, y: s.player.y - dy })
      ),
    };
    s = advanceMs(s, 1200);
    expect(s.player.lives).toBe(lives);
    expect(s.player.x).not.toBe(x0);
  });

  it("the autopilot steers around a rock on a collision course", () => {
    let s = enterExtraction();
    const { x, y } = s.player;
    const lives = s.player.lives;
    s = { ...s, asteroids: [makeRock({ x: x - 100, y: y - 100, vx: 0.14, vy: 0.14 })] };
    s = advanceMs(s, 1500);
    expect(s.player.lives).toBe(lives);
    expect(s.asteroids.length).toBeGreaterThan(0); // not shattered on the hull
  });

  it("holds the lane at least EXTRACTION_HOLD_MIN_MS, and climbs by EXTRACTION_HOLD_MAX_MS", () => {
    let s = enterExtraction();
    // a stationary shot high above keeps threatening the climb path
    s = { ...s, enemyBullets: [makeEnemyBullet({ x: 20, y: 60, vy: 0 })] };
    const laneY = s.player.y;
    s = advanceMs(s, EXTRACTION_HOLD_MIN_MS - 50);
    expect(s.extraction?.climbMs).toBe(0);
    expect(s.player.y).toBe(laneY);
    s = advanceMs(s, EXTRACTION_HOLD_MAX_MS - EXTRACTION_HOLD_MIN_MS + 100);
    expect(s.extraction!.climbMs).toBeGreaterThan(0);
    expect(s.player.y).toBeLessThan(laneY);
  });

  it("climbs out as soon as the hold minimum passes when nothing can reach it", () => {
    let s = enterExtraction();
    s = advanceMs(s, EXTRACTION_HOLD_MIN_MS + 50);
    expect(s.extraction!.climbMs).toBeGreaterThan(0);
  });

  it("leaves the playfield off the top before the next wave opens", () => {
    let s = enterExtraction();
    let last = s;
    while (s.wave === 1) {
      last = s;
      s = tick(s, 16, NO_INPUT);
    }
    expect(last.phase).toBe("Extraction");
    expect(last.player.y).toBeLessThan(0);
    expect(last.extraction!.elapsedMs).toBeLessThan(EXTRACTION_MAX_MS);
  });

  it("the extraction never runs past EXTRACTION_MAX_MS", () => {
    let s = enterExtraction();
    s = { ...s, extraction: { elapsedMs: EXTRACTION_MAX_MS - 10, climbMs: 0 } };
    s = tick(s, 16, NO_INPUT);
    expect(s.wave).toBe(2);
    expect(s.phase).toBe("SwoopIn");
  });

  it("a bonus-life rescue mid-extraction stays in the extraction", () => {
    let s = enterExtraction();
    s = {
      ...s,
      score: 1_000_000,
      bonusLivesAwarded: 0,
      player: { ...s.player, lives: 1, hull: 0 },
      enemyBullets: [makeEnemyBullet({ x: s.player.x, y: s.player.y, vy: 0, width: 60 })],
    };
    s = tick(s, 16, NO_INPUT);
    expect(s.player.lives).toBeGreaterThan(0);
    expect(s.phase).toBe("Extraction");
    expect(s.wave).toBe(1);
  });

  it("replays identically under the same seed", () => {
    const run = () => {
      seedRng(42);
      _resetIds();
      let s = enterExtraction({
        enemyBullets: [0, 1, 2, 3].map((i) =>
          makeEnemyBullet({ id: 92000 + i, x: 120 + i * 40, y: 200 + i * 30 })
        ),
      });
      const xs: number[] = [];
      while (s.wave === 1) {
        s = tick(s, 16, NO_INPUT);
        xs.push(s.player.x);
      }
      return xs;
    };
    expect(run()).toEqual(run());
  });
});

describe("#2842 projectile persistence: shots outlive their source", () => {
  it("a shot survives the death of the ship that fired it, and still hits", () => {
    let s = quietPlaying();
    const shooter = s.enemies.find((e) => e.isAlive && e.phase === "Formation")!;
    const lives = s.player.lives;
    // its shot is in flight above the player; then the shooter is shot down
    s = {
      ...s,
      enemyBullets: [makeEnemyBullet({ x: s.player.x, y: s.player.y - 60 })],
      playerBullets: [
        makePlayerBullet({ x: shooter.x, y: shooter.y, vy: 0, width: 40, damage: 99 }),
      ],
    };
    s = tick(s, 16, NO_INPUT);
    expect(s.enemies.find((e) => e.id === shooter.id)!.isAlive).toBe(false);
    expect(s.enemyBullets.map((b) => b.id)).toEqual([88888]);
    s = advanceMs(s, 400, { playerX: s.player.x, fire: false });
    expect(s.player.lives).toBe(lives - 1);
  });

  it("the wave's last kill does not retract anything in flight", () => {
    const s = enterExtraction({
      enemyBullets: [makeEnemyBullet({ x: 30, y: 100 })],
      playerBullets: [makePlayerBullet({ x: 330, y: 300 })],
      asteroids: [makeRock({ x: 200, y: 150, vx: 0.1, vy: 0.1 })],
    });
    expect(s.enemyBullets.map((b) => b.id)).toEqual([88888]);
    expect(s.playerBullets.map((b) => b.id)).toEqual([77777]);
    expect(s.asteroids.map((a) => a.id)).toEqual([66666]);
  });
});

describe("#2842 hard reset before the next wave", () => {
  it("clearTransientCombat empties every transient combat entity", () => {
    let s = quietPlaying(3);
    s = applyPowerUp(s, "buddy");
    s = {
      ...s,
      enemyBullets: [
        makeEnemyBullet({ x: 30, y: 100 }),
        makeEnemyBullet({ id: 2, flak: true }),
        makeEnemyBullet({ id: 3, x: 60, y: 200, target: "buddy" }), // #2845: a shot at Buddy
      ],
      playerBullets: [
        makePlayerBullet({ x: 330, y: 300, piercing: true }),
        makePlayerBullet({ id: 4, x: 200, y: 300, piercing: true, source: "buddy" }), // #2845
      ],
      asteroids: [makeRock({ x: 200, y: 150 })],
      // #2843: a beam charging, an attack run bracing, and a released beam in flight
      enemies: s.enemies.map((e) =>
        e.tier === "Carrier"
          ? {
              ...e,
              beamPhase: "charge" as const,
              beamTimer: 300,
              runPhase: "brace" as const,
              runTimer: 400,
            }
          : e
      ),
      carrierBeams: [makeBeam(120, 300)],
      extraction: { elapsedMs: 100, climbMs: 0 },
    };
    expect(s.buddyShips.length).toBeGreaterThan(0);
    expect(carrierBeamCharge(s)).not.toBeNull();
    const c = clearTransientCombat(s);
    expect(c.enemyBullets).toEqual([]);
    expect(c.playerBullets).toEqual([]);
    expect(c.carrierBeams).toEqual([]);
    expect(c.asteroids).toEqual([]);
    expect(c.buddyShips).toEqual([]);
    expect(carrierBeamCharge(c)).toBeNull();
    expect(c.enemies.every((e) => e.runPhase === "idle")).toBe(true);
    expect(c.extraction).toBeNull();
    // and nothing else about the run
    expect(c.score).toBe(s.score);
    expect(c.player).toBe(s.player);
    expect(c.runStats).toBe(s.runStats);
  });

  it("nothing from wave N can interact with wave N+1", () => {
    // wave N ends with hazards everywhere — too many to all resolve before the ship is out
    const leftovers = Array.from({ length: 12 }, (_, i) =>
      makeEnemyBullet({ id: 93000 + i, x: 20 + i * 28, y: 20, vy: 0.05 })
    );
    let s = enterExtraction({
      enemyBullets: leftovers,
      playerBullets: [makePlayerBullet({ x: 100, y: 600, vy: -0.05 })],
      asteroids: [makeRock({ x: 40, y: 30, vx: 0.01, vy: 0.01 })],
      // #2843: a released beam crawling down the far column, too slow to clear the screen
      carrierBeams: [makeBeam(CANVAS_W - 20, 40, { vy: 0.01 })],
    });
    expect(s.carrierBeams).toHaveLength(1); // the last kill doesn't retract it either
    s = runExtraction(s);
    expect(s.wave).toBe(2);
    expect(s.carrierBeams).toEqual([]);
    expect(s.enemyBullets).toEqual([]);
    expect(s.playerBullets).toEqual([]);
    expect(s.asteroids).toEqual([]);
    expect(s.buddyShips).toEqual([]);
    // the new formation arrives untouched and the player starts combat unscathed
    const lives = s.player.lives;
    s = { ...s, enemyFireDisabled: true, asteroidsDisabled: true };
    while (s.phase === "SwoopIn") s = tick(s, 16, NO_INPUT);
    expect(s.phase).toBe("Playing");
    expect(s.player.lives).toBe(lives);
    const fresh = initStarSwarm(CANVAS_W, CANVAS_H, 2);
    for (const e of s.enemies) {
      const hp = fresh.enemies.find((f) => f.tier === e.tier)!.hp;
      expect(e.isAlive).toBe(true);
      expect(e.hp).toBe(hp);
    }
  });

  it("the next wave opens clean even when the extraction timed out", () => {
    let s = enterExtraction({
      enemyBullets: [makeEnemyBullet({ x: 30, y: 100, vy: 0 })],
      asteroids: [makeRock({ x: 300, y: 100 })],
    });
    s = { ...s, extraction: { elapsedMs: EXTRACTION_MAX_MS, climbMs: 0 } };
    s = tick(s, 16, NO_INPUT);
    expect(s.wave).toBe(2);
    expect(s.enemyBullets).toEqual([]);
    expect(s.asteroids).toEqual([]);
  });

  it("liveHazards lists every hostile shot and rock the autopilot must avoid", () => {
    const s = {
      ...initStarSwarm(CANVAS_W, CANVAS_H),
      enemyBullets: [makeEnemyBullet({ x: 10, y: 20 })],
      asteroids: [makeRock({ x: 50, y: 60 }), makeRock({ id: 2, hp: 0 })],
      playerBullets: [makePlayerBullet()],
    };
    const h = liveHazards(s);
    expect(h).toHaveLength(2);
    expect(h[0]).toMatchObject({ x: 10, y: 20, r: 7 });
    expect(h[1]).toMatchObject({ x: 50, y: 60, r: ASTEROID_STATS.large.radius });
  });

  it("#2843: liveHazards covers a released Carrier beam's whole length", () => {
    const b = makeBeam(90, 300);
    const s = { ...initStarSwarm(CANVAS_W, CANVAS_H), carrierBeams: [b] };
    const h = liveHazards(s);
    expect(h.length).toBeGreaterThan(1);
    expect(h.every((c) => c.x === 90 && c.vy === BEAM_SPEED && c.r === BEAM_HALF_WIDTH)).toBe(true);
    const ys = h.map((c) => c.y);
    expect(Math.max(...ys)).toBe(b.y);
    expect(Math.min(...ys)).toBeLessThanOrEqual(b.y - b.length + BEAM_HALF_WIDTH * 1.5);
    // consecutive circles overlap, so no gap in the band
    for (let i = 1; i < ys.length; i++)
      expect(ys[i - 1]! - ys[i]!).toBeLessThan(2 * BEAM_HALF_WIDTH);
  });

  it("first wave of a fresh game starts with no leftover bullets", () => {
    const s = initStarSwarm(CANVAS_W, CANVAS_H, 1);
    expect(s.playerBullets).toHaveLength(0);
    expect(s.enemyBullets).toHaveLength(0);
    expect(s.extraction).toBeNull();
  });
});
