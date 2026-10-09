/**
 * #3131 (BC_GAMES-5P): a ship holding station while a rock passes safely in front of it must not
 * then commit a move (the Carrier's attack run, an Elite/Guardian dive) straight into that rock.
 * The fix is commit-time path *selection* only — rocks still threaten, still hit and still
 * damage every tier, and a rock already on course to hit a ship still hits it.
 */
import {
  initStarSwarm,
  tick,
  CANVAS_W,
  CANVAS_H,
  ATTACK_RUN,
  ATTACK_RUN_BRACE_MS,
} from "../engine";
import {
  asteroidHitsBox,
  asteroidThreatens,
  enemyThreatCircle,
  firstClearPath,
  onScreenRocks,
  pathStrikesRock,
} from "../engine/asteroids";
import { NO_CARRIER_CTX, carrierRunPath, tickCarrier, type CarrierCtx } from "../engine/carrier";
import { diveCandidates, tickSingleEnemy } from "../engine/enemyPhases";
import { evalCubic } from "../engine/geometry";
import { rng, seedRng } from "../engine/rng";
import {
  ATTACK_RUN_HOLD_MAX_MS,
  DEFAULT_TUNING,
  DIVE_HOLD_MAX_MS,
  DIVE_PATH_DURATION,
  GUARDIAN_DIVE_PATH_DURATION,
  TIER_HP,
  TIER_SIZE,
} from "../engine/tuning";
import type {
  Asteroid,
  CubicBezier,
  Enemy,
  EnemyTier,
  StarSwarmInput,
  StarSwarmState,
} from "../types";

const DT = 16;
const ASIDE: StarSwarmInput = { playerX: 40, fire: false };
const ROCK_ID = 93_131;

function rockAt(
  x: number,
  y: number,
  vx: number,
  vy: number,
  over: Partial<Asteroid> = {}
): Asteroid {
  return {
    id: ROCK_ID,
    kind: "large",
    x,
    y,
    vx,
    vy,
    radius: 22,
    hp: 6,
    rotation: 0,
    spin: 0,
    hitFlashTimer: 0,
    hitEnemyIds: [],
    ...over,
  };
}

/** A rock that will sit on `path` at progress `t` (path time `ms`), flying with (vx, vy). */
function rockCrossing(path: CubicBezier, t: number, ms: number, vx: number, vy: number): Asteroid {
  const p = evalCubic(path, t);
  return rockAt(p.x - vx * ms, p.y - vy * ms, vx, vy);
}

/** Step a path and a rock forward together; true if the rock's body ever touches the ship's box. */
function flown(path: CubicBezier, ms: number, size: { w: number; h: number }, rock: Asteroid) {
  for (let t = 0; t <= ms; t += 8) {
    const p = evalCubic(path, t / ms);
    const r = { ...rock, x: rock.x + rock.vx * t, y: rock.y + rock.vy * t };
    if (asteroidHitsBox(r, { x: p.x, y: p.y, width: size.w, height: size.h })) return true;
  }
  return false;
}

function settled(wave = 1, seed = 42): StarSwarmState {
  let s = initStarSwarm(CANVAS_W, CANVAS_H, wave, seed, "LieutenantJG");
  s = { ...s, enemyFireDisabled: true, asteroidsDisabled: true, flakDisabled: true };
  while (s.phase === "SwoopIn") s = tick(s, DT, ASIDE);
  return {
    ...s,
    enemyBullets: [],
    explosions: [],
    nextDiveTimer: 1e9,
    pauseStraggler: true,
    routDisabled: true,
    player: { ...s.player, x: 40, invincibleTimer: 1e9 },
    enemies: s.enemies.map((e) => ({ ...e, shootTimer: 1e9 })),
  };
}

const carrierOf = (s: StarSwarmState): Enemy =>
  s.enemies.find((e) => e.isAlive && e.tier === "Carrier")!;

