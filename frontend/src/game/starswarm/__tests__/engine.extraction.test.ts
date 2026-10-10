/**
 * Star Swarm engine tests: the #2842 wave lifecycle (safe entry, live extraction, projectile
 * persistence, hard reset), the #2352 non-blocking clear and #3132's pickup wait.
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
  PICKUP_WAIT_SLACK_MS,
  arrivalsAllowed,
  clearTransientCombat,
  weaponsFree,
  hazardsLive,
  isAutopilot,
  isWaveCleared,
  killEscorts,
  pickupWaitMaxMs,
  waveJustCleared,
  liveHazards,
} from "../engine";
import { powerUpDespawnMs } from "../engine/entities";
import { tickPickupWait } from "../engine/extraction";
import { bonusLifeThreshold, PLAYER_Y_FROM_BOTTOM, POWERUP_VY } from "../engine/tuning";
import { fitsSaveShape } from "../saveShape";
import type { Asteroid, Bullet, PowerUp, StarSwarmState } from "../types";
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

// ---------------------------------------------------------------------------
// #3132 — a cleared wave waits for its pickups (ClearAwaitingPickups), the player flying, before
// the extraction. Replaces #2945's autopilot pickup chase, which is retired.
// ---------------------------------------------------------------------------

/** A pickup `dy` above the ship and `dx` to its side, falling at the normal speed. */
function makeDrop(
  s: StarSwarmState,
  dx: number,
  dy: number,
  type: PowerUp["type"] = "salvage"
): PowerUp {
  return {
    id: 93000,
    type,
    x: s.player.x + dx,
    y: s.player.y - dy,
    vy: POWERUP_VY,
    width: 24,
    height: 24,
    despawnTimer: 8000,
  };
}

/** A quiet wave (no enemy fire, rocks or flak) on a canvas `canvasH` tall, in combat. */
function quietWave(wave: number, canvasH = CANVAS_H): StarSwarmState {
  let s = initStarSwarm(CANVAS_W, canvasH, wave);
  s = { ...s, enemyFireDisabled: true, asteroidsDisabled: true, flakDisabled: true };
  while (s.phase === "SwoopIn") s = tick(s, 16, NO_INPUT);
  expect(s.phase).toBe("Playing");
  return { ...s, player: { ...s.player, invincibleTimer: 0 } };
}

/**
 * Kill a boss wave's escorts, then the Carrier on station with one heavy shot, as the wave's
 * last enemy. Returns the kill tick's state and the Carrier's hull drop.
 */
function killCarrierLast(canvasH: number): { s: StarSwarmState; hull: PowerUp } {
  let s = killEscorts(quietWave(5, canvasH));
  const carrier = s.enemies.find((e) => e.isAlive && e.tier === "Carrier")!;
  expect(s.enemies.filter((e) => e.isAlive)).toHaveLength(1);
  s = {
    ...s,
    playerBullets: [
      makePlayerBullet({ x: carrier.x, y: carrier.y, damage: 999, armorPiercing: true }),
    ],
  };
  s = tick(s, 16, NO_INPUT);
  expect(s.enemies.some((e) => e.isAlive)).toBe(false);
  const hull = s.powerUps.find((p) => p.type === "hull")!;
  expect(hull).toBeDefined();
  expect(hull.y).toBeLessThan(canvasH / 2); // dropped on station, high up the screen
  return { s, hull };
}

/** Tick with the ship under `x` (or a function of the state) while the wave waits. */
function flyWhileWaiting(s: StarSwarmState, x: (s: StarSwarmState) => number): StarSwarmState {
  for (let i = 0; i < 2000 && s.phase === "ClearAwaitingPickups"; i++) {
    s = tick(s, 16, { playerX: x(s), fire: false });
  }
  return s;
}

