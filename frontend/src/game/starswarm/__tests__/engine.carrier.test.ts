/**
 * Star Swarm engine tests: the Carrier tier and its actions.
 *
 * One file per planned `engine/` module (#2988): this file follows `engine/carrier.ts`. Split out
 * of the former monolithic `engine.test.ts` (#2955) with describe blocks moved whole; shared
 * fixtures live in `helpers/engineFixtures.ts`.
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
  difficultyMultiplier,
  isCarrierArmored,
  carrierJustExposed,
  isLeaderTier,
  BEAM_CHARGE_MS,
  BEAM_HALF_WIDTH,
  BEAM_SPEED,
  REINFORCE_COUNT,
  carrierCadenceBounds,
  carrierBeamCharge,
  carrierBeamJustStarted,
  carrierBeamJustFired,
  reinforcementsJustLaunched,
  reinforceCap,
} from "../engine";
import type { Bullet, DifficultyTier, StarSwarmInput, StarSwarmState } from "../types";
import { NO_INPUT, advanceMs, makeBeam } from "./helpers/engineFixtures";

beforeEach(() => {
  seedRng(42);
  _resetIds();
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
    enemies: s.enemies.map((e) => (e.tier === "Guardian" ? { ...e, isAlive: false, hp: 0 } : e)),
  });

  it("wave 1 has exactly one Carrier, centered in a row above the Guardians", () => {
    const s = initStarSwarm(CANVAS_W, CANVAS_H);
    const carriers = s.enemies.filter((e) => e.tier === "Carrier");
    expect(carriers).toHaveLength(1);
    const c = carriers[0]!;
    expect(c.formationX).toBe(CANVAS_W / 2);
    expect(c.hp).toBe(8);
    const guardianYs = s.enemies.filter((e) => e.tier === "Guardian").map((e) => e.formationY);
    const eliteYs = s.enemies.filter((e) => e.tier === "Elite").map((e) => e.formationY);
    expect(guardianYs).toHaveLength(4);
    expect(Math.min(...guardianYs)).toBeGreaterThan(c.formationY);
    expect(Math.min(...eliteYs)).toBeGreaterThan(Math.max(...guardianYs));
  });

  it("is excluded from the non-leader threshold count", () => {
    const s = initStarSwarm(CANVAS_W, CANVAS_H);
    const gruntsAndElites = s.enemies.filter((e) => e.tier === "Grunt" || e.tier === "Elite");
    expect(s.startingNonLeaderCount).toBe(gruntsAndElites.length);
    expect(isLeaderTier("Carrier")).toBe(true);
    expect(isLeaderTier("Guardian")).toBe(true);
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

  it("alone, it never dives like the formation: only its own attack run, always back to station; a live Carrier keeps the wave open", () => {
    // (its lasers, beam and attack run are covered under Carrier actions, #2485/#2843)
    let s = settled();
    s = {
      ...s,
      enemies: s.enemies.map((e) => (e.tier === "Carrier" ? e : { ...e, isAlive: false, hp: 0 })),
      enemyBullets: [],
      enemyFireDisabled: true,
    };
    const seen = new Set<string>();
    for (let t = 0; t < 20_000; t += 16) {
      s = tick(s, 16, NO_INPUT);
      seen.add(carrierOf(s)!.phase);
    }
    expect([...seen].sort()).toEqual(["AttackRun", "Formation"]);
    expect(carrierOf(s)!.isAlive).toBe(true);
    expect(s.wave).toBe(1); // a live Carrier keeps the wave open
  });

  it("sways at most ±12 px while Guardians sway ±20 and Grunts ±40", () => {
    // Enemy fire off so the drifting player can't be killed (GameOver would freeze the sway)
    let s = { ...settled(), enemyFireDisabled: true, enemyBullets: [] };
    for (let t = 0; t < 4000 && Math.abs(s.formationSwayX) < 30; t += 16) s = tick(s, 16, NO_INPUT);
    expect(Math.abs(s.formationSwayX)).toBeGreaterThanOrEqual(30);
    const c = carrierOf(s)!;
    expect(Math.abs(c.x - c.formationX)).toBeLessThanOrEqual(12);
    const boss = s.enemies.find(
      (e) => e.isAlive && e.tier === "Guardian" && e.phase === "Formation"
    )!;
    expect(Math.abs(boss.x - boss.formationX)).toBeLessThanOrEqual(20);
  });

  it("isCarrierArmored: true with an escort alive, false once all escorts die or the Carrier dies", () => {
    const s = settled();
    expect(isCarrierArmored(s)).toBe(true);
    expect(isCarrierArmored(withoutEscorts(s))).toBe(false);
    const oneEscort = {
      ...s,
      enemies: s.enemies.map((e, i) =>
        e.tier === "Guardian" && i !== s.enemies.findIndex((x) => x.tier === "Guardian")
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

  it("escorted: an armor-piercing (Lightning) shot goes through the armor", () => {
    let s = settled();
    const c = carrierOf(s)!;
    s = {
      ...s,
      playerBullets: [
        shotAt(c.x, c.y, { piercing: true, armorPiercing: true, damage: 1, width: 12 }),
      ],
    };
    s = tick(s, 16, NO_INPUT);
    expect(carrierOf(s)!.hp).toBe(7);
  });

  it("#2845 escorted: a piercing-only (Buddy) shot is spent on the field — multi-hit is not armor bypass", () => {
    let s = settled();
    const c = carrierOf(s)!;
    s = {
      ...s,
      playerBullets: [shotAt(c.x, c.y, { piercing: true, source: "buddy", damage: 1 })],
    };
    s = tick(s, 16, NO_INPUT);
    expect(carrierOf(s)!.hp).toBe(8);
    expect(carrierOf(s)!.hitFlashTimer).toBeGreaterThan(0);
    expect(s.playerBullets).toHaveLength(0);
    expect(s.runStats.armorDeflects).toBe(1);
  });

  it("a piercing shot damages an enemy only once across its whole flight, not once per tick it overlaps it", () => {
    // Regression for the buddy-ship "one-shots a full-health Carrier" report: a piercing
    // bullet is never consumed on hit, so a slow bullet parked on a big hitbox used to re-deal
    // its damage on every tick it stayed inside it instead of just the first.
    let s = settled();
    const c = carrierOf(s)!;
    s = {
      ...s,
      playerBullets: [
        shotAt(c.x, c.y, {
          piercing: true,
          armorPiercing: true,
          damage: 1,
          width: 12,
          vx: 0,
          vy: 0,
        }),
      ],
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

  it("beam: idle → charge (600 ms telegraph) → release of an independent traveling beam → idle", () => {
    let s = quiet();
    expect(s.phase).toBe("Playing");
    expect(carrierBeamCharge(s)).toBeNull();
    const c0 = carrierOf(s);
    // a release is enemy fire (the dev toggle would hold it); every other gun stays parked
    s = {
      ...s,
      enemyFireDisabled: false,
      nextDiveTimer: 1e9,
      player: { ...s.player, invincibleTimer: 1e9 },
      enemies: s.enemies.map((e) =>
        e.id === c0.id ? { ...e, beamTimer: 100 } : { ...e, shootTimer: 1e9 }
      ),
    };
    let t = 0;
    let chargeAt = -1;
    let fireAt = -1;
    while (fireAt < 0 && t < 2000) {
      const prev = s;
      s = tick(s, 16, ASIDE);
      t += 16;
      if (carrierBeamJustStarted(prev, s)) chargeAt = t;
      if (carrierBeamJustFired(prev, s)) fireAt = t;
    }
    expect(chargeAt).toBeGreaterThan(0);
    expect(fireAt - chargeAt).toBeGreaterThanOrEqual(BEAM_CHARGE_MS - 16);
    expect(fireAt - chargeAt).toBeLessThanOrEqual(BEAM_CHARGE_MS + 32);
    // the release is its own entity, leaving the Carrier's emitter in its column…
    const c = carrierOf(s);
    expect(s.carrierBeams).toHaveLength(1);
    const beam = s.carrierBeams[0]!;
    expect(Math.abs(beam.x - c.x)).toBeLessThanOrEqual(BEAM_HALF_WIDTH);
    expect(beam.y).toBeGreaterThan(c.y);
    // …the Carrier is idle again at once, its next beam a roll from the stage's range
    expect(c.beamPhase).toBe("idle");
    const b = carrierCadenceBounds("beam", "protected", "LieutenantJG", false)!;
    expect(c.beamTimer).toBeGreaterThanOrEqual(b.min - 16);
    expect(c.beamTimer).toBeLessThanOrEqual(b.max);
    // …and the bolt travels fast, straight down its column, then leaves the screen
    const y0 = beam.y;
    s = tick(s, 100, ASIDE);
    expect(s.carrierBeams[0]!.y).toBeCloseTo(y0 + BEAM_SPEED * 100, 5);
    expect(s.carrierBeams[0]!.x).toBe(beam.x);
    s = advanceMs(s, 1200, ASIDE);
    expect(s.carrierBeams).toHaveLength(0);
    // a beam is not a bullet
    expect(s.enemyBullets).toHaveLength(0);
  });

  it("carrierBeamCharge() reports position and progress while charging", () => {
    const s = quiet();
    const c = carrierOf(s);
    const charging = {
      ...s,
      enemies: s.enemies.map((e) =>
        e.id === c.id ? { ...e, beamPhase: "charge" as const, beamTimer: BEAM_CHARGE_MS / 2 } : e
      ),
    };
    const b = carrierBeamCharge(charging)!;
    expect(b.x).toBe(c.x);
    expect(b.y).toBe(c.y + c.height / 2);
    expect(b.progress).toBeCloseTo(0.5, 5);
  });

  it("a released beam costs a life in its column, misses beside it; shield holds; invincibility ignores", () => {
    const base = { ...quiet(), carrierBeams: [] };
    const withBeam = (s: StarSwarmState, playerX: number, invincibleTimer = 0) => ({
      ...s,
      player: { ...s.player, x: playerX, invincibleTimer },
      carrierBeams: [makeBeam(200, s.player.y)],
    });
    const inBeam: StarSwarmInput = { playerX: 200, fire: false };
    let s = tick(withBeam(base, 200), 16, inBeam);
    expect(s.player.lives).toBe(2);
    expect(s.carrierBeams).toHaveLength(0); // spent on the ship

    const beside: StarSwarmInput = {
      playerX: 200 + BEAM_HALF_WIDTH + PLAYER_HURT_RADIUS + 6,
      fire: false,
    };
    s = tick(withBeam(base, beside.playerX), 16, beside);
    expect(s.player.lives).toBe(3);
    expect(s.carrierBeams).toHaveLength(1); // it flies on

    s = tick(withBeam(applyPowerUp(base, "shield"), 200), 16, inBeam);
    expect(s.player.lives).toBe(3);
    expect(s.carrierBeams).toHaveLength(0); // absorbed, and spent

    s = tick(withBeam(base, 200, 5000), 16, inBeam);
    expect(s.player.lives).toBe(3);
  });

  it("a shield holds off the beam but never a ship ramming through it (#1033 rule)", () => {
    const base = applyPowerUp(quiet(), "shield");
    const grunt = base.enemies.find((e) => e.isAlive && e.tier === "Grunt")!;
    const px = 200;
    const inBeam: StarSwarmInput = { playerX: px, fire: false };
    const ram = { x: px, y: base.player.y };
    // shielded, in a released beam's path, with a Grunt right on top of the ship
    let s = {
      ...base,
      player: { ...base.player, x: px },
      carrierBeams: [makeBeam(px, base.player.y)],
      enemies: base.enemies.map((e) =>
        e.id === grunt.id
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
    const boss = s.enemies.find((e) => e.isAlive && e.tier === "Guardian")!;
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
    // its last Guardian escort dies — armor drops, but the grunt is still alive
    s = killAllBut(s, (e) => e.id === c.id || e.id === grunt.id);
    expect(isCarrierArmored(s)).toBe(false);
    let volleyAt = -1;
    const twin = carrierCadenceBounds("twin", "exposed", "LieutenantJG", false)!;
    for (let t = 0; t < twin.max + 100 && volleyAt < 0; t += 16) {
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

  it("#2699: stays silent while any Guardian escort lives, even once every grunt is dead", () => {
    let s = { ...quiet(), enemyFireDisabled: false, pauseStraggler: true, nextDiveTimer: 1e9 };
    const c = carrierOf(s);
    const boss = s.enemies.find((e) => e.isAlive && e.tier === "Guardian")!;
    s = killAllBut(s, (e) => e.id === c.id || e.id === boss.id);
    s = {
      ...s,
      enemies: s.enemies.map((e) =>
        e.id === c.id ? { ...e, shootTimer: 0 } : { ...e, shootTimer: 1e9 }
      ),
    };
    expect(isCarrierArmored(s)).toBe(true);
    for (let t = 0; t < 3000; t += 16) {
      s = tick(s, 16, ASIDE);
      expect(s.enemyBullets).toHaveLength(0);
    }
  });

  it("launches a randomized batch into empty grunt slots, capped at half the grunt slots", () => {
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
    // #2843: a protected Carrier launches REINFORCE_COUNT.protected at a time
    expect(launched.length).toBeGreaterThanOrEqual(REINFORCE_COUNT.protected!.min);
    expect(launched.length).toBeLessThanOrEqual(REINFORCE_COUNT.protected!.max);
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
      guardianThresholdCrossed: true,
      reinforceTimer: 1,
      enemies: s.enemies.map((e) => (e.tier === "Grunt" ? { ...e, isAlive: false, hp: 0 } : e)),
    };
    const startCount = s.startingNonLeaderCount;
    s = tick(s, 16, ASIDE);
    expect(s.reinforcedThisWave).toBeGreaterThan(0);
    expect(s.guardianThresholdCrossed).toBe(true);
    expect(s.startingNonLeaderCount).toBe(startCount);
  });
});