function patch(s: StarSwarmState, pred: (e: Enemy) => boolean, p: Partial<Enemy>): StarSwarmState {
  return { ...s, enemies: s.enemies.map((e) => (pred(e) ? { ...e, ...p } : e)) };
}

/** Exposed Carrier: every Guardian dead, the rest of the wave alive. */
function exposedWave(): StarSwarmState {
  const s = settled();
  return {
    ...s,
    enemies: s.enemies.map((e) => (e.tier === "Guardian" ? { ...e, isAlive: false, hp: 0 } : e)),
  };
}

// ---------------------------------------------------------------------------

describe("pathStrikesRock (#3131): pure, rng-free commit-time check", () => {
  const box = { width: 28, height: 28 };
  const path: CubicBezier = {
    p0: { x: 100, y: 100 },
    p1: { x: 100, y: 200 },
    p2: { x: 100, y: 300 },
    p3: { x: 100, y: 400 },
  };

  it("flags a rock that crosses the path but would miss the ship on station", () => {
    const rock = rockCrossing(path, 0.5, 900, 0.2, 0);
    expect(asteroidThreatens(rock, { x: 100, y: 100, r: 18 }, 1800)).toBe(false);
    expect(pathStrikesRock(path, 1800, box, [rock])).toBe(true);
  });

  it("ignores a rock that would hit the ship on station anyway (it is already on course)", () => {
    const onCourse = rockAt(40, 100, 0.2, 0); // reaches (100, 100) in 300 ms
    expect(asteroidThreatens(onCourse, { x: 100, y: 100, r: 18 }, 1800)).toBe(true);
    expect(pathStrikesRock(path, 1800, box, [onCourse])).toBe(false);
  });

  it("ignores rocks that never meet the path, and destroyed rocks", () => {
    expect(pathStrikesRock(path, 1800, box, [rockAt(300, 600, 0.1, 0.1)])).toBe(false);
    const dead = { ...rockCrossing(path, 0.5, 900, 0.2, 0), hp: 0 };
    expect(pathStrikesRock(path, 1800, box, [dead])).toBe(false);
  });

  it("a fast rock cannot slip between path samples (each segment is swept exactly)", () => {
    const fast = rockCrossing(path, 0.53, 954, 3, 0); // crosses the column in a few ms
    expect(pathStrikesRock(path, 1800, box, [fast])).toBe(true);
  });

  it("onScreenRocks keeps only live rocks at least partly on the canvas", () => {
    const rocks = [
      rockAt(100, 100, 0, 0),
      rockAt(-40, 100, 0.2, 0), // still fully off screen
      rockAt(100, 100, 0, 0, { hp: 0 }),
      rockAt(-10, 100, 0.2, 0), // its edge is on screen
    ];
    expect(onScreenRocks(rocks, CANVAS_W, CANVAS_H)).toEqual([rocks[0], rocks[3]]);
  });
});

// ---------------------------------------------------------------------------

