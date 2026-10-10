/**
 * #2844: asteroids as a consistent battlefield threat — broader entry geometry, localized enemy
 * response with an attention cost, Carrier armor vs asteroids, the beam rule, and the shared
 * threat/collision contract Buddy (#2845) consumes.
 */
import {
  initStarSwarm,
  tick,
  seedRng,
  throwAsteroid,
  CANVAS_W,
  CANVAS_H,
  MAX_ASTEROIDS,
  ASTEROID_STATS,
  ASTEROID_ATTENTION,
  ASTEROID_ENTRY_ATTEMPTS,
  ASTEROID_MIN_CROSS_FRAC,
  ASTEROID_MIN_REACTION_MS,
  CARRIER_FLAK_RANGE,
  DODGE_SIDESTEP_MS,
  BEAM_SPEED,
  BEAM_LENGTH,
  BEAM_HALF_WIDTH,
  asteroidAttention,
  withAsteroidAttention,
  degradeAim,
  planAsteroidEntry,
  asteroidEntryMetrics,
  asteroidThreatens,
  asteroidHits,
  asteroidHitsBox,
  enemyThreatCircle,
  carrierFlakRock,
  liveHazards,
  isCarrierArmored,
  type AsteroidEntryRegion,
  type ThreatCircle,
} from "../engine";
import { fitsSaveShape } from "../saveShape";
import type {
  Asteroid,
  AsteroidKind,
  CarrierBeam,
  Enemy,
  EnemyTier,
  StarSwarmInput,
  StarSwarmState,
} from "../types";

const ASIDE: StarSwarmInput = { playerX: 40, fire: false };
const DT = 16;

