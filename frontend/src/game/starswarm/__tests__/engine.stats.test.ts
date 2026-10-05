/**
 * Star Swarm engine tests: run stats and per-tier counters.
 *
 * One file per planned `engine/` module (#2988): this file follows `engine/stats.ts`. Split out of
 * the former monolithic `engine.test.ts` (#2955) with describe blocks moved whole; shared fixtures
 * live in `helpers/engineFixtures.ts`.
 */
import {
  initStarSwarm,
  tick,
  PLAYER_HURT_RADIUS,
  seedRng,
  _resetIds,
  CANVAS_W,
  CANVAS_H,
  applyPowerUp,
  difficultyParamScale,
  isCarrierArmored,
  carrierJustExposed,
  throwAsteroid,
  MAX_ASTEROIDS,
  ASTEROID_STATS,
  BEAM_HALF_WIDTH,
  dodgeChance,
  emptyTierStats,
  emptyRunStats,
  dodgeRateByTier,
  killEscorts,
} from "../engine";
import type {
  Asteroid,
  AsteroidKind,
  Bullet,
  DifficultyTier,
  StarSwarmInput,
  StarSwarmState,
} from "../types";
import { advanceMs, clearWave, makeBeam } from "./helpers/engineFixtures";

beforeEach(() => {
  seedRng(42);
  _resetIds();
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
    };
    s = clearWave(s, ASIDE);
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

  it("armorDeflects counts shots the escorted Carrier shrugs off, not armor-piercing ones", () => {
    const base = quiet("LieutenantJG", 1);
    expect(isCarrierArmored(base)).toBe(true);
    const c = carrierOf(base);
    // one bullet lands per enemy per tick, so two deflections take two ticks
    let s = tick({ ...base, playerBullets: [shot(c.x, c.y)] }, 16, ASIDE);
    s = tick({ ...s, playerBullets: [shot(c.x, c.y)] }, 16, ASIDE);
    expect(carrierOf(s).hp).toBe(8);
    expect(s.runStats.armorDeflects).toBe(2);

    s = tick(
      {
        ...base,
        playerBullets: [shot(c.x, c.y, { piercing: true, armorPiercing: true, width: 12 })],
      },
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

  it("beamHits counts a beam that lands once — plating or a life — and never a shielded one", () => {
    const base = quiet("LieutenantJG", 1);
    const c = { x: 200 };
    const firing = (s: StarSwarmState) => ({
      ...s,
      player: { ...s.player, x: c.x },
      carrierBeams: [makeBeam(c.x, s.player.y)],
    });
    const inBeam: StarSwarmInput = { playerX: c.x, fire: false };

    // a life
    let s = tick(firing(base), 16, inBeam);
    expect(s.player.lives).toBe(2);
    expect(s.runStats.beamHits).toBe(1);
    s = advanceMs(s, 1000, inBeam); // the beam was spent; nothing more lands
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
    expect(rows.map((r) => r.tier)).toEqual(["Grunt", "Elite", "Guardian", "Carrier"]);
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
    const boss = formation(base, "Guardian");
    // above the Guardian row and closing on it: it threatens the ship every tick (#2844: only a
    // threatened ship flaks), well inside flak range
    const a = () => rock("large", boss.x, boss.y - 90, { vy: 0.1 });
    const totalFlak = (s: StarSwarmState) =>
      Object.values(s.tierStats).reduce((n, t) => n + t.flak, 0);

    let on = { ...base, asteroids: [a()] };
    let off = { ...base, asteroids: [a()], flakDisabled: true };
    let flakSeen = false;
    for (let i = 0; i < 30; i++) {
      on = tick(on, 16, ASIDE);
      off = tick(off, 16, ASIDE);
      if (on.enemyBullets.some((b) => b.flak)) flakSeen = true; // bolts are spent on the rock fast
    }
    expect(totalFlak(on)).toBeGreaterThan(0);
    expect(flakSeen).toBe(true);
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