describe("Carrier attack run never flies into a passing rock (#3131, BC_GAMES-5P)", () => {
  /** An exposed Carrier one tick from committing its run at `targetX`. */
  function aboutToRun(targetX: number): { s: StarSwarmState; planned: CubicBezier } {
    let s = tick(exposedWave(), DT, ASIDE);
    const c0 = carrierOf(s);
    s = patch(s, (e) => e.tier === "Carrier", {
      runPhase: "brace",
      runTimer: 1,
      beamTimer: 1e9,
      shootTimer: 1e9,
      diveTargetX: targetX,
      y: c0.formationY,
    });
    const c = carrierOf(s);
    return {
      s,
      planned: carrierRunPath({ ...c, y: c.formationY }, targetX, CANVAS_H, "exposed"),
    };
  }

  it("5P: a rock crossing in front of the braced Carrier — the run does not collide", () => {
    const { s: s0, planned } = aboutToRun(CANVAS_W * 0.75);
    const ms = ATTACK_RUN.exposed.ms;
    const tHit = 0.3;
    // crossing from the left, below the Carrier: it would never touch the Carrier on station
    const rock = rockCrossing(planned, tHit, tHit * ms, 0.17, 0.02);
    const c0 = carrierOf(s0);
    expect(onScreenRocks([rock], CANVAS_W, CANVAS_H)).toHaveLength(1);
    expect(asteroidThreatens(rock, { ...enemyThreatCircle(c0), y: c0.formationY }, ms)).toBe(false);
    // the planned run would have swooped into it
    expect(flown(planned, ms, TIER_SIZE.Carrier, rock)).toBe(true);
    expect(pathStrikesRock(planned, ms, c0, [rock])).toBe(true);

    let s: StarSwarmState = { ...s0, asteroids: [rock] };
    let ran = false;
    for (let t = 0; t < ms + ATTACK_RUN_HOLD_MAX_MS + 500; t += DT) {
      s = tick(s, DT, ASIDE);
      const c = carrierOf(s);
      if (c.phase === "AttackRun") ran = true;
      expect(c.hp).toBe(TIER_HP.Carrier);
    }
    expect(ran).toBe(true); // it still attacked — on a path that misses the rock
    const r = s.asteroids.find((a) => a.id === ROCK_ID);
    expect(r?.hitEnemyIds ?? []).not.toContain(c0.id);
  });

  it("picks the first clear alternative and keeps the run's endpoint (back on station)", () => {
    const { s: s0, planned } = aboutToRun(CANVAS_W * 0.75);
    const ms = ATTACK_RUN.exposed.ms;
    const rock = {
      ...rockCrossing(planned, 0.3, 0.3 * ms, 0.02, 0.06),
      kind: "small" as const,
      radius: 12,
    };
    const c0 = carrierOf(s0);
    expect(pathStrikesRock(planned, ms, c0, [rock])).toBe(true);
    const ctx: CarrierCtx = {
      ...NO_CARRIER_CTX,
      playing: true,
      stage: "exposed",
      prevStage: "exposed",
      playerX: 40,
      playerY: 560,
      rocks: [rock],
    };
    const out = tickCarrier(c0, DT, ctx).enemy;
    expect(out.phase).toBe("AttackRun");
    expect(out.path).not.toEqual(planned);
    expect(out.path!.p3).toEqual(planned.p3);
    expect(pathStrikesRock(out.path!, ms, c0, [rock])).toBe(false);
  });

  it("with every run blocked it holds braced, re-checking, then stands down and re-rolls", () => {
    const { s: s0 } = aboutToRun(CANVAS_W * 0.5);
    let c = carrierOf(s0);
    // a huge parked rock under the Carrier: clear of it on station, in the way of every swoop
    const wall = rockAt(c.x, c.formationY + 190, 0, 0, { radius: 150 });
    const ctx: CarrierCtx = {
      ...NO_CARRIER_CTX,
      playing: true,
      stage: "exposed",
      prevStage: "exposed",
      playerX: 40,
      playerY: 560,
      rocks: [wall],
    };
    seedRng(7);
    let held = 0;
    for (let t = 0; t < ATTACK_RUN_HOLD_MAX_MS + 200 && c.runPhase === "brace"; t += DT) {
      c = tickCarrier(c, DT, ctx).enemy;
      expect(c.phase).toBe("Formation");
      if (c.runPhase === "brace") {
        held += DT;
        expect(c.y).toBe(c.formationY); // settled on station while it waits
      }
    }
    expect(held).toBeGreaterThanOrEqual(ATTACK_RUN_HOLD_MAX_MS - 2 * DT);
    expect(c.runPhase).toBe("idle");
    expect(c.runTimer).toBeGreaterThan(0); // a fresh roll
  });
});

// ---------------------------------------------------------------------------

