/**
 * Star Swarm engine tests: errant asteroids and the enemy dodge/flak response to them.
 *
 * One file per planned `engine/` module (#2988): this file follows `engine/asteroids.ts`. Split out
 * of the former monolithic `engine.test.ts` (#2955) with describe blocks moved whole; shared
 * fixtures live in `helpers/engineFixtures.ts`.
 */
import {
  initStarSwarm,
  tick,
  bulletCap,
  seedRng,
  _resetIds,
  CANVAS_W,
  CANVAS_H,
  applyPowerUp,
  difficultyParamScale,
  throwAsteroid,
  MAX_ASTEROIDS,
  ASTEROID_STATS,
  dodgeChance,
  nudgePath,
  splitRemaining,
  emptyTierStats,
  DODGE_SIDESTEP,
  FLAK_COOLDOWN,
  DODGE_SIDESTEP_MS,
  DODGE_PATH_NUDGE,
} from "../engine";
import type {
  Asteroid,
  AsteroidKind,
  Bullet,
  DifficultyTier,
  StarSwarmInput,
  StarSwarmState,
} from "../types";
import { NO_INPUT, advanceMs, runExtraction, clearWave } from "./helpers/engineFixtures";

beforeEach(() => {
  seedRng(42);
  _resetIds();
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
      explosions: [], // tests count new ones
      carrierBeams: [],
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

  it("rocks in flight keep going through the extraction, then the reset clears them (#2842)", () => {
    let s = quiet(1);
    const a = rock("large", 40, 60, { vx: 0, vy: 0 });
    s = {
      ...s,
      asteroids: [a],
      enemies: s.enemies.map((e) => ({ ...e, isAlive: false, hp: 0 })),
    };
    s = tick(s, 16, NO_INPUT);
    expect(s.phase).toBe("Extraction");
    expect(s.asteroids.map((r) => r.id)).toEqual([a.id]);
    s = runExtraction(s);
    expect(s.wave).toBe(2);
    expect(s.phase).toBe("SwoopIn");
    expect(s.asteroids).toEqual([]);
  });

  it("never rides into a boss wave, and the timer spawns nothing there (#2490, #2842)", () => {
    let s = quiet(4);
    const a = rock("large", 40, 60, { vx: 0, vy: 0 });
    s = {
      ...s,
      asteroids: [a],
      enemies: s.enemies.map((e) => ({ ...e, isAlive: false, hp: 0 })),
    };
    s = runExtraction(tick(s, 16, NO_INPUT));
    expect(s.wave).toBe(5);
    expect(s.asteroids).toEqual([]);
    s = { ...s, asteroidsDisabled: false, nextAsteroidTimer: 1 };
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

  // #2842: in combat — a reinforcement swooping in; during the wave's own swoop-in nothing
  // resolves at all (see the wave-entry gating tests)
  it("strikes a swooping ship once it is on screen, but not one still waiting off-screen", () => {
    let s: StarSwarmState = { ...initStarSwarm(CANVAS_W, CANVAS_H, 2), phase: "Playing" };
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
    expect(dodgeChance("Guardian", 1)).toBeCloseTo(0.8);
    expect(dodgeChance("Grunt", difficultyParamScale("Ensign"))).toBeCloseTo(0.175);
    expect(dodgeChance("Grunt", difficultyParamScale("FleetAdmiral"))).toBeCloseTo(0.75); // 0.25 × 3
    expect(dodgeChance("Elite", difficultyParamScale("FleetAdmiral"))).toBe(0.97); // 1.65 → cap
    expect(dodgeChance("Guardian", difficultyParamScale("FleetAdmiral"))).toBe(0.97);
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
    const q = { ...quiet(), enemyFireDisabled: false };
    const guardian = q.enemies.find(
      (e) => e.isAlive && e.tier === "Guardian" && e.phase === "Formation"
    )!;
    // only this Guardian (plus the armored Carrier, which never flaks) stays, so every flak
    // bolt in the state is this ship's
    const base = {
      ...q,
      enemies: q.enemies.map((e) =>
        e.id === guardian.id || e.tier === "Carrier" ? e : { ...e, isAlive: false, hp: 0 }
      ),
    };
    // #2844: the Carrier's flak is its diverted twin volley (see asteroids.test.ts); the per-ship
    // flak roll belongs to the fighters. Guardians roll 0.9, so a few seeds always find a shot.
    const c = base.enemies.find(
      (e) => e.isAlive && e.tier === "Guardian" && e.phase === "Formation"
    )!;
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
    let s = base;
    let fromShip: Bullet | undefined;
    for (let seed = 1; seed <= 40 && !fromShip; seed++) {
      seedRng(seed);
      s = tick(
        {
          ...base,
          enemyBullets: filler,
          asteroids: [rock("large", c.x, c.y - 90, { vy: 0.2 })],
        },
        16,
        ASIDE
      );
      fromShip = s.enemyBullets.filter((b) => b.flak).find((b) => Math.abs(b.x - c.x) < 6);
    }
    expect(fromShip).toBeDefined();
    expect(fromShip!.vy).toBeLessThan(0); // aimed up at the rock
    expect(s.enemies.find((e) => e.id === c.id)!.flakCooldown).toBeGreaterThan(0);
    expect(s.tierStats.Guardian.flak).toBeGreaterThanOrEqual(1);
    // a fighter can't flak again within FLAK_COOLDOWN, even with a fresh rock always inbound
    const flakCount = s.tierStats.Guardian.flak;
    for (let t = 16; t < FLAK_COOLDOWN - 100; t += 16) {
      s = tick({ ...s, asteroids: [rock("large", c.x, c.y - 90, { vy: 0.2 })] }, 16, ASIDE);
      expect(s.tierStats.Guardian.flak).toBe(flakCount);
    }
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

    s = clearWave(s, ASIDE);
    expect(s.wave).toBe(3);
    expect(s.tierStats.Grunt.struck).toBe(1);

    expect(initStarSwarm(CANVAS_W, CANVAS_H).tierStats).toEqual(emptyTierStats());
  });
});