describe("#3132 the wave waits for on-screen pickups before the extraction", () => {
  it("1. a last kill with no pickup on screen goes straight to the extraction, as before", () => {
    const s = quietPlaying();
    expect(s.powerUps).toHaveLength(0);
    const killed = { ...s, enemies: s.enemies.map((e) => ({ ...e, isAlive: false, hp: 0 })) };
    let next = tick(killed, 16, NO_INPUT);
    // the same tick: the clear bonus, the banner and the extraction, no wait
    expect(next.phase).toBe("Extraction");
    expect(next.extraction).toEqual({ elapsedMs: 0, climbMs: 0 });
    expect(next.phaseTimer).toBe(0);
    expect(next.score).toBe(s.score + waveClearBonusPoints(1, s.difficulty));
    expect(next.missionCompleteTimer).toBe(MISSION_COMPLETE_BANNER_MS);
    // and the same timing: hold the minimum, climb, out — never via the pickup wait
    const phases = new Set<string>();
    let ticks = 1;
    while (next.wave === 1) {
      next = tick(next, 16, NO_INPUT);
      phases.add(next.phase);
      ticks++;
    }
    expect(phases.has("ClearAwaitingPickups")).toBe(false);
    expect(ticks * 16).toBeGreaterThan(EXTRACTION_HOLD_MIN_MS);
    expect(ticks * 16).toBeLessThan(EXTRACTION_HOLD_MIN_MS + 2000);
  });

  it("a last kill with a pickup on screen waits, with the clear bonus and banner on the kill", () => {
    const s = quietPlaying();
    const killed = {
      ...s,
      powerUps: [makeDrop(s, 90, 300)],
      enemies: s.enemies.map((e) => ({ ...e, isAlive: false, hp: 0 })),
    };
    const next = tick(killed, 16, NO_INPUT);
    expect(next.phase).toBe("ClearAwaitingPickups");
    expect(next.extraction).toBeNull();
    expect(next.score).toBe(s.score + waveClearBonusPoints(1, s.difficulty));
    expect(next.missionCompleteTimer).toBe(MISSION_COMPLETE_BANNER_MS);
    expect(waveJustCleared(s, next)).toBe(true);
    expect(isWaveCleared(next)).toBe(true);
    // the player has the ship; hazards and collection stay live; nothing new arrives
    expect(isAutopilot(next)).toBe(false);
    expect(hazardsLive(next)).toBe(true);
    expect(weaponsFree(next)).toBe(false);
    expect(arrivalsAllowed(next)).toBe(false);
  });

  it.each([CANVAS_H, 960])(
    "2. the Carrier killed on station last (canvas %i px): the wave waits, the player collects the plating, +1 hull carries into the next wave",
    (canvasH) => {
      const { s: killed, hull } = killCarrierLast(canvasH);
      expect(killed.phase).toBe("ClearAwaitingPickups");
      const score = killed.score;
      // the player flies under the plating and waits for it — no autopilot, no magnet
      let s = flyWhileWaiting(
        killed,
        (st) => st.powerUps.find((p) => p.id === hull.id)?.x ?? st.player.x
      );
      expect(s.player.hull).toBe(1);
      expect(s.powerUps.some((p) => p.id === hull.id)).toBe(false);
      // only once nothing is left on screen does the extraction start
      expect(s.phase).toBe("Extraction");
      expect(s.powerUps).toHaveLength(0);
      expect(waveJustCleared(killed, s)).toBe(false); // the clear fired once, on the kill
      s = runExtraction(s);
      expect(s.wave).toBe(6);
      expect(s.phase).toBe("SwoopIn");
      expect(s.player.hull).toBe(1);
      expect(s.score).toBe(score); // the bonus was paid once, on the kill
    }
  );

  it("7. a boss wave pays its ×2 clear bonus once, on the Carrier's kill", () => {
    const { s } = killCarrierLast(CANVAS_H);
    const after = runExtraction(flyWhileWaiting(s, (st) => st.player.x));
    expect(after.score).toBe(s.score);
    expect(after.wave).toBe(6);
  });

  it.each([CANVAS_H, 960])(
    "3. a missed pickup (canvas %i px): the wave waits until it falls off, then clears",
    (canvasH) => {
      const { s: killed, hull } = killCarrierLast(canvasH);
      const awayX = hull.x < CANVAS_W / 2 ? CANVAS_W : 0; // the far edge
      let s = killed;
      while (s.powerUps.some((p) => p.id === hull.id)) {
        expect(s.phase).toBe("ClearAwaitingPickups");
        s = tick(s, 16, { playerX: awayX, fire: false });
      }
      s = flyWhileWaiting(s, () => awayX); // anything else still on screen leaves too
      expect(s.phase).toBe("Extraction");
      expect(s.player.hull).toBe(0);
      s = runExtraction(s);
      expect(s.wave).toBe(6);
      expect(s.player.hull).toBe(0);
    }
  );

  it("4. a shot in flight that breaks a rock after the last kill drops salvage, and the wave waits for it", () => {
    const base = enterExtraction(); // no pickup at the kill: straight into the extraction
    const score = base.score; // the clear bonus, already paid on the kill
    const rock = makeRock({ x: 60, y: 200, hp: 1 });
    const shot = makePlayerBullet({ x: 60, y: 250 });
    // the salvage roll is a seeded draw: find a seed where this rock pays out
    let s: StarSwarmState | null = null;
    let handBackPrev: StarSwarmState | null = null;
    for (let seed = 1; seed < 500 && !s; seed++) {
      seedRng(seed);
      let t: StarSwarmState = { ...base, asteroids: [rock], playerBullets: [shot] };
      let prev = t;
      for (let i = 0; i < 20 && t.powerUps.length === 0; i++) {
        prev = t;
        t = tick(t, 16, NO_INPUT);
      }
      if (t.powerUps.length > 0) {
        s = t;
        handBackPrev = prev;
      }
    }
    expect(s).not.toBeNull();
    const salvage = s!.powerUps[0]!;
    expect(salvage.type).toBe("salvage");
    // the ship was still on station, holding its lane: the player gets it back
    expect(handBackPrev!.phase).toBe("Extraction");
    expect(s!.phase).toBe("ClearAwaitingPickups");
    expect(s!.extraction).toBeNull();
    expect(s!.player.y).toBe(CANVAS_H - PLAYER_Y_FROM_BOTTOM);
    // the hand-back is not a second clear: no bonus, no clear sound/haptic
    expect(s!.score).toBe(score);
    expect(waveJustCleared(handBackPrev!, s!)).toBe(false);
    // collect it, then extract — still no second bonus or clear event on any tick
    let t = s!;
    const phases = new Set<string>();
    for (let i = 0; i < 4000 && t.wave === 1; i++) {
      const input =
        t.phase === "ClearAwaitingPickups"
          ? { playerX: t.powerUps[0]?.x ?? t.player.x, fire: false }
          : NO_INPUT;
      const next = tick(t, 16, input);
      phases.add(next.phase);
      if (next.wave === 1) {
        expect(waveJustCleared(t, next)).toBe(false);
        expect(next.score).toBe(score);
      }
      t = next;
    }
    expect(phases.has("Extraction")).toBe(true);
    expect(t.wave).toBe(2);
    expect(t.score).toBe(score);
    expect(t.player.guns).toBe(2);
  });

  it("a pickup that arrives during the wait (salvage) restarts the wait's clock", () => {
    const s0 = quietPlaying();
    let s = tick(
      {
        ...s0,
        powerUps: [makeDrop(s0, 90, 100)],
        enemies: s0.enemies.map((e) => ({ ...e, isAlive: false, hp: 0 })),
      },
      16,
      NO_INPUT
    );
    expect(s.phase).toBe("ClearAwaitingPickups");
    s = advanceMs(s, 400, { playerX: 20, fire: false });
    expect(s.phaseTimer).toBeGreaterThan(300);
    const crate = { ...makeDrop(s, -50, 300), id: 93001 };
    const before = s.powerUps;
    const arrived = { ...s, powerUps: [...before, crate] };
    // the clock runs on while the same pickups fall, and restarts on a new arrival
    expect(tickPickupWait(s, 16, before).phaseTimer).toBe(s.phaseTimer + 16);
    expect(tickPickupWait(arrived, 16, before).phaseTimer).toBe(0);
  });

  it("5. after the last kill: no player fire, no new rock, no new top-spawned power-up", () => {
    const s0 = quietPlaying();
    let s = tick(
      {
        ...s0,
        powerUps: [makeDrop(s0, 90, 400)],
        enemies: s0.enemies.map((e) => ({ ...e, isAlive: false, hp: 0 })),
      },
      16,
      NO_INPUT
    );
    expect(s.phase).toBe("ClearAwaitingPickups");
    s = {
      ...s,
      player: { ...s.player, shootCooldown: 0 },
      asteroidsDisabled: false,
      nextAsteroidTimer: 1,
      wave: 3,
      killsSinceLastDrop: 999, // a roll would be due…
      dropJitterTarget: 0,
    };
    expect(throwAsteroid(s)).toBe(s);
    const ids = s.powerUps.map((p) => p.id);
    s = advanceMs(s, 1000, { playerX: 20, fire: true });
    expect(s.phase).toBe("ClearAwaitingPickups");
    expect(s.playerBullets).toHaveLength(0); // …the weapons stopped with the last kill
    expect(s.asteroids).toHaveLength(0);
    expect(s.powerUps.map((p) => p.id)).toEqual(ids); // …and nothing new dropped in
  });

  it("the ordinary drop the last kill's own tick triggers still spawns, and the wave waits for it", () => {
    const s0 = quietPlaying();
    const killed = {
      ...s0,
      killsSinceLastDrop: 999,
      dropJitterTarget: 0,
      enemies: s0.enemies.map((e) => ({ ...e, isAlive: false, hp: 0 })),
    };
    const s = tick(killed, 16, NO_INPUT);
    expect(s.powerUps).toHaveLength(1);
    expect(s.powerUps[0]!.y).toBeLessThan(40); // top-spawned
    expect(s.phase).toBe("ClearAwaitingPickups");
  });

  it("6. the safety cap ends a wait for a pickup that never leaves", () => {
    const s0 = quietPlaying();
    const stuck = { ...makeDrop(s0, 90, 300), vy: 0, despawnTimer: 1e9 };
    let s = tick(
      {
        ...s0,
        powerUps: [stuck],
        enemies: s0.enemies.map((e) => ({ ...e, isAlive: false, hp: 0 })),
      },
      16,
      NO_INPUT
    );
    expect(s.phase).toBe("ClearAwaitingPickups");
    const cap = pickupWaitMaxMs(CANVAS_H);
    expect(cap).toBe(powerUpDespawnMs(CANVAS_H) + PICKUP_WAIT_SLACK_MS);
    s = advanceMs(s, cap - 100, { playerX: 20, fire: false });
    expect(s.phase).toBe("ClearAwaitingPickups");
    s = advanceMs(s, 200, { playerX: 20, fire: false });
    // the stuck pickup is removed so the extraction never hands the ship back for it
    expect(s.phase).toBe("Extraction");
    expect(s.powerUps).toHaveLength(0);
    s = runExtraction(s);
    expect(s.wave).toBe(2);
  });

  it("8. pause and resume during the wait: a saved run resumes the wait exactly", () => {
    const s0 = quietPlaying();
    let s = tick(
      {
        ...s0,
        powerUps: [makeDrop(s0, 90, 300)],
        enemies: s0.enemies.map((e) => ({ ...e, isAlive: false, hp: 0 })),
      },
      16,
      NO_INPUT
    );
    s = advanceMs(s, 500, { playerX: 20, fire: false });
    expect(s.phase).toBe("ClearAwaitingPickups");
    // pausing stops the ticks, so the wait's clock and the pickup hold still; the paused run is
    // saved (pauseLiveRun) and must restore into the same wait
    const restored = JSON.parse(JSON.stringify(s)) as unknown;
    expect(fitsSaveShape(restored)).toBe(true);
    const r = restored as StarSwarmState;
    expect(r.phase).toBe("ClearAwaitingPickups");
    expect(r.phaseTimer).toBe(s.phaseTimer);
    const a = flyWhileWaiting(s, () => 20);
    const b = flyWhileWaiting(r, () => 20);
    expect(b.phase).toBe("Extraction");
    expect(b.player).toEqual(a.player);
    expect(b.score).toBe(a.score);
  });

  it("losing a life during the wait is the normal hit; the last life ends the game", () => {
    const s0 = quietPlaying();
    let s = tick(
      {
        ...s0,
        powerUps: [makeDrop(s0, 90, 300)],
        enemies: s0.enemies.map((e) => ({ ...e, isAlive: false, hp: 0 })),
      },
      16,
      NO_INPUT
    );
    s = { ...s, player: { ...s.player, lives: 1, hull: 0, invincibleTimer: 0 } };
    s = {
      ...s,
      enemyBullets: [makeEnemyBullet({ x: s.player.x, y: s.player.y, vy: 0, width: 60 })],
    };
    s = tick(s, 16, { playerX: s.player.x, fire: false });
    expect(s.phase).toBe("GameOver");
  });

  it("a non-lethal hit during the wait costs a life and keeps the wait", () => {
    const s0 = quietPlaying();
    let s = tick(
      {
        ...s0,
        powerUps: [makeDrop(s0, 90, 300)],
        enemies: s0.enemies.map((e) => ({ ...e, isAlive: false, hp: 0 })),
      },
      16,
      NO_INPUT
    );
    expect(s.phase).toBe("ClearAwaitingPickups");
    s = { ...s, player: { ...s.player, lives: 3, hull: 0, invincibleTimer: 0 } };
    s = {
      ...s,
      enemyBullets: [makeEnemyBullet({ x: s.player.x, y: s.player.y, vy: 0, width: 60 })],
    };
    const score = s.score;
    const next = tick(s, 16, { playerX: s.player.x, fire: false });
    expect(next.player.lives).toBe(2);
    expect(next.phase).toBe("ClearAwaitingPickups");
    expect(next.extraction).toBeNull();
    expect(next.score).toBe(score);
    expect(waveJustCleared(s, next)).toBe(false);
  });

  it("a bonus life that rescues a lethal hit during the wait returns to the wait", () => {
    const s0 = quietPlaying();
    let s = tick(
      {
        ...s0,
        powerUps: [makeDrop(s0, 90, 300)],
        enemies: s0.enemies.map((e) => ({ ...e, isAlive: false, hp: 0 })),
      },
      16,
      NO_INPUT
    );
    expect(s.phase).toBe("ClearAwaitingPickups");
    // a bonus life is due this tick (score at the threshold, none awarded yet)
    const threshold = bonusLifeThreshold(s.difficulty);
    s = {
      ...s,
      score: threshold,
      bonusLivesAwarded: 0,
      player: { ...s.player, lives: 1, hull: 0, invincibleTimer: 0 },
      enemyBullets: [makeEnemyBullet({ x: s.player.x, y: s.player.y, vy: 0, width: 60 })],
    };
    const next = tick(s, 16, { playerX: s.player.x, fire: false });
    expect(next.player.lives).toBe(1);
    expect(next.bonusLivesAwarded).toBe(1);
    expect(next.phase).toBe("ClearAwaitingPickups");
    expect(next.extraction).toBeNull();
    expect(waveJustCleared(s, next)).toBe(false);
  });

  it("an Extraction save from before the wait existed loads and extracts as before", () => {
    const s = enterExtraction();
    const score = s.score;
    // the pre-#3132 save shape: Extraction with its progress, phaseTimer 0, no pickup on screen
    const old = { ...advanceMs(s, 200), phaseTimer: 0 };
    expect(old.phase).toBe("Extraction");
    const restored = JSON.parse(JSON.stringify(old)) as unknown;
    expect(fitsSaveShape(restored)).toBe(true);
    let r = restored as StarSwarmState;
    let prev = r;
    for (let i = 0; i < 2000 && r.wave === 1; i++) {
      prev = r;
      r = tick(r, 16, NO_INPUT);
      expect(r.phase).not.toBe("ClearAwaitingPickups");
      if (r.wave === 1) expect(waveJustCleared(prev, r)).toBe(false);
    }
    expect(r.wave).toBe(2);
    expect(r.score).toBe(score);
  });

  it("an Extraction save with a pickup on screen while holding its lane hands back with no second bonus", () => {
    const s = advanceMs(enterExtraction(), 200);
    expect(s.extraction!.climbMs).toBe(0); // still on station
    const score = s.score;
    const old = { ...s, phaseTimer: 0, powerUps: [makeDrop(s, 90, 300)] };
    const restored = JSON.parse(JSON.stringify(old)) as unknown;
    expect(fitsSaveShape(restored)).toBe(true);
    const r = restored as StarSwarmState;
    const next = tick(r, 16, NO_INPUT);
    expect(next.phase).toBe("ClearAwaitingPickups");
    expect(next.extraction).toBeNull();
    expect(next.score).toBe(score);
    expect(waveJustCleared(r, next)).toBe(false);
    let t = flyWhileWaiting(next, (st) => st.powerUps[0]?.x ?? st.player.x);
    expect(t.phase).toBe("Extraction");
    expect(t.score).toBe(score);
    t = runExtraction(t);
    expect(t.wave).toBe(2);
    expect(t.score).toBe(score);
  });

  it("the autopilot never chases a pickup (the #2945 chase is retired)", () => {
    // a pickup can only meet the extraction if the safety cap removed nothing — force one in
    let s = enterExtraction();
    s = advanceMs(s, EXTRACTION_HOLD_MIN_MS + 50);
    expect(s.extraction!.climbMs).toBeGreaterThan(0); // climbing: it won't hand the ship back
    const x0 = s.player.x;
    s = { ...s, powerUps: [makeDrop(s, 90, 20)] };
    s = tick(s, 16, NO_INPUT);
    expect(s.phase).toBe("Extraction");
    expect(s.player.x).toBe(x0); // nothing to dodge, so it holds its lane — no steer to the pickup
  });
});