describe("Elite and Guardian dives never fly into a passing rock (#3131)", () => {
  function diver(tier: EnemyTier): Enemy {
    const s = settled(tier === "Guardian" ? 5 : 3);
    // the ship of this tier nearest the centre column (any live ship, retagged, if none)
    const centre = (a: Enemy, b: Enemy) =>
      Math.abs(a.formationX - CANVAS_W / 2) - Math.abs(b.formationX - CANVAS_W / 2);
    const live = s.enemies.filter((x) => x.isAlive);
    const e =
      [...live].filter((x) => x.tier === tier).sort(centre)[0] ?? [...live].sort(centre)[0]!;
    const size = TIER_SIZE[tier];
    return {
      ...e,
      tier,
      width: size.w,
      height: size.h,
      phase: "Wiggling",
      wiggleTimer: 1,
      diveTargetX: CANVAS_W * 0.5,
      x: e.formationX,
      y: e.formationY,
      path: null,
    };
  }

  /** Launch a dive (Guardian: deep stage; Elite: stage 1, shallow) with these rocks. */
  function launch(e: Enemy, rocks: Asteroid[]): Enemy {
    const deep = e.tier === "Guardian";
    return tickSingleEnemy(
      e,
      DT,
      40,
      560,
      CANVAS_H,
      false,
      5,
      deep,
      deep,
      1,
      NO_CARRIER_CTX,
      DEFAULT_TUNING,
      rocks
    ).enemy;
  }

  for (const tier of ["Elite", "Guardian"] as const) {
    it(`${tier}: the dive avoids a rock crossing its planned path, with the same single rng() draw`, () => {
      const e = diver(tier);
      const ms = tier === "Guardian" ? GUARDIAN_DIVE_PATH_DURATION : DIVE_PATH_DURATION;
      seedRng(1234);
      const planned = launch(e, []).path!;
      const nextDrawPlain = rng();
      const rock0 = rockCrossing(planned, 0.5, 0.5 * ms, -0.17, 0.02);
      expect(asteroidThreatens(rock0, enemyThreatCircle(e), ms)).toBe(false);
      expect(flown(planned, ms, TIER_SIZE[tier], rock0)).toBe(true);

      // launch for real: it either takes a clear alternative at once, or holds its wiggle while
      // the rock passes and then dives clear of it (or stands down) — never into it
      seedRng(1234);
      let rock = rock0;
      let out = launch(e, [rock]);
      while (out.phase === "Wiggling") {
        rock = { ...rock, x: rock.x + rock.vx * DT, y: rock.y + rock.vy * DT };
        out = launch(out, [rock]);
      }
      expect(rng()).toBe(nextDrawPlain); // determinism: no extra draws
      expect(["Diving", "Formation"]).toContain(out.phase);
      if (out.phase === "Diving") {
        expect(out.path!.p3).toEqual(planned.p3); // same committed endpoint
        expect(flown(out.path!, ms, TIER_SIZE[tier], rock)).toBe(false);
      }
    });

    it(`${tier}: takes the first clear alternative (fixed order) when one exists`, () => {
      const e = diver(tier);
      const ms = tier === "Guardian" ? GUARDIAN_DIVE_PATH_DURATION : DIVE_PATH_DURATION;
      seedRng(1234);
      const planned = launch(e, []).path!;
      // a small, slow rock drifting down onto the planned dive: the first spot along the path
      // (fixed scan) that blocks the planned dive but leaves an alternative clear
      const candidates = [0.2, 0.3, 0.4, 0.5, 0.6, 0.7].flatMap((t) =>
        [-0.04, 0.04].map((vx): Asteroid => ({
          ...rockCrossing(planned, t, t * ms, vx, 0.06),
          kind: "small",
          radius: 12,
        }))
      );
      const rock = candidates.find(
        (r) =>
          pathStrikesRock(planned, ms, e, [r]) &&
          firstClearPath(diveCandidates(e, planned), ms, e, [r]) !== null
      );
      expect(rock).toBeDefined();
      if (!rock) return;
      const expected = firstClearPath(diveCandidates(e, planned), ms, e, [rock]);
      seedRng(1234);
      const out = launch(e, [rock]);
      expect(out.phase).toBe("Diving");
      expect(out.path).toEqual(expected);
      expect(out.path).not.toEqual(planned);
      expect(flown(out.path!, ms, TIER_SIZE[tier], rock)).toBe(false);
    });

    it(`${tier}: with every dive blocked it keeps wiggling, then settles back into formation`, () => {
      const e0 = diver(tier);
      const wall = rockAt(e0.formationX, e0.formationY + 190, 0, 0, { radius: 150 });
      seedRng(99);
      launch(e0, []);
      const draw = rng(); // the stream after one ordinary launch
      seedRng(99);
      let e = launch(e0, [wall]);
      expect(e.phase).toBe("Wiggling");
      let waited = 0;
      while (e.phase === "Wiggling" && waited < DIVE_HOLD_MAX_MS + 200) {
        e = launch(e, [wall]);
        waited += DT;
      }
      expect(rng()).toBe(draw); // the hold drew nothing more
      expect(waited).toBeGreaterThanOrEqual(DIVE_HOLD_MAX_MS - 2 * DT);
      expect(e.phase).toBe("Formation");
      expect(e.path).toBeNull();
    });
  }

  it("Grunts are unchanged: they launch the planned dive whatever is in the way", () => {
    const e = diver("Grunt");
    const wall = rockAt(e.formationX, e.formationY + 190, 0, 0, { radius: 150 });
    seedRng(5);
    const plain = launch(e, []).path;
    seedRng(5);
    const out = launch(e, [wall]);
    expect(out.phase).toBe("Diving");
    expect(out.path).toEqual(plain);
  });
});