/** A small seeded PRNG (mulberry32) for the pure planners. */
function makeRand(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function rock(kind: AsteroidKind, x: number, y: number, vx = 0, vy = 0, id = 9000): Asteroid {
  return {
    id,
    kind,
    x,
    y,
    vx,
    vy,
    radius: ASTEROID_STATS[kind].radius,
    hp: ASTEROID_STATS[kind].hp,
    rotation: 0,
    spin: 0,
    hitFlashTimer: 0,
    hitEnemyIds: [],
  };
}

/** A wave settled into combat, nothing happening: no timed rocks, dives, stragglers or enemy fire. */
function settled(wave = 2, seed = 42): StarSwarmState {
  let s = initStarSwarm(CANVAS_W, CANVAS_H, wave, seed, "LieutenantJG");
  s = { ...s, asteroidsDisabled: true };
  while (s.phase === "SwoopIn") s = tick(s, DT, ASIDE);
  expect(s.phase).toBe("Playing");
  return {
    ...s,
    enemyBullets: [],
    explosions: [],
    nextDiveTimer: 1e9,
    pauseStraggler: true,
    player: { ...s.player, x: 40, invincibleTimer: 1e9 },
    // every gun parked; a test un-parks the ship it is about
    enemies: s.enemies.map((e) => ({ ...e, shootTimer: 1e9 })),
  };
}

const patchEnemy = (s: StarSwarmState, id: number, patch: Partial<Enemy>): StarSwarmState => ({
  ...s,
  enemies: s.enemies.map((e) => (e.id === id ? { ...e, ...patch } : e)),
});
const byId = (s: StarSwarmState, id: number): Enemy => s.enemies.find((e) => e.id === id)!;
const formationOf = (s: StarSwarmState, tier: EnemyTier): Enemy[] =>
  s.enemies.filter((e) => e.isAlive && e.tier === tier && e.phase === "Formation");

/** A rock closing on `e` from the upper left, well inside flak range and on a collision course. */
function rockAt(e: Enemy, kind: AsteroidKind = "large"): Asteroid {
  return rock(kind, e.x - 90, e.y - 60, 0.166, 0.111);
}

// ---------------------------------------------------------------------------
// Entry geometry
// ---------------------------------------------------------------------------

describe("Asteroid entry geometry (#2844)", () => {
  const SEEDS = Array.from({ length: 400 }, (_, i) => i + 1);
  const offScreen = (x: number, y: number, r: number) =>
    x + r <= 0 || x - r >= CANVAS_W || y + r <= 0 || y - r >= CANVAS_H;

  it("every plan starts fully off-screen, crosses the field and leaves reaction time", () => {
    for (const seed of SEEDS) {
      const rand = makeRand(seed);
      for (const kind of ["large", "small"] as const) {
        const r = ASTEROID_STATS[kind].radius;
        const plan = planAsteroidEntry(CANVAS_W, CANVAS_H, r, [], rand);
        if (!plan) continue;
        expect(offScreen(plan.x, plan.y, r)).toBe(true);
        // heads down (no flat skim) at the stated speed band
        expect(plan.vy).toBeGreaterThan(0);
        expect(Math.atan2(plan.vy, Math.abs(plan.vx))).toBeGreaterThanOrEqual(0.3 - 1e-9);
        const speed = Math.hypot(plan.vx, plan.vy);
        expect(speed).toBeGreaterThanOrEqual(0.15 - 1e-9);
        expect(speed).toBeLessThanOrEqual(0.22 + 1e-9);
        const m = asteroidEntryMetrics(plan, r, CANVAS_W, CANVAS_H);
        expect(m.crossPx).toBeGreaterThanOrEqual(ASTEROID_MIN_CROSS_FRAC * CANVAS_W);
        expect(m.reactionMs).toBeGreaterThanOrEqual(ASTEROID_MIN_REACTION_MS);
      }
    }
  });

  it("an independent step-through agrees: the rock does cross the field, not just touch a corner", () => {
    for (const seed of SEEDS.slice(0, 120)) {
      const r = ASTEROID_STATS.large.radius;
      const plan = planAsteroidEntry(CANVAS_W, CANVAS_H, r, [], makeRand(seed))!;
      expect(plan).not.toBeNull();
      let inside = 0;
      for (let t = 0; t < 40_000; t += 50) {
        const x = plan.x + plan.vx * t;
        const y = plan.y + plan.vy * t;
        if (x > 0 && x < CANVAS_W && y > 0 && y < CANVAS_H) inside += 50;
      }
      // at least ~0.5 W at 0.22 px/ms worst case is ~800 ms of in-field time
      expect(inside).toBeGreaterThanOrEqual((ASTEROID_MIN_CROSS_FRAC * CANVAS_W) / 0.22 - 100);
    }
  });

  it("a landscape canvas always yields a fair plan: no timed spawn is silently dropped", () => {
    const W = 844;
    const H = 390;
    for (const seed of SEEDS) {
      const rand = makeRand(seed);
      for (const kind of ["large", "small"] as const) {
        const r = ASTEROID_STATS[kind].radius;
        const plan = planAsteroidEntry(W, H, r, [], rand);
        expect(plan).not.toBeNull();
        const p = plan!;
        expect(p.x + r <= 0 || p.x - r >= W || p.y + r <= 0 || p.y - r >= H).toBe(true);
        expect(Math.atan2(p.vy, Math.abs(p.vx))).toBeGreaterThanOrEqual(0.3 - 1e-9);
        const m = asteroidEntryMetrics(p, r, W, H);
        expect(m.crossPx).toBeGreaterThanOrEqual(ASTEROID_MIN_CROSS_FRAC * W);
        expect(m.reactionMs).toBeGreaterThanOrEqual(ASTEROID_MIN_REACTION_MS);
      }
    }
  });

  it("uses every region: side edges, the top edge and both upper corners", () => {
    const seen = new Set<AsteroidEntryRegion>();
    for (const seed of SEEDS) {
      const plan = planAsteroidEntry(CANVAS_W, CANVAS_H, 22, [], makeRand(seed));
      if (plan) seen.add(plan.region);
    }
    expect([...seen].sort()).toEqual(["left", "right", "top", "topLeft", "topRight"]);
  });

  it("entry points are varied: left/right edge bands and the top edge are broad, not a fixed line", () => {
    const leftY: number[] = [];
    const topX: number[] = [];
    for (const seed of SEEDS) {
      const plan = planAsteroidEntry(CANVAS_W, CANVAS_H, 22, [], makeRand(seed))!;
      if (plan.region === "left") leftY.push(plan.y);
      if (plan.region === "top") topX.push(plan.x);
    }
    expect(Math.max(...leftY) - Math.min(...leftY)).toBeGreaterThan(CANVAS_H * 0.3);
    expect(Math.max(...topX) - Math.min(...topX)).toBeGreaterThan(CANVAS_W * 0.5);
  });

  it("never starts overlapping an actor, even one waiting off-screen", () => {
    // a ship parked right where a left-edge rock would enter, and one above the top edge
    const actors: ThreatCircle[] = [
      { x: -20, y: 120, r: 70 },
      { x: 180, y: -20, r: 70 },
    ];
    for (const seed of SEEDS) {
      const r = ASTEROID_STATS.large.radius;
      const plan = planAsteroidEntry(CANVAS_W, CANVAS_H, r, actors, makeRand(seed));
      if (!plan) continue;
      for (const a of actors) {
        expect(Math.hypot(plan.x - a.x, plan.y - a.y)).toBeGreaterThan(a.r + r);
      }
    }
  });

  it("gives up (null) rather than spawn unfairly when every attempt is blocked", () => {
    const everywhere: ThreatCircle = { x: CANVAS_W / 2, y: CANVAS_H / 2, r: 2000 };
    expect(planAsteroidEntry(CANVAS_W, CANVAS_H, 22, [everywhere], makeRand(1))).toBeNull();
    // attempts are bounded: a rand that counts its draws proves the loop terminates
    let draws = 0;
    planAsteroidEntry(CANVAS_W, CANVAS_H, 22, [everywhere], () => {
      draws++;
      return 0.5;
    });
    expect(draws).toBeLessThanOrEqual(ASTEROID_ENTRY_ATTEMPTS * 8);
  });

  it("is deterministic for a given rand stream and almost always finds a fair path", () => {
    let nulls = 0;
    for (const seed of SEEDS) {
      const a = planAsteroidEntry(CANVAS_W, CANVAS_H, 22, [], makeRand(seed));
      const b = planAsteroidEntry(CANVAS_W, CANVAS_H, 22, [], makeRand(seed));
      expect(a).toEqual(b);
      if (!a) nulls++;
    }
    expect(nulls / SEEDS.length).toBeLessThan(0.02);
  });

  it("engine spawns are deterministic under seedRng and respect the in-flight cap", () => {
    const run = (seed: number) => {
      let s = settled(3, seed);
      seedRng(seed);
      s = { ...s, asteroidsDisabled: false, nextAsteroidTimer: 0 };
      const log: number[] = [];
      let peak = 0;
      for (let i = 0; i < 1200; i++) {
        s = tick(s, DT, ASIDE);
        peak = Math.max(peak, s.asteroids.length);
        if (i % 50 === 0) log.push(...s.asteroids.map((a) => Math.round(a.x * 100 + a.y)));
      }
      return { log, peak };
    };
    for (const seed of [3, 11]) {
      const a = run(seed);
      expect(a).toEqual(run(seed));
      expect(a.peak).toBeGreaterThan(0);
      expect(a.peak).toBeLessThanOrEqual(MAX_ASTEROIDS);
    }
  });

  it("throwAsteroid places a fully off-screen rock across many seeds and honours the cap", () => {
    for (const seed of SEEDS.slice(0, 30)) {
      seedRng(seed);
      let s = settled(2, seed);
      seedRng(seed);
      s = throwAsteroid(s, "large");
      if (s.asteroids.length === 0) continue; // a blocked plan is allowed to decline
      const a = s.asteroids[0]!;
      expect(offScreen(a.x, a.y, a.radius)).toBe(true);
      s = throwAsteroid(throwAsteroid(throwAsteroid(s)));
      expect(s.asteroids.length).toBeLessThanOrEqual(MAX_ASTEROIDS);
    }
  });
});

// ---------------------------------------------------------------------------
// Localized response and the attention cost
// ---------------------------------------------------------------------------

describe("Asteroid attention cost (#2844)", () => {
  it("tier discipline: Grunt most distracted, then Elite, Guardian, Carrier least", () => {
    const order: EnemyTier[] = ["Grunt", "Elite", "Guardian", "Carrier"];
    for (const key of ["threatMs", "flakMs", "aimSpread"] as const) {
      for (let i = 0; i < order.length - 1; i++) {
        expect(asteroidAttention(order[i]!)[key]).toBeGreaterThan(
          asteroidAttention(order[i + 1]!)[key]
        );
      }
    }
    // every tier pays something, and flak costs more than merely being threatened
    for (const t of order) {
      expect(ASTEROID_ATTENTION[t].threatMs).toBeGreaterThan(0);
      expect(ASTEROID_ATTENTION[t].flakMs).toBeGreaterThan(ASTEROID_ATTENTION[t].threatMs);
    }
    // the same ordering holds through the timer helper
    const cost = (t: EnemyTier) => withAsteroidAttention(100, t, "flak") - 100;
    expect(cost("Grunt")).toBeGreaterThan(cost("Elite"));
    expect(cost("Elite")).toBeGreaterThan(cost("Guardian"));
    expect(cost("Guardian")).toBeGreaterThan(cost("Carrier"));
    expect(withAsteroidAttention(-50, "Grunt", "threat")).toBe(ASTEROID_ATTENTION.Grunt.threatMs);
  });

  it("only a threatened ship is distracted; a far-away one is untouched", () => {
    const base = settled(2);
    const grunts = formationOf(base, "Grunt").sort((a, b) => a.x - b.x);
    const near = grunts[0]!;
    const far = grunts[grunts.length - 1]!;
    expect(far.x - near.x).toBeGreaterThan(150);
    let s = patchEnemy(base, near.id, { shootTimer: 5000 });
    s = patchEnemy(s, far.id, { shootTimer: 5000 });
    s = { ...s, flakDisabled: true, asteroids: [rockAt(near)] };
    const after = tick(s, DT, ASIDE);
    // the far ship just ran its clock down; the threatened one was pushed back
    expect(byId(after, far.id).shootTimer).toBe(5000 - DT);
    expect(byId(after, near.id).shootTimer).toBe(5000 - DT + ASTEROID_ATTENTION.Grunt.threatMs);
  });

  it("a rock flying away, or well clear, distracts nobody", () => {
    const base = settled(2);
    const g = formationOf(base, "Grunt")[0]!;
    let s = patchEnemy(base, g.id, { shootTimer: 5000 });
    s = { ...s, flakDisabled: true };
    const awayRock = rock("large", g.x - 60, g.y - 40, -0.2, -0.1);
    const clearRock = rock("large", g.x + 300, g.y + 300, 0.2, 0.1);
    for (const r of [awayRock, clearRock]) {
      const after = tick({ ...s, asteroids: [r] }, DT, ASIDE);
      expect(byId(after, g.id).shootTimer).toBe(5000 - DT);
    }
  });

  it("the threat distraction is once per rock, not per tick", () => {
    const base = settled(2);
    const g = formationOf(base, "Grunt")[0]!;
    let s = patchEnemy(base, g.id, { shootTimer: 5000 });
    s = { ...s, flakDisabled: true, asteroids: [rockAt(g)] };
    let prev = byId(s, g.id).shootTimer;
    let bumps = 0;
    for (let i = 0; i < 6; i++) {
      s = tick(s, DT, ASIDE);
      const now = byId(s, g.id);
      if (now.shootTimer > prev) bumps++;
      prev = now.shootTimer;
    }
    expect(bumps).toBe(1);
  });

  it("tiers pay in order when the same rock threatens each (Grunt > Elite > Guardian)", () => {
    const deltas: number[] = [];
    for (const tier of ["Grunt", "Elite", "Guardian"] as const) {
      const base = settled(2);
      const e = formationOf(base, "Grunt")[0]!;
      let s = patchEnemy(base, e.id, { tier, shootTimer: 5000, hp: 99 });
      s = { ...s, flakDisabled: true, asteroids: [rockAt(e)] };
      const after = tick(s, DT, ASIDE);
      deltas.push(byId(after, e.id).shootTimer - 5000);
    }
    // Grunt/Elite also tick their clock down; Guardian (passive) does not — still strictly ordered
    expect(deltas[0]!).toBeGreaterThan(deltas[1]!);
    expect(deltas[1]!).toBeGreaterThan(deltas[2]!);
  });

  it("flak costs the ship its next player-directed shot: it is delayed by at least the flak cost", () => {
    const FIRE_AT = 300; // ms until the ship would fire at the player
    // control: same ship, no rock — when does its first player-directed shot leave?
    const firstShotTick = (withRock: boolean, seed: number) => {
      const base = settled(2, 42);
      const g = formationOf(base, "Grunt")[0]!;
      let s = patchEnemy(base, g.id, { shootTimer: FIRE_AT, flakCooldown: 0 });
      s = { ...s, dodgeDisabled: true, player: { ...s.player, x: g.x, invincibleTimer: 1e9 } };
      if (withRock) s = { ...s, asteroids: [rockAt(g)] };
      seedRng(seed);
      let flakSeen = false;
      let flakTick = Infinity;
      for (let i = 1; i <= 400; i++) {
        s = tick(s, DT, { playerX: g.x, fire: false });
        if (!flakSeen && byId(s, g.id).flakCooldown > 0) {
          flakSeen = true;
          flakTick = i;
        }
        if (s.enemyBullets.some((b) => !b.flak)) return { tick: i, flakSeen, flakTick };
      }
      return { tick: Infinity, flakSeen, flakTick };
    };
    const control = firstShotTick(false, 1);
    expect(Number.isFinite(control.tick)).toBe(true);
    let flaked = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const r = firstShotTick(true, seed);
      // only a flak burst that came before the shot was due can delay it
      if (!r.flakSeen || r.flakTick >= control.tick) continue;
      flaked++;
      const delayedMs = (r.tick - control.tick) * DT;
      expect(delayedMs).toBeGreaterThanOrEqual(ASTEROID_ATTENTION.Grunt.flakMs - 2 * DT);
    }
    expect(flaked).toBeGreaterThan(0); // the seeded flak roll did fire in some runs
  });

  it("a rock passing near but not threatening a ship causes no flak and no timer cost", () => {
    const base = settled(2);
    const g = formationOf(base, "Grunt").sort((a, b) => a.x - b.x)[0]!;
    // approaching (closing distance), inside flak range, but its line passes ~60 px wide of the ship
    const passing = rock("large", g.x - 60, g.y - 50, 0, 0.2);
    for (let seed = 1; seed <= 40; seed++) {
      seedRng(seed);
      const s = { ...patchEnemy(base, g.id, { shootTimer: 5000 }), asteroids: [passing] };
      const after = tick(s, DT, ASIDE);
      const e = byId(after, g.id);
      expect(e.flakCooldown).toBe(0);
      expect(e.shootTimer).toBe(5000 - DT);
      expect(e.attentionMs).toBe(0);
      expect(after.tierStats.Grunt.flak).toBe(0);
    }
  });

  it("the attention debt survives a dive launch: a flaking Grunt can't shoot the player early", () => {
    const FLAK_AT = 1;
    let done = 0;
    for (let seed = 1; seed <= 40 && done < 3; seed++) {
      const base = settled(2);
      const g = formationOf(base, "Grunt")[0]!;
      let s = patchEnemy(base, g.id, { shootTimer: 100 });
      s = { ...s, dodgeDisabled: true, asteroids: [rockAt(g)], player: { ...s.player, x: g.x } };
      seedRng(seed);
      s = tick(s, DT, { playerX: g.x, fire: false });
      if (byId(s, g.id).flakCooldown <= 0) continue; // this seed's flak roll missed
      done++;
      const debt = byId(s, g.id).attentionMs;
      expect(debt).toBeGreaterThanOrEqual(ASTEROID_ATTENTION.Grunt.flakMs - DT);
      // launched on a dive the next instant (tickWiggling zeroes shootTimer), rock gone
      s = patchEnemy({ ...s, asteroids: [] }, g.id, {
        phase: "Wiggling",
        wiggleTimer: 1,
        diveTargetX: g.x,
      });
      let shotAfterMs = Infinity;
      for (let i = 1; i <= 200; i++) {
        s = { ...s, enemyBullets: [] };
        s = tick(s, DT, { playerX: g.x, fire: false });
        if (s.enemyBullets.some((b) => !b.flak)) {
          shotAfterMs = i * DT;
          break;
        }
      }
      expect(byId(s, g.id).phase).not.toBe("Formation");
      // it may not fire at the player until the debt has run out (one tick of slack)
      expect(shotAfterMs).toBeGreaterThanOrEqual(debt - 2 * DT - FLAK_AT);
    }
    expect(done).toBeGreaterThan(0);
  });

  it("a threatened ship that is already Wiggling keeps its debt through Wiggling to Diving", () => {
    let checked = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const base = settled(2);
      const g = formationOf(base, "Grunt")[0]!;
      // mid-wiggle, about to launch (the launch zeroes shootTimer); sturdy so the rock can't kill it
      let s = patchEnemy(base, g.id, {
        phase: "Wiggling",
        wiggleTimer: 40,
        diveTargetX: g.x,
        shootTimer: 100,
        hp: 99,
      });
      s = { ...s, asteroids: [rockAt(g)], player: { ...s.player, x: g.x } };
      seedRng(seed);
      s = tick(s, DT, { playerX: g.x, fire: false });
      const debt = byId(s, g.id).attentionMs;
      expect(debt).toBeGreaterThan(0); // threatened while wiggling, so it pays the threat cost
      s = { ...s, asteroids: [] };
      let shotAfterMs = Infinity;
      let dived = false;
      for (let i = 1; i <= 200; i++) {
        s = { ...s, enemyBullets: [] };
        s = tick(s, DT, { playerX: g.x, fire: false });
        if (byId(s, g.id).phase === "Diving") dived = true;
        if (s.enemyBullets.some((b) => !b.flak)) {
          shotAfterMs = i * DT;
          break;
        }
      }
      expect(dived).toBe(true);
      expect(shotAfterMs).toBeGreaterThanOrEqual(debt - 2 * DT);
      checked++;
    }
    expect(checked).toBe(10);
  });

  it("the debt also holds against the straggler rule's timer cap", () => {
    const base = settled(2);
    const g = formationOf(base, "Grunt")[0]!;
    const s = patchEnemy(base, g.id, { shootTimer: 50, attentionMs: 900 });
    // the straggler rule would cap the timer at SHOOT_INTERVAL_BASE / 2; the floor still holds
    const after = tick({ ...s, pauseStraggler: false, stragglerEnabled: true }, DT, ASIDE);
    expect(byId(after, g.id).shootTimer).toBeGreaterThanOrEqual(byId(after, g.id).attentionMs);
  });

  it("flak stays outside the global bullet cap but does not add player-directed pressure", () => {
    const base = settled(2);
    const g = formationOf(base, "Grunt")[0]!;
    // the cap is already full of player-directed shots: flak still leaves, nothing else does
    const filler = Array.from({ length: 40 }, (_, i) => ({
      id: 80_000 + i,
      x: 5 + i * 8,
      y: CANVAS_H - 5,
      vx: 0,
      vy: 0,
      owner: "enemy" as const,
      width: 4,
      height: 8,
      damage: 1,
    }));
    let flak = 0;
    for (let seed = 1; seed <= 40; seed++) {
      seedRng(seed);
      let s = patchEnemy(base, g.id, { shootTimer: 5000 });
      s = { ...s, enemyBullets: filler, asteroids: [rockAt(g)], dodgeDisabled: true };
      const after = tick(s, DT, ASIDE);
      flak += after.enemyBullets.filter((b) => b.flak).length;
      expect(after.enemyBullets.filter((b) => !b.flak).length).toBeLessThanOrEqual(40);
    }
    expect(flak).toBeGreaterThan(0);
  });

  it("degradeAim: a real miss-angle every time, bigger for the more distracted tiers, bounded by the spread", () => {
    const rand = makeRand(7);
    const dev = (tier: EnemyTier) => {
      let min = Infinity;
      let max = 0;
      let sum = 0;
      for (let i = 0; i < 400; i++) {
        const out = degradeAim(0, 0.3, tier, rand);
        expect(out.vy).toBe(0.3);
        const d = Math.abs(out.vx);
        min = Math.min(min, d);
        max = Math.max(max, d);
        sum += d;
      }
      const spread = ASTEROID_ATTENTION[tier].aimSpread * 0.3;
      expect(min).toBeGreaterThanOrEqual(0.5 * spread - 1e-12);
      expect(max).toBeLessThanOrEqual(spread + 1e-12);
      return sum / 400;
    };
    const means = (["Grunt", "Elite", "Guardian", "Carrier"] as const).map(dev);
    expect(means[0]!).toBeGreaterThan(means[1]!);
    expect(means[1]!).toBeGreaterThan(means[2]!);
    expect(means[2]!).toBeGreaterThan(means[3]!);
  });

  it("an evading ship still fires, but its player-directed aim is degraded; a steady one is on target", () => {
    const shot = (evadeMs: number, seed: number) => {
      const base = settled(3);
      // a mid-field Elite, so the player can sit directly below it without hitting the edge clamp
      const e = formationOf(base, "Elite").sort(
        (a, b) => Math.abs(a.x - CANVAS_W / 2) - Math.abs(b.x - CANVAS_W / 2)
      )[0]!;
      let s = patchEnemy(base, e.id, { shootTimer: 0, evadeMs });
      s = { ...s, player: { ...s.player, x: e.x, invincibleTimer: 1e9 } };
      seedRng(seed);
      const after = tick(s, DT, { playerX: e.x, fire: false });
      return after.enemyBullets.filter((b) => !b.flak);
    };
    for (let seed = 1; seed <= 6; seed++) {
      const steady = shot(0, seed);
      expect(steady).toHaveLength(1);
      expect(steady[0]!.vx).toBe(0); // dead-on: the player is directly below
      const evading = shot(400, seed);
      expect(evading).toHaveLength(1); // it still fires
      const spread = ASTEROID_ATTENTION.Elite.aimSpread * Math.abs(evading[0]!.vy);
      expect(Math.abs(evading[0]!.vx)).toBeGreaterThanOrEqual(0.5 * spread - 1e-9);
      expect(Math.abs(evading[0]!.vx)).toBeLessThanOrEqual(spread + 1e-9);
    }
  });

  it("a successful dodge starts the evade window, which then runs out", () => {
    const base = settled(2);
    const g = formationOf(base, "Grunt")[0]!;
    let s = patchEnemy(base, g.id, { shootTimer: 1e9 });
    let started = false;
    for (let seed = 1; seed <= 60 && !started; seed++) {
      seedRng(seed);
      const t = tick({ ...s, flakDisabled: true, asteroids: [rockAt(g)] }, DT, ASIDE);
      const e = byId(t, g.id);
      if (e.dodge) {
        started = true;
        expect(e.evadeMs).toBeGreaterThan(0);
        expect(e.evadeMs).toBeLessThanOrEqual(DODGE_SIDESTEP_MS);
        s = t;
      }
    }
    expect(started).toBe(true);
    s = { ...s, asteroids: [] };
    for (let i = 0; i < Math.ceil(DODGE_SIDESTEP_MS / DT) + 2; i++) s = tick(s, DT, ASIDE);
    expect(byId(s, g.id).evadeMs).toBe(0);
  });

  it("the new per-ship state is part of the saved shape", () => {
    expect(fitsSaveShape(settled(2))).toBe(true);
    const s = settled(2);
    const { evadeMs: _drop, ...rest } = s.enemies[0]!;
    void _drop;
    expect(fitsSaveShape({ ...s, enemies: [rest, ...s.enemies.slice(1)] })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Carrier vs asteroids
// ---------------------------------------------------------------------------

describe("Carrier vs asteroids (#2844)", () => {
  const carrierOf = (s: StarSwarmState): Enemy =>
    s.enemies.find((e) => e.isAlive && e.tier === "Carrier")!;
  const killGuardians = (s: StarSwarmState): StarSwarmState => ({
    ...s,
    carrierStage: "exposed", // as if the Carrier had already acted on its new stage
    enemies: s.enemies.map((e) => (e.tier === "Guardian" ? { ...e, isAlive: false, hp: 0 } : e)),
  });
  /** A rock resting on the Carrier's hull (small: it shatters on its first hit). */
  const restingOn = (c: Enemy) => rock("small", c.x, c.y);

  it("armored: the force field shatters the rock and the Carrier takes no damage", () => {
    const s = settled(5); // boss wave: Carrier + four Guardians
    expect(isCarrierArmored(s)).toBe(true);
    const c = carrierOf(s);
    const after = tick({ ...s, asteroids: [restingOn(c)] }, DT, ASIDE);
    expect(carrierOf(after).hp).toBe(c.hp);
    expect(after.runStats.armorDeflects).toBe(s.runStats.armorDeflects + 1);
    expect(after.asteroids).toHaveLength(0); // shattered, no split
  });

  it("the armor transition: immune while a Guardian lives, vulnerable the moment the last falls", () => {
    let s = settled(5);
    const c0 = carrierOf(s);
    // three of four Guardians down: still armored, still immune
    const guardians = s.enemies.filter((e) => e.tier === "Guardian");
    s = {
      ...s,
      enemies: s.enemies.map((e) =>
        e.id === guardians[0]!.id || e.id === guardians[1]!.id || e.id === guardians[2]!.id
          ? { ...e, isAlive: false, hp: 0 }
          : e
      ),
    };
    expect(isCarrierArmored(s)).toBe(true);
    let t = tick({ ...s, asteroids: [restingOn(carrierOf(s))] }, DT, ASIDE);
    expect(carrierOf(t).hp).toBe(c0.hp);
    // the last Guardian dies: armor gone, the very next rock hurts
    s = killGuardians(t);
    expect(isCarrierArmored(s)).toBe(false);
    t = tick({ ...s, asteroids: [restingOn(carrierOf(s))] }, DT, ASIDE);
    expect(carrierOf(t).hp).toBe(c0.hp - 1);
    expect(t.asteroids).toHaveLength(0);
    // …and a rock does not pay out or count as a deflection
    expect(t.runStats.armorDeflects).toBe(s.runStats.armorDeflects);
    expect(t.score).toBe(s.score);
  });

  it("immunity follows the armor, not the tier: the same Carrier is hurt with no Guardian left", () => {
    const armored = settled(5);
    const open = killGuardians(armored);
    const hp = (st: StarSwarmState) => {
      const c = carrierOf(st);
      return carrierOf(tick({ ...st, asteroids: [restingOn(c)] }, DT, ASIDE)).hp;
    };
    expect(hp(armored)).toBe(carrierOf(armored).hp);
    expect(hp(open)).toBeLessThan(carrierOf(open).hp);
  });

  it("a rock that kills an exposed Carrier still drops its hull plating, and awards nothing", () => {
    let s = killGuardians(settled(5));
    const c = carrierOf(s);
    s = patchEnemy(s, c.id, { hp: 1 });
    const after = tick({ ...s, asteroids: [restingOn(c)] }, DT, ASIDE);
    expect(after.enemies.find((e) => e.id === c.id)!.isAlive).toBe(false);
    expect(after.powerUps.some((p) => p.type === "hull")).toBe(true);
    // the rock took the last ship: the wave is clear, and waits for the plating (#3132)
    expect(after.phase).toBe("ClearAwaitingPickups");
  });

  // #3131: the run is vetted against on-screen rocks when it commits (pathVetting.test.ts); once
  // committed it is never steered, which is what this guards
  it("the Carrier stays heavy: no sidestep or path nudge, however threatened", () => {
    let s = killGuardians(settled(5));
    const c = carrierOf(s);
    s = patchEnemy(s, c.id, { shootTimer: 1e9, beamTimer: 1e9, runTimer: 1e9 });
    for (let seed = 1; seed <= 30; seed++) {
      seedRng(seed);
      const t = tick({ ...s, asteroids: [rockAt(c)] }, DT, ASIDE);
      const after = carrierOf(t);
      expect(after.dodge).toBeNull();
      expect(after.evadeMs).toBe(0);
      expect(after.path).toBeNull();
    }
  });

  it("exposed: an approaching rock diverts the twin volley to flak, replacing (not adding to) fire", () => {
    let s = killGuardians(settled(5));
    const c = carrierOf(s);
    s = patchEnemy(s, c.id, { shootTimer: 0, beamTimer: 1e9, runTimer: 1e9 });
    s = { ...s, player: { ...s.player, x: c.x, invincibleTimer: 1e9 } };

    // the first volley that leaves: (ticks until it does, its bolts). A rock bearing down also takes
    // the Carrier's attention (threatMs), so the diverted volley is a little later, never extra.
    const firstVolley = (withRock: boolean) => {
      let t = s;
      for (let i = 1; i <= 20; i++) {
        t = tick(withRock ? { ...t, asteroids: [rockAt(carrierOf(t))] } : t, DT, {
          playerX: c.x,
          fire: false,
        });
        if (t.enemyBullets.length > 0) return { i, shots: t.enemyBullets, t };
      }
      throw new Error("no volley");
    };
    const control = firstVolley(false);
    expect(control.shots).toHaveLength(2);
    expect(control.shots.every((b) => !b.flak)).toBe(true);

    const diverted = firstVolley(true);
    // the same two guns fired, but both bolts went at the rock: none at the player
    expect(diverted.shots).toHaveLength(control.shots.length);
    expect(diverted.shots.every((b) => b.flak)).toBe(true);
    expect(diverted.shots.filter((b) => !b.flak)).toHaveLength(0);
    // paid for with attention: the volley left later than the undisturbed one, never sooner
    expect(diverted.i).toBeGreaterThanOrEqual(control.i);
    expect(carrierOf(diverted.t).shootTimer).toBeGreaterThan(0);
    expect(diverted.t.tierStats.Carrier.flak).toBe(2);
  });

  it("the diverted volley replaces player-directed pressure over time, it never adds cadence", () => {
    const run = (withRock: boolean) => {
      let s = killGuardians(settled(5));
      const c = carrierOf(s);
      s = patchEnemy(s, c.id, { shootTimer: 0, beamTimer: 1e9, runTimer: 1e9 });
      s = { ...s, player: { ...s.player, x: c.x, invincibleTimer: 1e9 } };
      seedRng(5);
      let volleys = 0;
      let playerShots = 0;
      let seenIds = new Set<number>();
      for (let i = 0; i < 300; i++) {
        // a rock is always on its way in while the flag is on
        const cur = carrierOf(s);
        if (withRock)
          s = { ...s, asteroids: [rock("large", cur.x - 90, cur.y - 60, 0.166, 0.111, 7000 + i)] };
        s = tick(s, DT, { playerX: c.x, fire: false });
        s = { ...s, asteroids: [] };
        const fresh = s.enemyBullets.filter((b) => !seenIds.has(b.id));
        seenIds = new Set([...seenIds, ...fresh.map((b) => b.id)]);
        if (fresh.length > 0) volleys++;
        playerShots += fresh.filter((b) => !b.flak).length;
        s = { ...s, enemyBullets: [] };
      }
      return { volleys, playerShots };
    };
    const calm = run(false);
    const busy = run(true);
    expect(calm.playerShots).toBeGreaterThan(0);
    // the same number of volleys (same timer) — but the player sees far fewer of them
    expect(busy.volleys).toBeLessThanOrEqual(calm.volleys);
    expect(busy.playerShots).toBeLessThan(calm.playerShots);
  });

  it("an armored Carrier never flaks; carrierFlakRock picks the nearest approaching rock in range", () => {
    const c = { x: 180, y: 60 };
    const near = rock("small", 180 - 100, 60 - 40, 0.1, 0.05, 1);
    const nearer = rock("small", 180 - 40, 60 - 40, 0.1, 0.1, 2);
    const leaving = rock("small", 180 - 20, 60 - 20, -0.1, -0.1, 3);
    const far = rock("small", 180 - CARRIER_FLAK_RANGE - 50, 60 - 10, 0.1, 0.0, 4);
    expect(carrierFlakRock(c, [near, nearer, leaving, far], true)).toBeNull();
    expect(carrierFlakRock(c, [near, nearer, leaving, far], false)).toBe(nearer);
    expect(carrierFlakRock(c, [leaving, far], false)).toBeNull();
    expect(carrierFlakRock(c, [{ ...nearer, hp: 0 }], false)).toBeNull();
    // and end to end: armored Carrier, rock closing — no volley at all
    const s = settled(5);
    const car = s.enemies.find((e) => e.tier === "Carrier")!;
    const armored = tick({ ...s, asteroids: [rockAt(car)] }, DT, ASIDE);
    expect(armored.tierStats.Carrier.flak).toBe(0); // (a Guardian beside it may still flak)
  });
});

// ---------------------------------------------------------------------------
// Beams and asteroids
// ---------------------------------------------------------------------------

describe("Carrier beam vs asteroids (#2844)", () => {
  const beamAt = (x: number, y: number): CarrierBeam => ({
    id: 71_001,
    x,
    y,
    vy: BEAM_SPEED,
    length: BEAM_LENGTH,
    halfWidth: BEAM_HALF_WIDTH,
  });

  it("a released beam and a rock pass through each other: neither is absorbed, neither is damaged", () => {
    let s = settled(2);
    s = { ...s, carrierBeams: [beamAt(200, 260)], asteroids: [rock("large", 200, 240)] };
    const r0 = s.asteroids[0]!;
    for (let i = 0; i < 10; i++) s = tick(s, DT, ASIDE);
    expect(s.carrierBeams).toHaveLength(1);
    expect(s.carrierBeams[0]!.id).toBe(71_001);
    const r = s.asteroids.find((a) => a.id === r0.id)!;
    expect(r.hp).toBe(r0.hp);
    expect(s.asteroids).toHaveLength(1);
  });

  it("both stay in liveHazards, so the extraction autopilot dodges the pair", () => {
    let s = settled(2);
    s = { ...s, carrierBeams: [beamAt(200, 100)], asteroids: [rock("small", 100, 100)] };
    const hz = liveHazards(s);
    expect(hz.some((h) => h.r === BEAM_HALF_WIDTH)).toBe(true);
    expect(hz.some((h) => h.r === ASTEROID_STATS.small.radius)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Shared threat / collision contract (Buddy)
// ---------------------------------------------------------------------------

describe("Shared asteroid threat and collision contract (#2844)", () => {
  const still: ThreatCircle = { x: 200, y: 400, r: 17 };

  it("asteroidThreatens: a rock on course within the window threatens; too far out or off line does not", () => {
    const inbound = rock("large", 200, 100, 0, 0.2); // reaches y≈361 (contact) after ~1.5 s
    expect(asteroidThreatens(inbound, still, 2000)).toBe(true);
    expect(asteroidThreatens(inbound, still, 1000)).toBe(false); // not yet within the window
    expect(asteroidThreatens(rock("large", 50, 100, 0, 0.2), still, 5000)).toBe(false); // off line
    expect(asteroidThreatens(rock("large", 200, 100, 0, -0.2), still, 5000)).toBe(false); // going away
  });

  it("asteroidThreatens: already overlapping counts; a destroyed rock never does", () => {
    expect(asteroidThreatens(rock("large", 205, 405), still, 0)).toBe(true);
    expect(asteroidThreatens({ ...rock("large", 205, 405), hp: 0 }, still, 1000)).toBe(false);
    expect(asteroidHits({ ...rock("large", 205, 405), hp: 0 }, still)).toBe(false);
  });

  it("asteroidThreatens: the target's own velocity matters (relative motion)", () => {
    const r = rock("small", 100, 400, 0.1, 0); // drifting right along the circle's row
    const fleeing: ThreatCircle = { ...still, x: 200, vx: 0.2 }; // running away faster than the rock
    expect(asteroidThreatens(r, still, 2000)).toBe(true);
    expect(asteroidThreatens(r, fleeing, 2000)).toBe(false);
    const closing: ThreatCircle = { ...still, vx: -0.1 };
    expect(asteroidThreatens(r, closing, 1000)).toBe(true);
  });

  it("asteroidThreatens agrees with brute-force stepping and cannot be tunnelled through (seeded)", () => {
    const rand = makeRand(99);
    for (let i = 0; i < 600; i++) {
      const r = rock(
        rand() < 0.5 ? "large" : "small",
        rand() * 360,
        rand() * 640,
        (rand() - 0.5) * 1.2, // up to 0.6 px/ms: fast enough to skip a small target between samples
        (rand() - 0.5) * 1.2
      );
      const c: ThreatCircle = {
        x: rand() * 360,
        y: rand() * 640,
        r: 6 + rand() * 20,
        vx: (rand() - 0.5) * 0.3,
        vy: (rand() - 0.5) * 0.3,
      };
      const window = 100 + rand() * 1500;
      let brute = false;
      for (let t = 0; t <= window && !brute; t += 0.5) {
        const dx = r.x + r.vx * t - (c.x + (c.vx ?? 0) * t);
        const dy = r.y + r.vy * t - (c.y + (c.vy ?? 0) * t);
        brute = Math.hypot(dx, dy) <= r.radius + c.r;
      }
      const got = asteroidThreatens(r, c, window);
      // the analytic test is exact; allow only sub-step grazing disagreements in one direction
      if (brute) expect(got).toBe(true);
      else if (got) {
        // grazing contact between 0.5 ms steps: re-check at a finer step
        let fine = false;
        for (let t = 0; t <= window && !fine; t += 0.02) {
          const dx = r.x + r.vx * t - (c.x + (c.vx ?? 0) * t);
          const dy = r.y + r.vy * t - (c.y + (c.vy ?? 0) * t);
          fine = Math.hypot(dx, dy) <= r.radius + c.r + 1e-6;
        }
        expect(fine).toBe(true);
      }
    }
  });

  it("asteroidHits / asteroidHitsBox / enemyThreatCircle agree on the same geometry", () => {
    const base = settled(2);
    const e = base.enemies.find((x) => x.tier === "Grunt")!;
    const onIt = rock("small", e.x, e.y);
    const beside = rock("small", e.x + e.width / 2 + ASTEROID_STATS.small.radius + 10, e.y);
    expect(asteroidHitsBox(onIt, e)).toBe(true);
    expect(asteroidHitsBox(beside, e)).toBe(false);
    expect(asteroidHits(onIt, enemyThreatCircle(e))).toBe(true);
    expect(asteroidHits(beside, enemyThreatCircle(e))).toBe(false);
    expect(enemyThreatCircle(e).r).toBe(Math.max(e.width, e.height) / 2);
  });

  it("enemies use the same collision helper the contract exports: a rock on a grunt hurts it", () => {
    const base = settled(2);
    const e = base.enemies.find((x) => x.tier === "Grunt")!;
    const after = tick({ ...base, asteroids: [rock("small", e.x, e.y)] }, DT, ASIDE);
    const now = after.enemies.find((x) => x.id === e.id)!;
    expect(now.isAlive).toBe(false); // grunt has 1 HP
  });
});
