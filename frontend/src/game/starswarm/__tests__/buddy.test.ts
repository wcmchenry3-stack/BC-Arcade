/**
 * #2845: Buddy as a real allied ship — HP and destruction, tiered enemy targeting under finite
 * combat capacity, evasion of shots and rocks, Carrier armor/exposure rules, standoff geometry,
 * the allied (no friendly fire) collision policy, projectile persistence and the wave reset.
 */
import {
  initStarSwarm,
  tick,
  seedRng,
  _resetIds,
  applyPowerUp,
  clearTransientCombat,
  liveHazards,
  carrierStage,
  buddyTargetFor,
  aimAtBuddy,
  buddyNotices,
  buddyStation,
  buddyHazards,
  buddyJustLost,
  shotHarmsAllies,
  chooseCarrierTarget,
  buddyBurstCount,
  MAX_PLAYER_BULLETS,
  asteroidThreatens,
  buddyThreatCircle,
  CANVAS_W,
  CANVAS_H,
  BUDDY_HP,
  BUDDY_SPEED,
  BUDDY_STANDOFF,
  BUDDY_TARGETING,
  BUDDY_NOTICE,
  BUDDY_BEAM_DAMAGE,
  BUDDY_ROCK_DAMAGE,
  BUDDY_MAX_INCOMING,
  BUDDY_BURSTS,
  BUDDY_PIERCE_HITS,
  BUDDY_NOTICE_AIMED,
  BUDDY_HURT_RADIUS,
  BUDDY_ROCK_LOOKAHEAD_MS,
  BEAM_SPEED,
  BEAM_LENGTH,
  BEAM_HALF_WIDTH,
  ASTEROID_STATS,
  type CarrierCtx,
} from "../engine";
import { fitsSaveShape } from "../saveShape";
import { buddyOps } from "../render/buddy";
import type {
  Asteroid,
  BuddyShip,
  Bullet,
  CarrierBeam,
  Enemy,
  EnemyTier,
  StarSwarmInput,
  StarSwarmState,
} from "../types";

const ASIDE: StarSwarmInput = { playerX: 40, fire: false };

beforeEach(() => {
  seedRng(42);
  _resetIds();
});

function advance(s: StarSwarmState, ms: number, input = ASIDE): StarSwarmState {
  for (let t = 0; t < ms; t += 16) s = tick(s, 16, input);
  return s;
}

/**
 * A wave settled into combat with nothing going on by itself: no dives, stragglers or rocks, every
 * gun parked (`shootTimer` 1e9), and the player parked aside and untouchable.
 */
function settled(wave = 1, seed = 42): StarSwarmState {
  let s = initStarSwarm(CANVAS_W, CANVAS_H, wave, seed);
  s = { ...s, enemyFireDisabled: true, asteroidsDisabled: true, flakDisabled: true };
  while (s.phase === "SwoopIn") s = tick(s, 16, ASIDE);
  expect(s.phase).toBe("Playing");
  return {
    ...s,
    enemyFireDisabled: false,
    enemyBullets: [],
    explosions: [],
    nextDiveTimer: 1e9,
    pauseStraggler: true,
    routDisabled: true,
    player: { ...s.player, x: 40, invincibleTimer: 1e9 },
    enemies: s.enemies.map((e) => ({ ...e, shootTimer: 1e9, runTimer: 1e9, beamTimer: 1e9 })),
  };
}

let fixtureId = 900_000;
function buddyOf(over: Partial<BuddyShip> = {}): BuddyShip {
  return {
    id: fixtureId++,
    x: 180,
    y: 420,
    vx: 0,
    vy: 0,
    phase: "OnStation",
    hp: BUDDY_HP,
    hitFlashTimer: 0,
    ageMs: 0,
    stationMs: 60_000,
    burstsLeft: 0,
    burstTimer: 1e9,
    planMs: 1e9, // no re-plan: it holds still unless a test lets it think
    goalX: over.x ?? 180,
    goalY: over.y ?? 420,
    facingRight: true,
    hitRockIds: [],
    ...over,
  };
}

function enemyShot(over: Partial<Bullet> = {}): Bullet {
  return {
    id: fixtureId++,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    owner: "enemy",
    width: 5,
    height: 10,
    damage: 1,
    ...over,
  };
}

function playerShot(over: Partial<Bullet> = {}): Bullet {
  return { ...enemyShot(), owner: "player", vy: 0, ...over };
}

function rockAt(over: Partial<Asteroid> = {}): Asteroid {
  return {
    id: fixtureId++,
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
    ...over,
  };
}

function beamAt(x: number, y: number, over: Partial<CarrierBeam> = {}): CarrierBeam {
  return {
    id: fixtureId++,
    x,
    y: y + 10,
    vy: 0,
    length: BEAM_LENGTH,
    halfWidth: BEAM_HALF_WIDTH,
    ...over,
  };
}

const carrierOf = (s: StarSwarmState): Enemy | undefined =>
  s.enemies.find((e) => e.isAlive && e.tier === "Carrier");

function killWhere(s: StarSwarmState, pred: (e: Enemy) => boolean): StarSwarmState {
  return {
    ...s,
    enemies: s.enemies.map((e) => (e.isAlive && pred(e) ? { ...e, isAlive: false, hp: 0 } : e)),
  };
}

function withEnemies(s: StarSwarmState, pred: (e: Enemy) => boolean, patch: Partial<Enemy>) {
  return { ...s, enemies: s.enemies.map((e) => (pred(e) ? { ...e, ...patch } : e)) };
}

