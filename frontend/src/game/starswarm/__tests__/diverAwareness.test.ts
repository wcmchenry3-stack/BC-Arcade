/**
 * #2881: diving ships stay committed but visibly react to a rock bearing down on them — a flinch
 * (aim degrade + wobble cue), flak at the rock paid out of the ship's own next shot, and a late
 * partial path nudge when the normal dodge did not happen. Covers every reacting phase, tier
 * ordering, the attention-debt invariant, the fixed dive endpoint, Circling, the per-phase
 * re-roll and determinism.
 */
import {
  initStarSwarm,
  tick,
  seedRng,
  CANVAS_W,
  CANVAS_H,
  ASTEROID_ATTENTION,
  ASTEROID_STATS,
  DODGE_PATH_NUDGE,
  FLINCH_CHANCE,
  FLINCH_MS,
  FLINCH_WOBBLE_PX,
  FLINCH_WOBBLE_TILT,
  LATE_NUDGE_CHANCE,
  LATE_NUDGE_PX,
  REACTION_PHASES,
} from "../engine";
import { flinchWobble } from "../render/flinch";
import { fitsSaveShape } from "../saveShape";
import type { Asteroid, CubicBezier, Enemy, EnemyTier, StarSwarmState } from "../types";

const DT = 16;
const ROCK_ID = 9100;
const ASIDE = { playerX: 40, fire: false } as const;