// ---------------------------------------------------------------------------

describe("Rocks still bite (#3131 protected feature)", () => {
  it("a rock already on course to hit the braced Carrier still hits it", () => {
    let s = tick(exposedWave(), DT, ASIDE);
    const c0 = carrierOf(s);
    s = patch(s, (e) => e.tier === "Carrier", {
      runPhase: "brace",
      runTimer: 1,
      beamTimer: 1e9,
      shootTimer: 1e9,
      diveTargetX: CANVAS_W * 0.5,
      y: c0.formationY,
    });
    // coming straight at the Carrier's station from the side
    s = { ...s, asteroids: [rockAt(c0.x - 70, c0.formationY, 0.2, 0)] };
    let hit = false;
    for (let t = 0; t < 1500 && !hit; t += DT) {
      s = tick(s, DT, ASIDE);
      hit = carrierOf(s).hp < TIER_HP.Carrier;
    }
    expect(hit).toBe(true);
  });

  it("no immunity: an exposed Carrier and an Elite touching a rock both take damage", () => {
    for (const tier of ["Carrier", "Elite"] as const) {
      let s = tick(exposedWave(), DT, ASIDE);
      const ship = s.enemies.find((e) => e.isAlive && e.tier === tier);
      if (!ship) throw new Error(`no ${tier}`);
      s = patch(s, (e) => e.tier === "Carrier", { runTimer: 1e9, beamTimer: 1e9 });
      s = { ...s, asteroids: [rockAt(ship.x, ship.y, 0, 0)] };
      s = tick(s, DT, ASIDE);
      const after = s.enemies.find((e) => e.id === ship.id)!;
      expect(after.hp).toBeLessThan(ship.hp);
    }
  });

  it("the brace is unchanged with no rocks: the run commits right after the telegraph", () => {
    let s = tick(exposedWave(), DT, ASIDE);
    s = patch(s, (e) => e.tier === "Carrier", { runTimer: 1, beamTimer: 1e9 });
    let t = 0;
    while (carrierOf(s).phase !== "AttackRun" && t < 3000) {
      s = tick(s, DT, ASIDE);
      t += DT;
    }
    expect(t).toBeLessThanOrEqual(ATTACK_RUN_BRACE_MS + 3 * DT);
  });
});