/** An id whose hash makes Buddy `buddyId` notice (or miss) a hazard, for deterministic dodges. */
function hazardId(buddyId: number, noticed: boolean, chance: number, from = 500_000): number {
  for (let id = from; ; id++) if (buddyNotices(buddyId, id, chance) === noticed) return id;
}

// ---------------------------------------------------------------------------

describe("Buddy durability (#2845)", () => {
  it("launches with BUDDY_HP (tuning range 8–12) and counts the launch", () => {
    expect(BUDDY_HP).toBe(9); // #2880: offense was the problem, not toughness (sim: HP 8 vs 9)
    expect(BUDDY_HP).toBeLessThanOrEqual(12);
    const s = applyPowerUp(settled(), "buddy");
    expect(s.buddyShips).toHaveLength(1);
    expect(s.buddyShips[0]!.hp).toBe(BUDDY_HP);
    expect(s.buddyShips[0]!.burstsLeft).toBe(BUDDY_BURSTS);
    expect(s.runStats.buddyLaunched).toBe(1);
  });

  it("enemy shots drain HP one damage each; the shots are spent and it flashes", () => {
    const b = buddyOf({ x: 200, y: 420 });
    let s: StarSwarmState = {
      ...settled(),
      buddyShips: [b],
      enemyBullets: [enemyShot({ x: 200, y: 420 }), enemyShot({ x: 203, y: 418 })],
    };
    s = tick(s, 16, ASIDE);
    expect(s.buddyShips[0]!.hp).toBe(BUDDY_HP - 2);
    expect(s.buddyShips[0]!.hitFlashTimer).toBeGreaterThan(0);
    expect(s.enemyBullets).toHaveLength(0);
  });

  it("the player's shield never covers Buddy", () => {
    let s: StarSwarmState = {
      ...settled(),
      activePowerUp: { type: "shield", remainingMs: 5000, shieldAbsorbed: 0 },
      buddyShips: [buddyOf({ x: 200, y: 420 })],
      enemyBullets: [enemyShot({ x: 200, y: 420 })],
    };
    s = tick(s, 16, ASIDE);
    expect(s.buddyShips[0]!.hp).toBe(BUDDY_HP - 1);
  });

  it("a released Carrier beam deals BUDDY_BEAM_DAMAGE and is spent on it", () => {
    let s: StarSwarmState = {
      ...settled(),
      buddyShips: [buddyOf({ x: 200, y: 420 })],
      carrierBeams: [beamAt(200, 420)],
    };
    s = tick(s, 16, ASIDE);
    expect(s.buddyShips[0]!.hp).toBe(BUDDY_HP - BUDDY_BEAM_DAMAGE);
    expect(s.carrierBeams).toHaveLength(0);
  });

  it("an asteroid deals BUDDY_ROCK_DAMAGE once per rock; a small one shatters, a large one flies on", () => {
    const b = buddyOf({ x: 200, y: 420 });
    const large = rockAt({ x: 200, y: 420 + 20 });
    let s: StarSwarmState = { ...settled(), buddyShips: [b], asteroids: [large] };
    s = tick(s, 16, ASIDE);
    expect(s.buddyShips[0]!.hp).toBe(BUDDY_HP - BUDDY_ROCK_DAMAGE);
    expect(s.asteroids.find((a) => a.id === large.id)?.hp).toBe(ASTEROID_STATS.large.hp);
    s = tick(s, 16, ASIDE); // still overlapping — no second hit from the same rock
    expect(s.buddyShips[0]!.hp).toBe(BUDDY_HP - BUDDY_ROCK_DAMAGE);

    const small = rockAt({
      kind: "small",
      radius: ASTEROID_STATS.small.radius,
      hp: ASTEROID_STATS.small.hp,
      x: 200,
      y: 420,
    });
    let t: StarSwarmState = {
      ...settled(),
      buddyShips: [buddyOf({ x: 200, y: 420 })],
      asteroids: [small],
    };
    t = tick(t, 16, ASIDE);
    expect(t.buddyShips[0]!.hp).toBe(BUDDY_HP - BUDDY_ROCK_DAMAGE);
    expect(t.asteroids.some((a) => a.id === small.id)).toBe(false); // shattered
  });

  it("at 0 HP it is destroyed: explosion, run stat, event — and its fired shots fly on", () => {
    const b = buddyOf({ x: 200, y: 420, hp: 2, burstsLeft: 2, burstTimer: 1e9 });
    const fired = playerShot({ x: 120, y: 250, vy: -0.3, piercing: true, source: "buddy" });
    const prev: StarSwarmState = {
      ...settled(),
      buddyShips: [b],
      playerBullets: [fired],
      enemyBullets: [enemyShot({ x: 200, y: 420 }), enemyShot({ x: 198, y: 424 })],
    };
    const s = tick(prev, 16, ASIDE);
    expect(s.buddyShips).toHaveLength(0);
    expect(s.explosions.length).toBeGreaterThan(prev.explosions.length);
    expect(s.runStats.buddyLost).toBe(1);
    expect(buddyJustLost(prev, s)).toBe(true);
    expect(buddyJustLost(s, tick(s, 16, ASIDE))).toBe(false);
    // the shot it already fired is its own entity
    expect(s.playerBullets.some((x) => x.id === fired.id)).toBe(true);
    // and its unfired bursts are gone with it: no new Buddy shot ever appears
    const later = advance(s, 3000);
    expect(later.playerBullets.filter((x) => x.source === "buddy" && x.id !== fired.id)).toEqual(
      []
    );
  });

  it("a burst blocked by the player-bullet cap is held, then fires the whole fan once there is room", () => {
    const b = buddyOf({ x: 200, y: 420, burstsLeft: 2, burstTimer: 0 });
    const filler = Array.from({ length: MAX_PLAYER_BULLETS }, (_, i) =>
      playerShot({ x: 10 + i * 8, y: 620, vy: 0 })
    );
    let s: StarSwarmState = { ...settled(), buddyShips: [b], playerBullets: filler };
    s = advance(s, 500);
    expect(s.buddyShips[0]!.burstsLeft).toBe(2); // not spent on an empty (or partial) fan
    expect(s.playerBullets.filter((x) => x.source === "buddy")).toEqual([]);
    const expected = buddyBurstCount(s.buddyShips[0]!);
    s = tick({ ...s, playerBullets: [] }, 16, ASIDE);
    expect(s.buddyShips[0]!.burstsLeft).toBe(1);
    expect(s.playerBullets.filter((x) => x.source === "buddy")).toHaveLength(expected);
  });

  it("a blocked burst never stretches the sortie: station time still runs out", () => {
    const b = buddyOf({ x: 200, y: 420, burstsLeft: 2, burstTimer: 0, stationMs: 200 });
    const filler = Array.from({ length: MAX_PLAYER_BULLETS }, (_, i) =>
      playerShot({ x: 10 + i * 8, y: 620, vy: 0 })
    );
    let s: StarSwarmState = { ...settled(), buddyShips: [b], playerBullets: filler };
    s = advance(s, 400);
    expect(s.buddyShips[0]!.phase).toBe("Leaving");
    expect(s.buddyShips[0]!.burstsLeft).toBe(2);
  });

  it("the HP bar shows one pip per hit point, shared by both renderers", () => {
    const pips = (hp: number) =>
      buddyOps(buddyOf({ id: 3, hp }), 34).filter((o) => /^buddy-3-hp-\d+$/.test(o.key)).length;
    expect(pips(BUDDY_HP)).toBe(BUDDY_HP);
    expect(pips(3)).toBe(3);
    expect(
      buddyOps(buddyOf({ id: 3, hitFlashTimer: 100 }), 34).some((o) => o.key === "buddy-3-flash")
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe("enemy targeting of Buddy (#2845)", () => {
  it("tiers are ordered Grunt < Elite < Guardian < Carrier in willingness, speed, accuracy and lead", () => {
    const order: EnemyTier[] = ["Grunt", "Elite", "Guardian", "Carrier"];
    for (let i = 1; i < order.length; i++) {
      const lo = BUDDY_TARGETING[order[i - 1]!];
      const hi = BUDDY_TARGETING[order[i]!];
      expect(hi.divert).toBeGreaterThan(lo.divert);
      expect(hi.speed).toBeGreaterThan(lo.speed);
      expect(hi.aimError).toBeLessThan(lo.aimError);
      expect(hi.lead).toBeGreaterThan(lo.lead);
    }
    // nobody diverts every shot — Buddy draws fire, it isn't focus-fired
    for (const t of order) expect(BUDDY_TARGETING[t].divert).toBeLessThan(0.75);
  });

  it("aimAtBuddy flies at the tier's speed, within its aim error, leading a moving Buddy", () => {
    const still = { x: 200, y: 400, vx: 0, vy: 0 };
    for (const tier of ["Grunt", "Elite", "Guardian", "Carrier"] as const) {
      for (let key = 1; key < 40; key++) {
        const v = aimAtBuddy(200, 100, still, tier, key);
        expect(Math.hypot(v.vx, v.vy)).toBeCloseTo(BUDDY_TARGETING[tier].speed, 6);
        const off = Math.abs(Math.atan2(v.vy, v.vx) - Math.PI / 2);
        expect(off).toBeLessThanOrEqual(BUDDY_TARGETING[tier].aimError + 1e-9);
      }
    }
    // the Carrier leads Buddy's motion; a Grunt doesn't
    const moving = { x: 200, y: 400, vx: 0.2, vy: 0 };
    const key = [...Array(200).keys()].find(
      (k) => Math.abs(aimAtBuddy(200, 100, still, "Carrier", k).vx) < 0.005
    )!;
    expect(aimAtBuddy(200, 100, moving, "Carrier", key).vx).toBeGreaterThan(0.05);
    const gKey = [...Array(200).keys()].find(
      (k) => Math.abs(aimAtBuddy(200, 100, still, "Grunt", k).vx) < 0.005
    )!;
    expect(aimAtBuddy(200, 100, moving, "Grunt", gKey).vx).toBeCloseTo(
      aimAtBuddy(200, 100, still, "Grunt", gKey).vx,
      9
    );
  });

  it("an evading ship's shot at Buddy keeps its BUDDY_TARGETING aim — evasion degrades player-directed fire only", () => {
    const buddy = buddyOf({ x: 180, y: 430, hp: 1e6 });
    let s = settled(3);
    s = withEnemies(s, (e) => e.tier === "Elite", { shootTimer: 0, evadeMs: 1e9 });
    s = { ...s, buddyShips: [buddy] };
    const seen = new Set<number>();
    let atBuddy = 0;
    let atPlayer = 0;
    for (let t = 0; t < 20_000 && atBuddy < 3; t += 16) {
      s = tick(s, 16, ASIDE);
      for (const b of s.enemyBullets) {
        if (seen.has(b.id) || b.flak) continue;
        seen.add(b.id);
        if (b.target !== "buddy") {
          atPlayer++;
          continue;
        }
        atBuddy++;
        // where it was released (it has flown one 16 ms step since)
        const x0 = b.x - b.vx * 16;
        const y0 = b.y - b.vy * 16;
        const want = aimAtBuddy(x0, y0, s.buddyShips[0]!, "Elite", b.id);
        expect(b.vx).toBeCloseTo(want.vx, 9);
        expect(b.vy).toBeCloseTo(want.vy, 9);
      }
    }
    expect(atBuddy).toBeGreaterThan(0);
    expect(atPlayer).toBeGreaterThan(0);
  });

  it("only a Buddy on screen, in range and below the shooter can be targeted", () => {
    const shooter = { x: 180, y: 200, tier: "Elite" as const };
    const below = buddyOf({ x: 200, y: 420 });
    expect(buddyTargetFor(shooter, [below], false)).toBe(below);
    expect(buddyTargetFor(shooter, [buddyOf({ x: 200, y: 205 })], false)).toBeNull(); // level with it
    expect(buddyTargetFor(shooter, [buddyOf({ x: -20, y: 420 })], false)).toBeNull(); // off screen
    expect(buddyTargetFor(shooter, [buddyOf({ x: 180, y: 640 })], false)).toBeNull(); // out of range
    // the nearest of two
    const near = buddyOf({ x: 190, y: 300 });
    expect(buddyTargetFor(shooter, [below, near], false)).toBe(near);
    // the armored Carrier never targets Buddy; the exposed one does
    const carrier = { x: 180, y: 90, tier: "Carrier" as const };
    expect(buddyTargetFor(carrier, [below], true)).toBeNull();
    expect(buddyTargetFor(carrier, [below], false)).toBe(below);
  });

  /** Fire from one tier only (the others parked) for `ms`, and count where its shots went. */
  function fireFrom(tier: EnemyTier, ms: number) {
    let s = settled(3);
    if (tier === "Carrier") s = killWhere(s, (e) => e.tier === "Guardian"); // exposed
    s = withEnemies(s, (e) => e.tier === tier, { shootTimer: 0, runTimer: 1e9, beamTimer: 1e9 });
    s = {
      ...s,
      guardianThresholdCrossed: true, // Guardians fire
      buddyShips: [buddyOf({ x: 180, y: 430, hp: 1e6, planMs: 0 })],
    };
    const seen = new Map<number, Bullet>();
    let maxIncoming = 0;
    for (let t = 0; t < ms; t += 16) {
      s = tick(s, 16, ASIDE);
      for (const b of s.enemyBullets) if (!b.flak && !seen.has(b.id)) seen.set(b.id, b);
      maxIncoming = Math.max(
        maxIncoming,
        s.enemyBullets.filter((b) => b.target === "buddy").length
      );
    }
    const shots = [...seen.values()];
    const atBuddy = shots.filter((b) => b.target === "buddy");
    return { total: shots.length, atBuddy: atBuddy.length, maxIncoming, shots: atBuddy, s };
  }

  it("every tier may divert fire to Buddy — tiered, and never more than the pressure cap at once", () => {
    const frac: Partial<Record<EnemyTier, number>> = {};
    for (const tier of ["Grunt", "Elite", "Guardian", "Carrier"] as const) {
      const r = fireFrom(tier, 20_000);
      expect(r.total).toBeGreaterThan(8);
      expect(r.atBuddy).toBeGreaterThan(0);
      expect(r.atBuddy).toBeLessThan(r.total); // it draws fire, the player still gets most
      expect(r.maxIncoming).toBeLessThanOrEqual(BUDDY_MAX_INCOMING);
      for (const b of r.shots) {
        expect(Math.hypot(b.vx, b.vy)).toBeCloseTo(BUDDY_TARGETING[tier].speed, 1);
      }
      frac[tier] = r.atBuddy / r.total;
    }
    expect(frac.Grunt!).toBeLessThan(frac.Guardian!);
    expect(frac.Elite!).toBeLessThan(frac.Carrier!);
  });

  it("finite capacity: with Buddy, player-directed + Buddy-directed fire never exceeds the fire without it", () => {
    const run = (withBuddy: boolean) => {
      seedRng(42);
      _resetIds();
      let s = initStarSwarm(CANVAS_W, CANVAS_H, 3, 11, "Commander");
      s = { ...s, asteroidsDisabled: true };
      while (s.phase === "SwoopIn") s = tick(s, 16, ASIDE);
      s = { ...s, player: { ...s.player, invincibleTimer: 1e9 } };
      if (withBuddy) {
        // a Buddy with no bursts left: it changes nothing but where the enemy aims
        s = { ...s, buddyShips: [buddyOf({ x: 200, y: 440, hp: 1e6, planMs: 0 })] };
      }
      const seen = new Map<number, Bullet>();
      for (let t = 0; t < 15_000 && s.phase === "Playing"; t += 16) {
        s = tick(s, 16, ASIDE);
        for (const b of s.enemyBullets) if (!b.flak && !seen.has(b.id)) seen.set(b.id, b);
      }
      const shots = [...seen.values()];
      return {
        atPlayer: shots.filter((b) => b.target !== "buddy").length,
        atBuddy: shots.filter((b) => b.target === "buddy").length,
      };
    };
    const without = run(false);
    const withB = run(true);
    expect(without.atBuddy).toBe(0);
    expect(withB.atBuddy).toBeGreaterThan(0);
    expect(withB.atPlayer + withB.atBuddy).toBeLessThanOrEqual(without.atPlayer);
    expect(withB.atPlayer).toBeLessThan(without.atPlayer); // diverted fire reduces player pressure
  });

  it("the exposed Carrier targets Buddy from the moment the last Guardian dies — not only when alone", () => {
    const b = buddyOf({ x: 180, y: 430, hp: 1e6, planMs: 0 });
    let s: StarSwarmState = { ...settled(3), buddyShips: [b] };
    const carrier = carrierOf(s)!;
    // armored: the seam never offers Buddy
    expect(buddyTargetFor(carrier, s.buddyShips, true)).toBeNull();
    s = killWhere(s, (e) => e.tier === "Guardian");
    expect(carrierStage(s)).toBe("exposed");
    expect(buddyTargetFor(carrier, s.buddyShips, false)).toBe(b);
    const seen = new Map<number, Bullet>();
    let firstAtBuddyStage: string | null = null;
    for (let t = 0; t < 8000; t += 16) {
      s = tick(s, 16, ASIDE);
      for (const x of s.enemyBullets) {
        if (seen.has(x.id)) continue;
        seen.set(x.id, x);
        if (x.target === "buddy" && firstAtBuddyStage === null) firstAtBuddyStage = carrierStage(s);
      }
    }
    expect(firstAtBuddyStage).toBe("exposed"); // other enemies still fighting
    // the choice goes through the finite-capacity seam, and a rock still comes first
    const ctx = {
      playing: true,
      stage: "exposed",
      prevStage: "exposed",
      bossWave: false,
      difficulty: "LieutenantJG",
      playerX: 40,
      playerY: 560,
      canvasH: CANVAS_H,
      flakRock: null,
      buddy: b,
    } as CarrierCtx;
    const keys = [...Array(100).keys()];
    const kinds = keys.map((k) => chooseCarrierTarget(ctx, k).kind);
    expect(kinds).toContain("buddy");
    expect(kinds).toContain("player");
    expect(chooseCarrierTarget({ ...ctx, flakRock: { x: 0, y: 0, vx: 0, vy: 0 } }, 1).kind).toBe(
      "rock"
    );
    expect(chooseCarrierTarget({ ...ctx, buddy: null }, 1).kind).toBe("player");
  });
});

// ---------------------------------------------------------------------------

describe("Buddy evasion (#2845)", () => {
  /** One shot aimed straight at a holding Buddy from 220 px above it. */
  function shotTrial(id: number): boolean {
    const b = buddyOf({ id: 4242, x: 180, y: 430, planMs: 0 });
    let s: StarSwarmState = {
      ...settled(),
      enemyFireDisabled: true,
      buddyShips: [b],
      enemyBullets: [enemyShot({ id, x: 180, y: 210, vy: 0.35 })],
    };
    s = advance(s, 1200);
    return s.buddyShips[0]!.hp === BUDDY_HP; // true = dodged
  }

  it("dodges a shot it notices", () => {
    expect(shotTrial(hazardId(4242, true, BUDDY_NOTICE.shot))).toBe(true);
  });

  it("is strong but imperfect: most shots are dodged, not all", () => {
    let dodged = 0;
    const n = 40;
    for (let i = 0; i < n; i++) if (shotTrial(700_000 + i * 17)) dodged++;
    expect(dodged / n).toBeGreaterThanOrEqual(0.6);
    expect(dodged).toBeLessThan(n);
    // an unnoticed shot is simply not dodged
    expect(shotTrial(hazardId(4242, false, BUDDY_NOTICE.shot))).toBe(false);
  });

  it("dodges a rock on a collision course (asteroidThreatens) that it notices", () => {
    const b = buddyOf({ id: 4343, x: 180, y: 430, planMs: 0 });
    const rock = rockAt({
      id: hazardId(4343, true, BUDDY_NOTICE.rock),
      x: 180,
      y: 200,
      vx: 0,
      vy: 0.2,
    });
    expect(asteroidThreatens(rock, buddyThreatCircle(b), 5000)).toBe(true);
    let s: StarSwarmState = {
      ...settled(),
      enemyFireDisabled: true,
      buddyShips: [b],
      asteroids: [rock],
    };
    // it only reacts inside its window
    expect(buddyHazards(s, b)).toHaveLength(0);
    let reacted = false;
    for (let t = 0; t < 2500; t += 16) {
      s = tick(s, 16, ASIDE);
      const cur = s.buddyShips[0]!;
      if (buddyHazards(s, cur).length > 0) reacted = true;
    }
    expect(reacted).toBe(true);
    // #2880: a slower Buddy (0.14 px/ms) no longer always clears a rock, but a rock still lands at
    // most once (BUDDY_ROCK_DAMAGE) — it never piles up.
    expect(s.buddyShips[0]!.hp).toBeGreaterThanOrEqual(BUDDY_HP - BUDDY_ROCK_DAMAGE);
    expect(BUDDY_ROCK_LOOKAHEAD_MS).toBeGreaterThan(0);
  });

  it("is bounded: on station it never moves faster than BUDDY_SPEED", () => {
    let s = applyPowerUp(settled(3), "buddy");
    s = withEnemies(s, (e) => e.tier !== "Carrier", { shootTimer: 0 });
    let maxSpeed = 0;
    for (let t = 0; t < 8000 && s.buddyShips.length; t += 16) {
      s = tick(s, 16, ASIDE);
      const b = s.buddyShips[0];
      if (b?.phase === "OnStation") maxSpeed = Math.max(maxSpeed, Math.hypot(b.vx, b.vy));
    }
    expect(maxSpeed).toBeGreaterThan(0);
    expect(maxSpeed).toBeLessThanOrEqual(BUDDY_SPEED + 1e-9);
  });

  it("player shots are never hazards to it", () => {
    const b = buddyOf({ x: 180, y: 430 });
    const s: StarSwarmState = {
      ...settled(),
      buddyShips: [b],
      playerBullets: [playerShot({ x: 180, y: 470, vy: -0.5 })],
    };
    expect(buddyHazards(s, b)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

describe("allied collision policy (#2845)", () => {
  it("only enemy shots harm allies", () => {
    expect(shotHarmsAllies({ owner: "enemy" })).toBe(true);
    expect(shotHarmsAllies({ owner: "player" })).toBe(false);
  });

  it("player shots pass through Buddy harmlessly", () => {
    const shot = playerShot({ x: 200, y: 420 });
    let s: StarSwarmState = {
      ...settled(),
      buddyShips: [buddyOf({ x: 200, y: 420 })],
      playerBullets: [shot],
    };
    s = tick(s, 16, ASIDE);
    expect(s.buddyShips[0]!.hp).toBe(BUDDY_HP);
    expect(s.playerBullets.some((b) => b.id === shot.id)).toBe(true);
  });

  it("Buddy's shots pass through the player harmlessly", () => {
    const base = settled();
    const p = { ...base.player, invincibleTimer: 0 };
    const shot = playerShot({ x: p.x, y: p.y, source: "buddy", piercing: true });
    let s: StarSwarmState = { ...base, player: p, playerBullets: [shot] };
    s = tick(s, 16, ASIDE);
    expect(s.player.lives).toBe(base.player.lives);
    expect(s.playerBullets.some((b) => b.id === shot.id)).toBe(true);
  });

  it("player and Buddy shots never destroy each other", () => {
    const a = playerShot({ x: 200, y: 300 });
    const b = playerShot({ x: 200, y: 300, source: "buddy", piercing: true });
    let s: StarSwarmState = { ...settled(), playerBullets: [a, b] };
    s = tick(s, 16, ASIDE);
    expect(s.playerBullets.map((x) => x.id).sort()).toEqual([a.id, b.id].sort());
  });

  it("the player and Buddy overlapping costs neither anything", () => {
    const base = settled();
    const p = { ...base.player, invincibleTimer: 0 };
    let s: StarSwarmState = { ...base, player: p, buddyShips: [buddyOf({ x: p.x, y: p.y })] };
    s = tick(s, 16, ASIDE);
    expect(s.player.lives).toBe(base.player.lives);
    expect(s.player.hull).toBe(base.player.hull);
    expect(s.buddyShips[0]!.hp).toBe(BUDDY_HP);
  });

  it("both still meet hostiles and rocks normally: a Buddy shot kills a Grunt and is spent on a rock", () => {
    let s = settled();
    const g = s.enemies.find((e) => e.tier === "Grunt")!;
    const kill = playerShot({ x: g.x, y: g.y, source: "buddy", piercing: true });
    const rock = rockAt({ x: 300, y: 500 });
    const intoRock = playerShot({ x: 300, y: 500, source: "buddy", piercing: true });
    s = { ...s, playerBullets: [kill, intoRock], asteroids: [rock] };
    s = tick(s, 16, ASIDE);
    expect(s.enemies.find((e) => e.id === g.id)!.isAlive).toBe(false);
    expect(s.playerBullets.some((b) => b.id === intoRock.id)).toBe(false);
    expect(s.asteroids.find((a) => a.id === rock.id)!.hp).toBe(ASTEROID_STATS.large.hp - 1);
  });
});

// ---------------------------------------------------------------------------

describe("Buddy shot hit cap (#2880)", () => {
  /** A formation of tough Grunts and one wide shot parked over all of them. */
  function overFormation(shotOver: Partial<Bullet>): { s: StarSwarmState; hp: number } {
    const base = settled();
    // no Carrier: its force field would spend a non-armor-piercing shot (a separate rule)
    const s0 = withEnemies(
      { ...base, enemies: base.enemies.filter((e) => e.tier !== "Carrier") },
      () => true,
      { hp: 50 }
    );
    const alive = s0.enemies.filter((e) => e.isAlive);
    const cx = alive.reduce((a, e) => a + e.x, 0) / alive.length;
    const cy = alive.reduce((a, e) => a + e.y, 0) / alive.length;
    const shot = playerShot({ x: cx, y: cy, width: 900, height: 900, damage: 1, ...shotOver });
    return { s: { ...s0, playerBullets: [shot] }, hp: 50 };
  }
  const damaged = (s: StarSwarmState, hp: number) =>
    s.enemies.filter((e) => e.isAlive && e.hp < hp).length;

  it("a Buddy burst carries the cap; the tuning is 2 hits, a 3-4 shot fan", () => {
    expect(BUDDY_PIERCE_HITS).toBe(2);
    expect(BUDDY_NOTICE_AIMED).toBeLessThan(0.8);
    let s = settled();
    s = {
      ...s,
      buddyShips: [buddyOf({ x: 200, y: 420, burstsLeft: 1, burstTimer: 0 })],
    };
    s = tick(s, 16, ASIDE);
    const fan = s.playerBullets.filter((b) => b.source === "buddy");
    expect(fan.length).toBeGreaterThanOrEqual(3);
    expect(fan.length).toBeLessThanOrEqual(4);
    for (const b of fan) {
      expect(b.piercing).toBe(true);
      expect(b.armorPiercing).toBeUndefined();
      expect(b.pierceLeft).toBe(BUDDY_PIERCE_HITS);
    }
    expect(fitsSaveShape(JSON.parse(JSON.stringify(s)))).toBe(true);
  });

  it("passes through 2 enemies and is then spent, even with many overlapping in one tick", () => {
    const { s, hp } = overFormation({ source: "buddy", piercing: true, pierceLeft: 2 });
    const next = tick(s, 16, ASIDE);
    expect(damaged(next, hp)).toBe(2);
    expect(next.playerBullets.some((b) => b.source === "buddy")).toBe(false);
  });

  it("the counter persists across ticks: one hit now, the last hit later", () => {
    const base = settled();
    const g = base.enemies.find((e) => e.tier === "Grunt")!;
    const shot = playerShot({
      x: g.x,
      y: g.y,
      width: 6,
      height: 6,
      source: "buddy",
      piercing: true,
      pierceLeft: 2,
    });
    let s: StarSwarmState = { ...base, playerBullets: [shot] };
    s = withEnemies(s, (e) => e.id === g.id, { hp: 50 });
    s = tick(s, 16, ASIDE);
    const left = s.playerBullets.find((b) => b.id === shot.id);
    expect(left?.pierceLeft).toBe(1);
    expect(left?.hitEnemyIds).toEqual([g.id]);
    expect(fitsSaveShape(JSON.parse(JSON.stringify(s)))).toBe(true);
  });

  it("does not cap Lightning (piercing + armorPiercing) or the player's own piercing", () => {
    for (const over of [
      { piercing: true, armorPiercing: true, damage: 4 },
      { piercing: true },
    ] as Partial<Bullet>[]) {
      const { s, hp } = overFormation(over);
      const next = tick(s, 16, ASIDE);
      expect(damaged(next, hp)).toBeGreaterThan(BUDDY_PIERCE_HITS);
      expect(next.playerBullets.some((b) => b.piercing)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------

describe("Buddy vs the Carrier (#2845)", () => {
  it("a whole sortie never damages the armored Carrier", () => {
    let s = settled(5); // boss wave: the Carrier and its four Guardians
    s = withEnemies(s, (e) => e.tier === "Guardian", { hp: 1e6 }); // escorts hold, armor stays up
    s = applyPowerUp(s, "buddy");
    const hp = carrierOf(s)!.hp;
    let buddyShots = 0;
    for (let t = 0; t < 14_000 && s.buddyShips.length; t += 16) {
      s = tick(s, 16, ASIDE);
      buddyShots = Math.max(buddyShots, s.playerBullets.filter((b) => b.source === "buddy").length);
    }
    expect(buddyShots).toBeGreaterThan(0);
    expect(s.runStats.armorDeflects).toBeGreaterThan(0); // its shots did reach the field…
    expect(carrierOf(s)!.hp).toBe(hp); // …and did nothing
  });

  it("keeps its standoff on station and lines up under the exposed Carrier for its attack runs", () => {
    let s = killWhere(settled(3), (e) => e.tier === "Guardian");
    s = { ...applyPowerUp(s, "buddy"), enemyFireDisabled: true };
    s = withEnemies(s, (e) => e.tier === "Carrier", { hp: 1e6 });
    let minD = Infinity;
    const burstOffsets: number[] = [];
    let prevBursts = BUDDY_BURSTS;
    for (let t = 0; t < 14_000 && s.buddyShips.length; t += 16) {
      s = tick(s, 16, ASIDE);
      const b = s.buddyShips[0];
      const c = carrierOf(s)!;
      if (!b || b.phase !== "OnStation") continue;
      minD = Math.min(minD, Math.hypot(b.x - c.x, b.y - c.y));
      if (b.burstsLeft < prevBursts) {
        burstOffsets.push(Math.abs(b.x - c.x));
        prevBursts = b.burstsLeft;
      }
    }
    expect(minD).toBeGreaterThanOrEqual(BUDDY_STANDOFF - 1);
    expect(burstOffsets.length).toBe(BUDDY_BURSTS);
    for (const off of burstOffsets) expect(off).toBeLessThan(20); // an attack run, not a pass
  });

  it("buddyStation holds the standoff below the Carrier", () => {
    const s = killWhere(settled(3), (e) => e.tier === "Guardian");
    const c = carrierOf(s)!;
    for (const phase of ["Entering", "OnStation"] as const) {
      for (const burstTimer of [0, 300, 5000]) {
        const st = buddyStation(s, { ageMs: 1234, burstTimer, burstsLeft: 1, phase });
        expect(st.y - c.y).toBeGreaterThanOrEqual(BUDDY_STANDOFF);
      }
    }
  });
});

// ---------------------------------------------------------------------------

describe("projectile persistence and mutual trades (#2845)", () => {
  it("Buddy fires, then dies — its shots still kill the Carrier", () => {
    let s = killWhere(settled(3), (e) => e.tier === "Guardian");
    s = withEnemies(s, (e) => e.tier === "Carrier", { hp: 1 });
    const c = carrierOf(s)!;
    const shot = playerShot({ x: c.x, y: c.y + 120, vy: -0.4, piercing: true, source: "buddy" });
    s = {
      ...s,
      buddyShips: [buddyOf({ x: 300, y: 450, hp: 1 })],
      playerBullets: [shot],
      enemyBullets: [enemyShot({ x: 300, y: 450 })],
    };
    s = tick(s, 16, ASIDE);
    expect(s.buddyShips).toHaveLength(0); // Buddy down
    expect(s.playerBullets.some((b) => b.id === shot.id)).toBe(true);
    s = advance(s, 600);
    expect(carrierOf(s)).toBeUndefined(); // …and its shot finished the Carrier
  });

  it("the Carrier fires at Buddy, then dies — its shot still lands", () => {
    let s = killWhere(settled(3), (e) => e.tier === "Guardian");
    const c = carrierOf(s)!;
    const b = buddyOf({ x: c.x, y: c.y + 200, hp: 2 });
    const bolt = enemyShot({ x: c.x, y: c.y + 60, vy: 0.5, target: "buddy" });
    s = {
      ...s,
      buddyShips: [b],
      enemyBullets: [bolt],
      enemies: s.enemies.map((e) => (e.id === c.id ? { ...e, isAlive: false, hp: 0 } : e)),
    };
    expect(carrierOf(s)).toBeUndefined();
    s = advance(s, 400);
    expect(s.buddyShips[0]!.hp).toBe(1);
  });

  it("near-simultaneous mutual destruction is valid", () => {
    let s = killWhere(settled(3), (e) => e.tier === "Guardian");
    s = withEnemies(s, (e) => e.tier === "Carrier", { hp: 1 });
    const c = carrierOf(s)!;
    s = {
      ...s,
      buddyShips: [buddyOf({ x: 300, y: 450, hp: 1 })],
      playerBullets: [playerShot({ x: c.x, y: c.y, source: "buddy", piercing: true })],
      enemyBullets: [enemyShot({ x: 300, y: 450, target: "buddy" })],
    };
    s = tick(s, 16, ASIDE);
    expect(carrierOf(s)).toBeUndefined();
    expect(s.buddyShips).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------

describe("Buddy through extraction and the wave reset (#2845)", () => {
  function extracting(): StarSwarmState {
    let s = settled();
    s = {
      ...s,
      buddyShips: [buddyOf({ x: 200, y: 420, burstsLeft: 2, burstTimer: 0 })],
    };
    s = killWhere(s, () => true);
    s = tick(s, 16, ASIDE);
    expect(s.phase).toBe("Extraction");
    return s;
  }

  it("on extraction Buddy peels off, fires nothing new, and stays damageable", () => {
    let s = extracting();
    const shotsBefore = s.playerBullets.filter((b) => b.source === "buddy").length;
    s = tick(s, 16, ASIDE);
    expect(s.buddyShips[0]!.phase).toBe("Leaving");
    s = { ...s, enemyBullets: [enemyShot({ x: s.buddyShips[0]!.x, y: s.buddyShips[0]!.y })] };
    s = tick(s, 16, ASIDE);
    expect(s.buddyShips[0]!.hp).toBe(BUDDY_HP - 1); // hazards stay live
    s = advance(s, 400);
    expect(s.playerBullets.filter((b) => b.source === "buddy").length).toBe(shotsBefore);
  });

  it("the autopilot dodges shots aimed at Buddy; Buddy and its shots are never hazards", () => {
    const s: StarSwarmState = {
      ...settled(),
      buddyShips: [buddyOf({ x: 200, y: 420 })],
      playerBullets: [playerShot({ x: 100, y: 300, source: "buddy" })],
      enemyBullets: [enemyShot({ x: 50, y: 50, target: "buddy" })],
    };
    const h = liveHazards(s);
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ x: 50, y: 50 });
  });

  it("clearTransientCombat clears Buddy, its shots and shots aimed at it; the save shape fits them all", () => {
    let s = applyPowerUp(settled(), "buddy");
    s = {
      ...s,
      playerBullets: [playerShot({ x: 100, y: 300, source: "buddy", piercing: true })],
      enemyBullets: [enemyShot({ x: 50, y: 50, target: "buddy" })],
    };
    s = { ...s, buddyShips: [{ ...s.buddyShips[0]!, hitRockIds: [5] }] };
    expect(fitsSaveShape(JSON.parse(JSON.stringify(s)))).toBe(true);
    const c = clearTransientCombat(s);
    expect(c.buddyShips).toEqual([]);
    expect(c.playerBullets).toEqual([]);
    expect(c.enemyBullets).toEqual([]);
    expect(c.runStats).toBe(s.runStats); // counters survive the reset
  });

  it("a Buddy in flight at the wave clear never reaches the next wave", () => {
    let s = extracting();
    for (let i = 0; i < 1000 && s.wave === 1; i++) s = tick(s, 16, ASIDE);
    expect(s.wave).toBe(2);
    expect(s.buddyShips).toEqual([]);
    expect(s.playerBullets).toEqual([]);
  });

  it("is deterministic under seedRng", () => {
    const run = () => {
      seedRng(7);
      _resetIds();
      let s = initStarSwarm(CANVAS_W, CANVAS_H, 3, 7, "Commander");
      while (s.phase === "SwoopIn") s = tick(s, 16, ASIDE);
      // power-up drops pick their type and x with Math.random (cosmetic, pre-existing) — keep them out
      s = { ...s, dropJitterTarget: 1e9, player: { ...s.player, invincibleTimer: 1e9 } };
      s = applyPowerUp(s, "buddy");
      return advance(s, 6000, { playerX: 120, fire: true });
    };
    expect(JSON.stringify(run())).toBe(JSON.stringify(run()));
  });
});

// keep the hurt radius in the contract the tests above lean on
test("Buddy's hit circle is its threat circle", () => {
  const b = buddyOf({ x: 10, y: 20, vx: 0.1 });
  expect(buddyThreatCircle(b)).toEqual({ x: 10, y: 20, r: BUDDY_HURT_RADIUS, vx: 0.1, vy: 0 });
  expect(BEAM_SPEED).toBeGreaterThan(0);
});