function settled(wave: number, seed = 42): StarSwarmState {
  let s = initStarSwarm(CANVAS_W, CANVAS_H, wave, seed, "LieutenantJG");
  s = { ...s, asteroidsDisabled: true };
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

/** A settled wave that has a formation ship of this tier (the tiers appear at different waves). */
function waveWith(tier: EnemyTier): { s: StarSwarmState; ship: Enemy } {
  for (let wave = 2; wave <= 12; wave++) {
    const s = settled(wave);
    const ship = s.enemies.find((e) => e.isAlive && e.tier === tier && e.phase === "Formation");
    if (ship) return { s, ship };
  }
  throw new Error(`no ${tier} in waves 2..12`);
}

const cubicAt = (c: CubicBezier, t: number) => {
  const u = 1 - t;
  return {
    x: u * u * u * c.p0.x + 3 * u * u * t * c.p1.x + 3 * u * t * t * c.p2.x + t * t * t * c.p3.x,
    y: u * u * u * c.p0.y + 3 * u * u * t * c.p1.y + 3 * u * t * t * c.p2.y + t * t * t * c.p3.y,
  };
};

type Phase = "Diving" | "Returning" | "Fleeing" | "Wiggling" | "Circling";

function makeRock(at: { x: number; y: number }): Asteroid {
  const vx = 0.166;
  const vy = 0.111;
  return {
    id: ROCK_ID,
    kind: "large",
    x: at.x - vx * 400,
    y: at.y - vy * 400,
    vx,
    vy,
    radius: ASTEROID_STATS.large.radius,
    hp: ASTEROID_STATS.large.hp,
    rotation: 0,
    spin: 0,
    hitFlashTimer: 0,
    hitEnemyIds: [],
  };
}

/** The ship, forced into `phase`, plus a large rock that will be on top of it 400 ms from now. */
function scenario(
  tier: EnemyTier,
  phase: Phase
): { s: StarSwarmState; id: number; rock: Asteroid; path: CubicBezier | null } {
  const { s: base, ship } = waveWith(tier);
  const x = ship.x;
  const y = 200;
  let patch: Partial<Enemy>;
  let path: CubicBezier | null = null;
  let at = { x, y };
  if (phase === "Circling") {
    patch = {
      phase,
      x: x + 30,
      y,
      circleCx: x,
      circleCy: y,
      circleRadius: 30,
      circleAngle: 0,
      circleSpeed: 0.0001, // effectively parked: the rock's aim point stays put
    };
    at = { x: x + 30, y };
  } else if (phase === "Wiggling") {
    patch = { phase, y, wiggleTimer: 2000, diveTargetX: x };
  } else {
    path = {
      p0: { x, y },
      p1: { x: x + 10, y: y + 120 },
      p2: { x: x - 10, y: y + 240 },
      p3: { x, y: y + 360 },
    };
    patch = { phase, path, pathT: 0, pathDuration: 2500, x, y, diveTargetX: x };
    at = cubicAt(path, 400 / 2500);
  }
  const rock = makeRock(at);
  const s: StarSwarmState = {
    ...base,
    asteroids: [rock],
    enemies: base.enemies.map((e) =>
      e.id === ship.id ? { ...e, ...patch, shootTimer: 1e9, hp: 99 } : e
    ),
  };
  return { s, id: ship.id, rock, path };
}

const byId = (s: StarSwarmState, id: number): Enemy => s.enemies.find((e) => e.id === id)!;
const after1 = (s: StarSwarmState, seed: number): StarSwarmState => {
  seedRng(seed);
  return tick(s, DT, ASIDE);
};
const SEEDS = Array.from({ length: 80 }, (_, i) => (i + 1) * 7919);

describe("Diver asteroid awareness (#2881)", () => {
  it.each(["Diving", "Returning", "Fleeing", "Wiggling", "Circling"] as const)(
    "%s: a threatened Grunt flinches, sometimes flaks, and pays the threat cost",
    (phase) => {
      const sc = scenario("Grunt", phase);
      let flaks = 0;
      for (const seed of SEEDS) {
        const after = after1(sc.s, seed);
        const e = byId(after, sc.id);
        expect(e.phase).toBe(phase);
        expect(e.rolledAsteroidIds).toContain(ROCK_ID);
        expect(e.attentionMs).toBeGreaterThan(0);
        // Grunt flinch chance is 1: always the wobble cue and the aim-degrade window
        expect(e.flinchMs).toBe(FLINCH_MS);
        expect(e.evadeMs).toBeGreaterThanOrEqual(FLINCH_MS);
        if (e.flakCooldown > 0) {
          flaks++;
          expect(after.enemyBullets.some((b) => b.flak)).toBe(true);
        }
      }
      expect(flaks).toBeGreaterThan(0);
      expect(flaks).toBeLessThan(SEEDS.length);
    }
  );

  it("a ship the rock does not threaten does not react", () => {
    const sc = scenario("Grunt", "Diving");
    const far: Asteroid = { ...sc.rock, x: sc.rock.x + 300 };
    for (const seed of SEEDS.slice(0, 20)) {
      const e = byId(after1({ ...sc.s, asteroids: [far] }, seed), sc.id);
      expect(e.flinchMs).toBe(0);
      expect(e.attentionMs).toBe(0);
      expect(e.flakCooldown).toBe(0);
    }
  });

  it.each(["Diving", "Returning", "Fleeing"] as const)(
    "%s: the late nudge moves only the control points, by 60 px, and only after a failed dodge",
    (phase) => {
      const sc = scenario("Elite", phase);
      const orig = sc.path!;
      let late = 0;
      let dodged = 0;
      for (const seed of SEEDS) {
        const e = byId(after1(sc.s, seed), sc.id);
        // the endpoint never moves: the dive stays committed
        expect(e.path!.p3).toEqual(orig.p3);
        expect(e.path!.p0.x).toBeCloseTo(orig.p0.x, 6);
        const d1 = e.path!.p1.x - orig.p1.x;
        expect(e.path!.p2.x - orig.p2.x).toBeCloseTo(d1, 6);
        const shift = Math.abs(d1);
        // nothing, the normal 40 px dodge, or the 60 px late nudge: never both
        if (shift < 1e-6) continue;
        if (Math.abs(shift - DODGE_PATH_NUDGE) < 1e-6) dodged++;
        else {
          expect(shift).toBeCloseTo(LATE_NUDGE_PX, 6);
          late++;
        }
      }
      expect(late).toBeGreaterThan(0);
      expect(dodged).toBeGreaterThan(0);
    }
  );

  it("the nudge keeps the ship where it is this tick (no teleport)", () => {
    const sc = scenario("Guardian", "Diving");
    const before = byId(sc.s, sc.id);
    for (const seed of SEEDS) {
      const e = byId(after1(sc.s, seed), sc.id);
      expect(Math.abs(e.x - before.x)).toBeLessThan(5);
    }
  });

  it("Circling is no longer skipped: detected, charged, flinching, and never path-nudged", () => {
    const sc = scenario("Elite", "Circling");
    let flinched = 0;
    for (const seed of SEEDS) {
      const e = byId(after1(sc.s, seed), sc.id);
      expect(e.rolledAsteroidIds).toContain(ROCK_ID);
      expect(e.attentionMs).toBeGreaterThanOrEqual(ASTEROID_ATTENTION.Elite.threatMs - DT);
      expect(e.dodge).toBeNull(); // no sidestep to perform while circling
      if (e.flinchMs > 0) flinched++;
    }
    expect(flinched).toBeGreaterThan(0);
  });

  it("tier ordering: Grunt flinches most, then Elite, Guardian, and the Carrier never", () => {
    expect(FLINCH_CHANCE.Grunt).toBeGreaterThan(FLINCH_CHANCE.Elite);
    expect(FLINCH_CHANCE.Elite).toBeGreaterThan(FLINCH_CHANCE.Guardian);
    expect(FLINCH_CHANCE.Guardian).toBeGreaterThan(FLINCH_CHANCE.Carrier);
    expect(FLINCH_CHANCE.Carrier).toBe(0);
    expect(LATE_NUDGE_CHANCE.Carrier).toBe(0);
    const rate = (tier: EnemyTier): number => {
      const sc = scenario(tier, "Diving");
      const seeds = Array.from({ length: 300 }, (_, i) => (i + 1) * 7919);
      return seeds.filter((sd) => byId(after1(sc.s, sd), sc.id).flinchMs > 0).length / seeds.length;
    };
    const g = rate("Grunt");
    const e = rate("Elite");
    const gd = rate("Guardian");
    expect(g).toBe(1);
    expect(g).toBeGreaterThan(e);
    expect(e).toBeGreaterThan(gd);
    expect(gd).toBeGreaterThan(0);
  });

  it("the exposed Carrier's AttackRun never evades or flinches", () => {
    const { s: base } = waveWith("Carrier");
    const carrier = base.enemies.find((e) => e.tier === "Carrier")!;
    const x = carrier.x;
    const path: CubicBezier = {
      p0: { x, y: 150 },
      p1: { x, y: 250 },
      p2: { x, y: 350 },
      p3: { x, y: 450 },
    };
    const rock = makeRock(cubicAt(path, 400 / 2500));
    for (const seed of SEEDS.slice(0, 30)) {
      const s: StarSwarmState = {
        ...base,
        asteroids: [rock],
        enemies: base.enemies
          .filter((e) => e.tier !== "Guardian")
          .map((e) =>
            e.tier === "Carrier"
              ? { ...e, phase: "AttackRun" as const, path, pathT: 0, pathDuration: 2500, x, y: 150 }
              : e
          ),
      };
      const c = byId(after1(s, seed), carrier.id);
      expect(c.flinchMs).toBe(0);
      expect(c.evadeMs).toBe(0);
      expect(c.dodge).toBeNull();
      expect(c.path!.p1.x).toBe(path.p1.x);
    }
  });

  it("the armored Carrier ignores rocks entirely", () => {
    const { s, ship } = waveWith("Carrier");
    const rock: Asteroid = {
      ...makeRock({ x: ship.x, y: ship.y }),
      x: ship.x - 60,
      y: ship.y - 40,
    };
    const c = byId(after1({ ...s, asteroids: [rock] }, 1), ship.id);
    expect(c.flinchMs).toBe(0);
    expect(c.evadeMs).toBe(0);
    expect(c.attentionMs).toBe(0);
  });

  it("attention debt: flak at a rock while diving delays the next player-directed shot", () => {
    const sc = scenario("Grunt", "Diving");
    let checked = 0;
    for (const seed of SEEDS) {
      const s0: StarSwarmState = {
        ...sc.s,
        enemies: sc.s.enemies.map((e) => (e.id === sc.id ? { ...e, shootTimer: 100 } : e)),
      };
      let s = after1(s0, seed);
      const e1 = byId(s, sc.id);
      if (e1.flakCooldown <= 0) continue; // this seed did not flak
      checked++;
      const debt = e1.attentionMs;
      expect(debt).toBeGreaterThanOrEqual(ASTEROID_ATTENTION.Grunt.flakMs - DT);
      expect(e1.shootTimer).toBeGreaterThanOrEqual(debt - 1e-9);
      s = { ...s, asteroids: [], playerBullets: [] };
      let shotAfter = Infinity;
      for (let i = 1; i <= 400; i++) {
        s = { ...s, enemyBullets: [] };
        s = tick(s, DT, ASIDE);
        if (s.enemyBullets.some((b) => !b.flak)) {
          shotAfter = i * DT;
          break;
        }
        if (byId(s, sc.id).phase !== "Diving") break;
      }
      // without the flak the shot would have left after ~100 ms; the debt pushes it back
      expect(shotAfter).toBeGreaterThanOrEqual(debt - 2 * DT);
      if (checked >= 3) break;
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("flak from a diver stays outside the bullet cap", () => {
    const sc = scenario("Guardian", "Diving");
    const filler = Array.from({ length: 60 }, (_, i) => ({
      id: 50_000 + i,
      x: 10 + i * 5,
      y: 20,
      vx: 0,
      vy: 0.2,
      owner: "enemy" as const,
      width: 4,
      height: 8,
      damage: 1,
    }));
    let saw = false;
    for (const seed of SEEDS) {
      const after = after1({ ...sc.s, enemyBullets: filler }, seed);
      if (after.enemyBullets.some((b) => b.flak)) saw = true;
    }
    expect(saw).toBe(true);
  });

  it("re-roll on dive: a ship that rolled in formation reacts once it dives, then not again", () => {
    const sc = scenario("Grunt", "Diving");
    // it already rolled (and reacted) against this rock while in formation
    const pre: StarSwarmState = {
      ...sc.s,
      enemies: sc.s.enemies.map((e) =>
        e.id === sc.id
          ? {
              ...e,
              rolledAsteroidIds: [ROCK_ID],
              reactedAsteroidIds: [ROCK_ID],
              reactedPhase: "Formation" as const,
            }
          : e
      ),
    };
    let s = after1(pre, 5);
    let e = byId(s, sc.id);
    expect(e.flinchMs).toBe(FLINCH_MS); // the dive earned a fresh opportunity
    expect(e.reactedAsteroidIds).toEqual([ROCK_ID]);
    expect(e.reactedPhase).toBe("Diving");
    // same phase, same rock: no per-tick spam — once the wobble has run out it stays out
    s = {
      ...s,
      enemies: s.enemies.map((x) => (x.id === sc.id ? { ...x, flinchMs: 0, evadeMs: 0 } : x)),
    };
    for (let i = 0; i < 10; i++) s = tick(s, DT, ASIDE);
    e = byId(s, sc.id);
    expect(e.flinchMs).toBe(0);
    expect(e.reactedAsteroidIds.length).toBeLessThanOrEqual(1);
    // a further phase change resets the list, so it is bounded by rocks-per-phase
    s = {
      ...s,
      enemies: s.enemies.map((x) => (x.id === sc.id ? { ...x, phase: "Returning" as const } : x)),
    };
    s = tick(s, DT, ASIDE);
    e = byId(s, sc.id);
    expect(e.reactedPhase).toBe("Returning");
    expect(e.flinchMs).toBeGreaterThan(0);
  });

  it("reactions cover exactly the path phases plus Wiggling and Circling", () => {
    expect([...REACTION_PHASES].sort()).toEqual(
      ["Circling", "Diving", "Fleeing", "Returning", "Wiggling"].sort()
    );
  });

  it("is deterministic under seedRng", () => {
    const sc = scenario("Elite", "Diving");
    const run = (seed: number): string => {
      seedRng(seed);
      let s = sc.s;
      for (let i = 0; i < 40; i++) s = tick(s, DT, ASIDE);
      return JSON.stringify(s.enemies.find((e) => e.id === sc.id));
    };
    for (const seed of [1, 7, 23]) expect(run(seed)).toBe(run(seed));
  });

  it("the new per-ship fields are part of the saved shape", () => {
    const s = settled(2);
    expect(fitsSaveShape(s)).toBe(true);
    for (const key of ["flinchMs", "reactedAsteroidIds", "reactedPhase"] as const) {
      const rest: Record<string, unknown> = { ...s.enemies[0]! };
      delete rest[key];
      expect(
        fitsSaveShape({ ...s, enemies: [rest as unknown as Enemy, ...s.enemies.slice(1)] })
      ).toBe(false);
    }
  });
});

describe("flinchWobble (#2881 render cue)", () => {
  it("is still when not flinching and bounded and decaying while flinching", () => {
    expect(flinchWobble(0)).toEqual({ dx: 0, rotate: 0 });
    let moved = false;
    for (let ms = FLINCH_MS; ms > 0; ms -= 5) {
      const w = flinchWobble(ms);
      expect(Math.abs(w.dx)).toBeLessThanOrEqual(FLINCH_WOBBLE_PX + 1e-9);
      expect(Math.abs(w.rotate)).toBeLessThanOrEqual(FLINCH_WOBBLE_TILT + 1e-9);
      if (Math.abs(w.dx) > 0.5) moved = true;
    }
    expect(moved).toBe(true);
    expect(flinchWobble(10)).toEqual(flinchWobble(10)); // pure
  });
});
