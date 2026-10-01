/**
 * #2843: the Carrier as a staged, randomized boss encounter — protected / exposed / final-stand
 * stages, the independent traveling beam, bounded seeded cadences, the original-Grunt
 * population ceiling on reinforcements, and the heavy attack run.
 */
import {
  initStarSwarm,
  tick,
  seedRng,
  CANVAS_W,
  CANVAS_H,
  carrierStage,
  carrierJustExposed,
  carrierFinalStandJustStarted,
  carrierCadenceBounds,
  rollCarrierCadence,
  engineCounters,
  CADENCE_INACTIVE_MS,
  CARRIER_CADENCE,
  CARRIER_CADENCE_FLOOR,
  CARRIER_CADENCE_CAP,
  BOSS_WAVE_BEAM_SCALE,
  REINFORCE_COUNT,
  ATTACK_RUN,
  ATTACK_RUN_BRACE_MS,
  BEAM_CHARGE_MS,
  BEAM_HALF_WIDTH,
  BEAM_LENGTH,
  BEAM_SPEED,
  DIFFICULTY_TIERS,
  difficultyParamScale,
  carrierBeamCharge,
  carrierBeamJustFired,
  carrierAttackRunJustStarted,
  carrierRunBrace,
  reinforcementsJustLaunched,
  originalGruntCount,
  reinforceCap,
  clearTransientCombat,
  liveHazards,
  type CarrierCadence,
} from "../engine";
import { fitsSaveShape } from "../saveShape";
import type {
  CarrierBeam,
  CarrierStage,
  DifficultyTier,
  Enemy,
  StarSwarmInput,
  StarSwarmState,
} from "../types";

const ASIDE: StarSwarmInput = { playerX: 40, fire: false };
const STAGES: readonly CarrierStage[] = ["protected", "exposed", "finalStand"];

function advance(s: StarSwarmState, ms: number, input = ASIDE): StarSwarmState {
  for (let t = 0; t < ms; t += 16) s = tick(s, 16, input);
  return s;
}

/**
 * A wave settled into combat with nothing else going on: no dives, stragglers or rocks, every
 * non-Carrier ship's gun parked, and the player parked aside and untouchable — so only what the
 * Carrier does shows up.
 */
function settled(wave = 1, difficulty: DifficultyTier = "LieutenantJG", seed = 42): StarSwarmState {
  let s = initStarSwarm(CANVAS_W, CANVAS_H, wave, seed, difficulty);
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
    player: { ...s.player, x: 40, invincibleTimer: 1e9 },
    enemies: s.enemies.map((e) => (e.tier === "Carrier" ? e : { ...e, shootTimer: 1e9 })),
  };
}

const carrierOf = (s: StarSwarmState): Enemy =>
  s.enemies.find((e) => e.isAlive && e.tier === "Carrier")!;

function killWhere(s: StarSwarmState, pred: (e: Enemy) => boolean): StarSwarmState {
  return {
    ...s,
    enemies: s.enemies.map((e) => (e.isAlive && pred(e) ? { ...e, isAlive: false, hp: 0 } : e)),
  };
}

function withCarrier(s: StarSwarmState, patch: Partial<Enemy>): StarSwarmState {
  return {
    ...s,
    enemies: s.enemies.map((e) => (e.tier === "Carrier" ? { ...e, ...patch } : e)),
  };
}

/** Exposed: every Guardian dead, the rest of the wave alive. */
const exposed = (s: StarSwarmState) => killWhere(s, (e) => e.tier === "Guardian");
/** Final stand: the Carrier alone. */
const alone = (s: StarSwarmState) => killWhere(s, (e) => e.tier !== "Carrier");

function beamAt(x: number, y: number, over: Partial<CarrierBeam> = {}): CarrierBeam {
  return {
    id: 71_000,
    x,
    y: y + 10,
    vy: BEAM_SPEED,
    length: BEAM_LENGTH,
    halfWidth: BEAM_HALF_WIDTH,
    ...over,
  };
}

// ---------------------------------------------------------------------------

describe("Carrier stages (#2843)", () => {
  it("opens protected, becomes exposed the moment the last Guardian dies, then makes its final stand", () => {
    let s = settled();
    expect(carrierStage(s)).toBe("protected");
    expect(s.carrierStage).toBe("protected");

    // shoot the last Guardian down with a real shot
    s = killWhere(
      s,
      (e) => e.tier === "Guardian" && e !== s.enemies.find((g) => g.tier === "Guardian")
    );
    const last = s.enemies.find((e) => e.isAlive && e.tier === "Guardian")!;
    s = {
      ...s,
      enemies: s.enemies.map((e) => (e.id === last.id ? { ...e, hp: 1 } : e)),
      playerBullets: [
        {
          id: 70_001,
          x: last.x,
          y: last.y + 4,
          vx: 0,
          vy: 0,
          owner: "player",
          width: 5,
          height: 14,
          damage: 1,
        },
      ],
    };
    expect(carrierStage(s)).toBe("protected");
    const prev = s;
    s = tick(s, 16, ASIDE);
    expect(s.enemies.find((e) => e.id === last.id)!.isAlive).toBe(false);
    // exposed on the very tick of the kill
    expect(carrierStage(s)).toBe("exposed");
    expect(carrierJustExposed(prev, s)).toBe(true);
    // …and the engine acts on it from the next tick
    s = tick(s, 16, ASIDE);
    expect(s.carrierStage).toBe("exposed");

    // everything but the Carrier down → final stand
    const beforeFinal = s;
    s = alone(s);
    expect(carrierStage(s)).toBe("finalStand");
    expect(carrierFinalStandJustStarted(beforeFinal, s)).toBe(true);
    s = tick(s, 16, ASIDE);
    expect(s.carrierStage).toBe("finalStand");
  });

  it("a fleeing grunt doesn't hold the Carrier out of its final stand; no Carrier, no stage", () => {
    let s = alone(settled());
    const g = settled().enemies.find((e) => e.tier === "Grunt")!;
    s = { ...s, enemies: [...s.enemies, { ...g, id: 70_010, phase: "Fleeing" as const }] };
    expect(carrierStage(s)).toBe("finalStand");
    s = { ...s, enemies: [...s.enemies, { ...g, id: 70_011 }] };
    expect(carrierStage(s)).toBe("exposed");
    expect(carrierStage(killWhere(s, (e) => e.tier === "Carrier"))).toBeNull();
  });

  it("a boss wave's lone Carrier goes protected → final stand on the last Guardian kill, announced once", () => {
    const s = settled(5);
    expect(carrierStage(s)).toBe("protected");
    const next = killWhere(s, (e) => e.tier === "Guardian");
    expect(carrierStage(next)).toBe("finalStand");
    expect(carrierJustExposed(s, next)).toBe(true); // the armor drop is the announcement…
    expect(carrierFinalStandJustStarted(s, next)).toBe(false); // …not a second one on top
  });

  it("an escalation pulls the timers in: twin fire and attack runs roll fresh from the new stage", () => {
    let s = withCarrier(settled(), { shootTimer: 1e9, runTimer: 1e9 });
    s = tick(exposed(s), 16, ASIDE);
    const c = carrierOf(s);
    const twin = carrierCadenceBounds("twin", "exposed", "LieutenantJG", false)!;
    const run = carrierCadenceBounds("attackRun", "exposed", "LieutenantJG", false)!;
    expect(c.shootTimer).toBeGreaterThanOrEqual(twin.min - 16);
    expect(c.shootTimer).toBeLessThanOrEqual(twin.max);
    expect(c.runTimer).toBeGreaterThanOrEqual(run.min - 16);
    expect(c.runTimer).toBeLessThanOrEqual(run.max);

    // exposed → final stand: an idle beam that was far off comes within the final-stand range
    s = withCarrier(s, { beamTimer: 1e8 });
    s = tick(alone(s), 16, ASIDE);
    const beam = carrierCadenceBounds("beam", "finalStand", "LieutenantJG", false)!;
    expect(carrierOf(s).beamTimer).toBeLessThanOrEqual(beam.max);
  });

  it("an escalation pulls a pending reinforcement launch into the exposed range (seeded)", () => {
    for (const d of ["LieutenantJG", "Captain", "FleetAdmiral"] as const) {
      const exposedAfter = (seed: number) => {
        // a protected roll left far off, then the last Guardian dies
        const s = { ...settled(3, d, seed), reinforceTimer: 9_999_999 };
        return tick(exposed(s), 16, ASIDE).reinforceTimer;
      };
      const b = carrierCadenceBounds("reinforce", "exposed", d, false)!;
      const t = exposedAfter(11);
      expect(t).toBeLessThanOrEqual(b.max);
      expect(t).toBeGreaterThanOrEqual(b.min - 16);
      expect(exposedAfter(11)).toBe(t); // seeded
    }
    // a launch already due sooner keeps its time
    const s = { ...settled(3, "Captain"), reinforceTimer: 500 };
    expect(tick(exposed(s), 16, ASIDE).reinforceTimer).toBe(500 - 16);
  });

  it("stays protected-quiet: no twin fire and no attack run while a Guardian lives", () => {
    let s = withCarrier(settled(), { shootTimer: 0, runTimer: 0, beamTimer: 1e9 });
    s = alone(s);
    s = {
      ...s,
      reinforceTimer: 1e9,
      enemies: [
        ...s.enemies,
        { ...settled().enemies.find((e) => e.tier === "Guardian")!, shootTimer: 1e9 },
      ],
    };
    expect(carrierStage(s)).toBe("protected");
    for (let t = 0; t < 12_000; t += 16) {
      s = tick(s, 16, ASIDE);
      expect(s.enemyBullets).toHaveLength(0);
      expect(carrierOf(s).runPhase).toBe("idle");
      expect(carrierOf(s).phase).toBe("Formation");
    }
  });
});

// ---------------------------------------------------------------------------

describe("Carrier cadence: bounded, seeded, staged (#2843)", () => {
  const KINDS: readonly CarrierCadence[] = ["beam", "twin", "reinforce", "attackRun"];
  const mid = (r: { min: number; max: number }) => (r.min + r.max) / 2;

  it("which actions each stage has", () => {
    const has = (k: CarrierCadence, st: CarrierStage) =>
      carrierCadenceBounds(k, st, "LieutenantJG", false) !== null;
    expect(STAGES.map((st) => has("beam", st))).toEqual([true, true, true]);
    expect(STAGES.map((st) => has("twin", st))).toEqual([false, true, true]);
    expect(STAGES.map((st) => has("attackRun", st))).toEqual([false, true, true]);
    expect(STAGES.map((st) => has("reinforce", st))).toEqual([true, true, false]);
    expect(REINFORCE_COUNT.finalStand).toBeUndefined();
  });

  it("each stage is more aggressive than the last: shorter average downtime, never longer ranges", () => {
    for (const k of KINDS) {
      const ranges = STAGES.map((st) => CARRIER_CADENCE[k][st]).filter((r) => r !== undefined);
      for (let i = 1; i < ranges.length; i++) {
        expect(mid(ranges[i]!)).toBeLessThan(mid(ranges[i - 1]!));
        expect(ranges[i]!.max).toBeLessThanOrEqual(ranges[i - 1]!.max);
      }
    }
    // an exposed Carrier launches at least as many reinforcements as a protected one
    expect(REINFORCE_COUNT.exposed!.max).toBeGreaterThanOrEqual(REINFORCE_COUNT.protected!.max);
  });

  it("difficulty shortens every range (capped at 1.6×), a boss wave the beam only, never below the floor", () => {
    for (const k of KINDS) {
      for (const st of STAGES) {
        const base = CARRIER_CADENCE[k][st];
        if (!base) continue;
        let prevMax = Infinity;
        for (const d of DIFFICULTY_TIERS) {
          const b = carrierCadenceBounds(k, st, d, false)!;
          const div = Math.min(CARRIER_CADENCE_CAP, difficultyParamScale(d));
          expect(b.max).toBeCloseTo(Math.max(CARRIER_CADENCE_FLOOR[k], base.max / div), 6);
          expect(b.min).toBeGreaterThanOrEqual(CARRIER_CADENCE_FLOOR[k]);
          expect(b.min).toBeLessThanOrEqual(b.max);
          expect(b.max).toBeLessThanOrEqual(prevMax);
          prevMax = b.max;
        }
        const boss = carrierCadenceBounds(k, st, "LieutenantJG", true)!;
        const normal = carrierCadenceBounds(k, st, "LieutenantJG", false)!;
        const scale = k === "beam" ? BOSS_WAVE_BEAM_SCALE : 1;
        expect(boss.max).toBeCloseTo(Math.max(CARRIER_CADENCE_FLOOR[k], normal.max / scale), 6);
      }
    }
    // Admiral and Fleet Admiral both sit at the cap
    expect(carrierCadenceBounds("beam", "exposed", "Admiral", false)).toEqual(
      carrierCadenceBounds("beam", "exposed", "FleetAdmiral", false)
    );
    // fair minimum spacing even at the hardest setting on a boss wave
    expect(carrierCadenceBounds("beam", "finalStand", "FleetAdmiral", true)!.min).toBe(
      CARRIER_CADENCE_FLOOR.beam
    );
  });

  it("every roll lands within its bounds and they are not metronomic", () => {
    seedRng(123);
    for (const k of KINDS) {
      for (const st of STAGES) {
        const b = carrierCadenceBounds(k, st, "Commander", false);
        if (!b) continue;
        const rolls = Array.from({ length: 500 }, () =>
          rollCarrierCadence(k, st, "Commander", false)
        );
        for (const r of rolls) {
          expect(r).toBeGreaterThanOrEqual(b.min);
          expect(r).toBeLessThanOrEqual(b.max);
        }
        expect(new Set(rolls.map((r) => Math.round(r))).size).toBeGreaterThan(50);
        // the spread uses most of the range
        expect(Math.max(...rolls) - Math.min(...rolls)).toBeGreaterThan((b.max - b.min) * 0.8);
      }
    }
  });

  it("is seeded: the same seed replays the same rolls, another seed doesn't", () => {
    const seq = (seed: number) => {
      seedRng(seed);
      return Array.from({ length: 20 }, (_, i) =>
        rollCarrierCadence(KINDS[i % KINDS.length]!, "exposed", "Captain", i % 2 === 0)
      );
    };
    expect(seq(7)).toEqual(seq(7));
    expect(seq(7)).not.toEqual(seq(8));
  });

  it("an action its stage doesn't have returns the finite 'never' without drawing from the rng", () => {
    seedRng(99);
    const before = engineCounters().seed;
    expect(rollCarrierCadence("twin", "protected", "Captain", false)).toBe(CADENCE_INACTIVE_MS);
    expect(Number.isFinite(CADENCE_INACTIVE_MS)).toBe(true); // survives a JSON save
    expect(engineCounters().seed).toBe(before);
  });

  it("in play, twin volleys and beams keep to their stage's bounds, and replay exactly under a seed", () => {
    const run = (seed: number) => {
      let s = alone(settled(1, "LieutenantJG", seed));
      s = withCarrier(s, { runTimer: 1e9 }); // no attack runs: they'd hold nothing, but keep it simple
      s = tick(s, 16, ASIDE);
      const volleys: number[] = [];
      const charges: number[] = [];
      const releases: number[] = [];
      let t = 0;
      for (; t < 30_000; t += 16) {
        const prev = s;
        s = withCarrier(tick(s, 16, ASIDE), { runTimer: 1e9 });
        s = { ...s, enemyBullets: [] }; // keep the bullet cap out of it
        const c = carrierOf(s);
        if (c.shootTimer > carrierOf(prev).shootTimer) volleys.push(t);
        if (carrierBeamCharge(prev) === null && carrierBeamCharge(s) !== null) charges.push(t);
        if (carrierBeamJustFired(prev, s)) releases.push(t);
      }
      return { volleys, charges, releases };
    };
    const a = run(42);
    const twin = carrierCadenceBounds("twin", "finalStand", "LieutenantJG", false)!;
    const beam = carrierCadenceBounds("beam", "finalStand", "LieutenantJG", false)!;
    const gaps = (xs: number[]) => xs.slice(1).map((x, i) => x - xs[i]!);
    expect(a.volleys.length).toBeGreaterThan(20);
    for (const g of gaps(a.volleys)) {
      expect(g).toBeGreaterThanOrEqual(twin.min - 16);
      expect(g).toBeLessThanOrEqual(twin.max + 16);
    }
    expect(new Set(gaps(a.volleys)).size).toBeGreaterThan(3); // not metronomic
    // every release follows its charge by exactly the telegraph
    expect(a.releases.length).toBeGreaterThan(3);
    a.releases.forEach((r, i) => {
      expect(r - a.charges[i]!).toBeGreaterThanOrEqual(BEAM_CHARGE_MS - 16);
      expect(r - a.charges[i]!).toBeLessThanOrEqual(BEAM_CHARGE_MS + 16);
    });
    // idle gap from a release to the next charge
    a.releases.slice(0, -1).forEach((r, i) => {
      const gap = a.charges[i + 1]! - r;
      expect(gap).toBeGreaterThanOrEqual(beam.min - 16);
      expect(gap).toBeLessThanOrEqual(beam.max + 16);
    });
    // deterministic under the seed; another seed plays out differently
    expect(run(42)).toEqual(a);
    expect(run(43).volleys).not.toEqual(a.volleys);
  });

  it("finite capacity: one twin volley (two shots) per roll — no other Carrier gun exists", () => {
    let s = alone(settled());
    s = withCarrier(s, { runTimer: 1e9, beamTimer: 1e9 });
    s = tick(s, 16, ASIDE);
    let shots = 0;
    const T = 20_000;
    for (let t = 0; t < T; t += 16) {
      s = withCarrier(tick(s, 16, ASIDE), { runTimer: 1e9 });
      shots += s.enemyBullets.length;
      s = { ...s, enemyBullets: [] };
    }
    const twin = carrierCadenceBounds("twin", "finalStand", "LieutenantJG", false)!;
    expect(shots % 2).toBe(0);
    expect(shots / 2).toBeLessThanOrEqual(Math.ceil(T / twin.min) + 1);
    expect(shots / 2).toBeGreaterThanOrEqual(Math.floor(T / twin.max) - 1);
  });
});

// ---------------------------------------------------------------------------

describe("Carrier traveling beam (#2843)", () => {
  /** A protected Carrier a moment from releasing, the player parked aside. */
  function aboutToRelease(): StarSwarmState {
    return withCarrier(settled(), { beamPhase: "charge", beamTimer: 10 });
  }

  it("the release is an independent entity: killing the Carrier afterwards doesn't erase it", () => {
    let s = tick(aboutToRelease(), 16, ASIDE);
    expect(s.carrierBeams).toHaveLength(1);
    const id = s.carrierBeams[0]!.id;
    s = killWhere(s, (e) => e.tier === "Carrier");
    s = tick(s, 16, ASIDE);
    expect(s.carrierBeams.map((b) => b.id)).toEqual([id]);
    // …and it is still dangerous: steer under it and it costs a life
    const b = s.carrierBeams[0]!;
    s = {
      ...s,
      player: { ...s.player, x: b.x, invincibleTimer: 0 },
      carrierBeams: [{ ...b, y: s.player.y + 10 }],
    };
    const lives = s.player.lives;
    s = tick(s, 16, { playerX: b.x, fire: false });
    expect(s.player.lives).toBe(lives - 1);
    expect(s.carrierBeams).toHaveLength(0);
  });

  it("killing the Carrier mid-charge cancels only the charge — nothing is ever released", () => {
    let s = withCarrier(settled(), { beamPhase: "charge", beamTimer: 300 });
    const earlier = beamAt(300, 200, { id: 71_111 });
    s = { ...s, carrierBeams: [earlier] };
    expect(carrierBeamCharge(s)).not.toBeNull();
    s = killWhere(s, (e) => e.tier === "Carrier");
    expect(carrierBeamCharge(s)).toBeNull();
    for (let t = 0; t < 1000; t += 16) {
      const prev = s;
      s = tick(s, 16, ASIDE);
      expect(s.carrierBeams.every((b) => b.id === earlier.id)).toBe(true);
      expect(carrierBeamJustFired(prev, s)).toBe(false);
    }
  });

  it("an earlier beam stays in flight while the Carrier charges and releases the next", () => {
    let s = { ...aboutToRelease(), carrierBeams: [beamAt(300, 150, { id: 71_222 })] };
    s = tick(s, 16, ASIDE);
    expect(s.carrierBeams).toHaveLength(2);
    expect(s.carrierBeams[0]!.id).toBe(71_222);
  });

  it("lives through the wave-clear extraction, then the wave reset removes it", () => {
    let s = tick(aboutToRelease(), 16, ASIDE);
    s = { ...s, carrierBeams: s.carrierBeams.map((b) => ({ ...b, vy: 0.005 })) }; // crawl
    s = killWhere(s, () => true);
    s = tick(s, 16, ASIDE);
    expect(s.phase).toBe("Extraction");
    expect(s.carrierBeams).toHaveLength(1);
    // the autopilot sees it
    expect(liveHazards(s).some((h) => h.r === BEAM_HALF_WIDTH)).toBe(true);
    for (let t = 0; t < 8000 && s.wave === 1; t += 16) s = tick(s, 16, ASIDE);
    expect(s.wave).toBe(2);
    expect(s.carrierBeams).toEqual([]);
    expect(clearTransientCombat({ ...s, carrierBeams: [beamAt(1, 1)] }).carrierBeams).toEqual([]);
  });

  it("the enemy-fire dev toggle keeps a charge from releasing anything", () => {
    let s = { ...aboutToRelease(), enemyFireDisabled: true };
    s = tick(s, 16, ASIDE);
    expect(s.carrierBeams).toHaveLength(0);
    expect(carrierOf(s).beamPhase).toBe("idle");
  });

  it("a Smart Bomb clears released beams (enemy projectiles), not a charge still on the Carrier", () => {
    const s = { ...withCarrier(settled(), { beamPhase: "charge" as const, beamTimer: 400 }) };
    const withBeam = { ...s, carrierBeams: [beamAt(300, 300)] };
    // collect a bomb pickup
    const bombed = tick(
      {
        ...withBeam,
        powerUps: [
          {
            id: 71_333,
            type: "bomb",
            x: withBeam.player.x,
            y: withBeam.player.y,
            vy: 0,
            width: 24,
            height: 24,
            despawnTimer: 5000,
          },
        ],
      },
      16,
      ASIDE
    );
    expect(bombed.carrierBeams).toEqual([]);
    expect(carrierBeamCharge(bombed)).not.toBeNull();
  });

  it("saves and restores with beams in flight and a Carrier on its attack run", () => {
    let s = tick(aboutToRelease(), 16, ASIDE);
    s = withCarrier(exposed(s), { runPhase: "brace", runTimer: 10 });
    s = advance(s, 64);
    expect(carrierOf(s).phase).toBe("AttackRun");
    expect(s.carrierBeams.length).toBeGreaterThan(0);
    const restored: unknown = JSON.parse(JSON.stringify(s));
    expect(fitsSaveShape(restored)).toBe(true);
    expect(restored).toEqual(s);
  });
});

// ---------------------------------------------------------------------------

describe("Carrier reinforcements: original-Grunt population ceiling (#2843)", () => {
  const liveGrunts = (s: StarSwarmState) =>
    s.enemies.filter((e) => e.isAlive && e.tier === "Grunt");
  const slotKey = (e: Enemy) => `${e.formationX},${e.formationY}`;

  it("refills only vacant original Grunt slots and never exceeds the wave's original Grunt count", () => {
    let s = settled(3, "Captain");
    const original = new Set(liveGrunts(s).map(slotKey));
    expect(original.size).toBe(originalGruntCount(3));
    let launchedTotal = 0;
    for (let round = 0; round < 40; round++) {
      // knock out a few grunts each round, then let a launch happen
      const alive = liveGrunts(s);
      const victims = new Set(alive.filter((_, i) => i % 3 === round % 3).map((e) => e.id));
      s = killWhere(s, (e) => victims.has(e.id));
      const prev = { ...s, reinforceTimer: 1 };
      s = tick(prev, 16, ASIDE);
      if (reinforcementsJustLaunched(prev, s)) launchedTotal++;
      const now = liveGrunts(s);
      expect(now.length).toBeLessThanOrEqual(originalGruntCount(3));
      expect(now.every((e) => original.has(slotKey(e)))).toBe(true);
      expect(new Set(now.map(slotKey)).size).toBe(now.length); // one grunt per slot
    }
    expect(launchedTotal).toBeGreaterThan(0);
    expect(s.reinforcedThisWave).toBeLessThanOrEqual(reinforceCap(3));
  });

  it("the ceiling holds even when a vacant slot exists but the population is already full", () => {
    let s = settled(1, "Captain");
    const grunts = liveGrunts(s);
    const moved = grunts[0]!;
    // one grunt knocked out, and an extra grunt present off the grid (e.g. an injected ship)
    s = killWhere(s, (e) => e.id === moved.id);
    s = {
      ...s,
      enemies: [...s.enemies, { ...moved, id: 72_000, isAlive: true, hp: 1, formationY: 9999 }],
      reinforceTimer: 1,
    };
    expect(liveGrunts(s)).toHaveLength(originalGruntCount(1));
    const prev = s;
    s = tick(s, 16, ASIDE);
    expect(reinforcementsJustLaunched(prev, s)).toBe(false);
  });

  it("the launch count and interval are seeded rolls from the stage's ranges", () => {
    const launch = (seed: number, stage: "protected" | "exposed") => {
      let s = settled(3, "Captain", seed);
      if (stage === "exposed") s = tick(exposed(s), 16, ASIDE);
      s = killWhere(s, (e) => e.tier === "Grunt");
      const before = s.enemies.length;
      s = tick({ ...s, reinforceTimer: 1 }, 16, ASIDE);
      return { n: s.enemies.length - before, timer: s.reinforceTimer };
    };
    for (const stage of ["protected", "exposed"] as const) {
      const counts = new Set<number>();
      for (let seed = 1; seed <= 12; seed++) {
        const { n, timer } = launch(seed, stage);
        counts.add(n);
        expect(n).toBeGreaterThanOrEqual(REINFORCE_COUNT[stage]!.min);
        expect(n).toBeLessThanOrEqual(REINFORCE_COUNT[stage]!.max);
        const b = carrierCadenceBounds("reinforce", stage, "Captain", false)!;
        expect(timer).toBeGreaterThanOrEqual(b.min);
        expect(timer).toBeLessThanOrEqual(b.max);
      }
      expect(counts.size).toBeGreaterThan(1);
      expect(launch(5, stage)).toEqual(launch(5, stage));
    }
  });

  it("a wave with zero original Grunts (a boss wave) produces none, however long it runs", () => {
    expect(originalGruntCount(5)).toBe(0);
    expect(reinforceCap(5)).toBe(0);
    let s = settled(5, "FleetAdmiral");
    for (let t = 0; t < 30_000; t += 16) {
      s = tick({ ...s, reinforceTimer: Math.min(s.reinforceTimer, 1) }, 16, ASIDE);
      s = { ...s, enemyBullets: [] };
    }
    expect(s.reinforcedThisWave).toBe(0);
    expect(s.enemies.some((e) => e.tier === "Grunt")).toBe(false);
  });

  it("a Carrier making its final stand launches none — it has committed everything", () => {
    let s = tick(alone(settled(3, "Captain")), 16, ASIDE);
    expect(carrierStage(s)).toBe("finalStand");
    s = tick({ ...s, reinforceTimer: 1 }, 16, ASIDE);
    expect(s.reinforcedThisWave).toBe(0);
  });
});

// ---------------------------------------------------------------------------

describe("Carrier attack run (#2843)", () => {
  function track(s: StarSwarmState, ms: number) {
    const ys: number[] = [];
    const phases = new Set<string>();
    let braceAt = -1;
    let runAt = -1;
    let backAt = -1;
    for (let t = 0; t < ms; t += 16) {
      const prev = s;
      s = tick(s, 16, ASIDE);
      const c = carrierOf(s);
      phases.add(c.phase);
      ys.push(c.y);
      if (carrierAttackRunJustStarted(prev, s) && braceAt < 0) braceAt = t;
      if (carrierOf(prev).phase !== "AttackRun" && c.phase === "AttackRun" && runAt < 0) runAt = t;
      if (
        runAt >= 0 &&
        backAt < 0 &&
        carrierOf(prev).phase === "AttackRun" &&
        c.phase === "Formation"
      )
        backAt = t;
    }
    return { s, ys, phases, braceAt, runAt, backAt };
  }

  it("exposed: brace (telegraph) → a heavy swoop toward the player's column → back on station", () => {
    let s = tick(exposed(settled()), 16, ASIDE);
    s = withCarrier(s, { runTimer: 50, beamTimer: 1e9 });
    const home = carrierOf(s);
    const r = track(s, 6000);
    expect(r.braceAt).toBeGreaterThanOrEqual(0);
    expect(r.runAt - r.braceAt).toBeGreaterThanOrEqual(ATTACK_RUN_BRACE_MS - 16);
    expect(r.runAt - r.braceAt).toBeLessThanOrEqual(ATTACK_RUN_BRACE_MS + 32);
    expect(r.backAt - r.runAt).toBeGreaterThanOrEqual(ATTACK_RUN.exposed.ms - 32);
    expect(r.backAt - r.runAt).toBeLessThanOrEqual(ATTACK_RUN.exposed.ms + 32);
    // its own pattern — never the formation's dive/circle states
    expect([...r.phases].sort()).toEqual(["AttackRun", "Formation"]);
    // reaches well down the screen, never into the player lane
    const deepest = Math.max(...r.ys);
    expect(deepest).toBeGreaterThan(home.formationY + 100);
    expect(deepest).toBeLessThan(r.s.player.y - 150);
    // back where it started, with its next run a fresh roll
    const c = carrierOf(r.s);
    expect(c.phase).toBe("Formation");
    expect(c.y).toBe(home.formationY);
    const b = carrierCadenceBounds("attackRun", "exposed", "LieutenantJG", false)!;
    expect(c.runTimer).toBeLessThanOrEqual(b.max);
  });

  it("the brace is a readable telegraph: it rears back and targets where the player was", () => {
    let s = tick(exposed(settled()), 16, ASIDE);
    s = withCarrier(s, { runTimer: 1, beamTimer: 1e9 });
    s = tick(s, 16, { playerX: 250, fire: false });
    expect(carrierOf(s).runPhase).toBe("brace");
    expect(carrierRunBrace(s)).not.toBeNull();
    expect(carrierOf(s).diveTargetX).toBe(250);
    s = advance(s, ATTACK_RUN_BRACE_MS / 2);
    expect(carrierOf(s).y).toBeLessThan(carrierOf(s).formationY); // reared up
  });

  it("the final stand's run is deeper and quicker than the exposed one", () => {
    expect(ATTACK_RUN.finalStand.depth).toBeGreaterThan(ATTACK_RUN.exposed.depth);
    expect(ATTACK_RUN.finalStand.ms).toBeLessThan(ATTACK_RUN.exposed.ms);
    const depth = (make: (s: StarSwarmState) => StarSwarmState) => {
      let s = tick(make(settled()), 16, ASIDE);
      s = withCarrier(s, { runTimer: 1, beamTimer: 1e9 });
      return Math.max(...track(s, 5000).ys);
    };
    expect(depth(alone)).toBeGreaterThan(depth(exposed));
  });

  it("telegraphs never overlap: no brace while a beam charges; exposed holds the beam during a run", () => {
    // a charge in progress holds the brace back until the release
    let s = tick(exposed(settled()), 16, ASIDE);
    s = withCarrier(s, { runTimer: 1, beamPhase: "charge", beamTimer: 300 });
    for (let t = 0; t < 300; t += 16) {
      s = tick(s, 16, ASIDE);
      const c = carrierOf(s);
      expect(c.beamPhase === "charge" && c.runPhase === "brace").toBe(false);
    }
    // on an exposed run, no charge starts
    s = withCarrier(tick(exposed(settled()), 16, ASIDE), { runTimer: 1, beamTimer: 1e9 });
    s = advance(s, ATTACK_RUN_BRACE_MS + 32);
    expect(carrierOf(s).phase).toBe("AttackRun");
    s = withCarrier(s, { beamTimer: 1 });
    for (let t = 0; t < 1500; t += 16) {
      s = tick(s, 16, ASIDE);
      if (carrierOf(s).phase === "AttackRun") expect(carrierOf(s).beamPhase).toBe("idle");
    }
  });

  it("in the final stand beam, direct fire and movement combine — a beam can release mid-run", () => {
    let s = withCarrier(tick(alone(settled()), 16, ASIDE), { runTimer: 1, beamTimer: 1e9 });
    s = advance(s, ATTACK_RUN_BRACE_MS + 32);
    expect(carrierOf(s).phase).toBe("AttackRun");
    s = withCarrier(s, { beamTimer: 1 });
    let released = false;
    for (let t = 0; t < 1500 && !released; t += 16) {
      const prev = s;
      s = tick(s, 16, ASIDE);
      if (carrierBeamJustFired(prev, s)) released = carrierOf(prev).phase === "AttackRun";
    }
    expect(released).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe("Boss wave: the lone Carrier stays an active climax (#2843)", () => {
  it("with its Guardians gone it fires, beams and makes attack runs — the wave never stalls", () => {
    let s = tick(
      killWhere(settled(5), (e) => e.tier === "Guardian"),
      16,
      ASIDE
    );
    expect(carrierStage(s)).toBe("finalStand");
    let volleys = 0;
    let beams = 0;
    let runs = 0;
    for (let t = 0; t < 20_000; t += 16) {
      const prev = s;
      s = tick(s, 16, ASIDE);
      if (s.enemyBullets.length > 0) volleys++;
      s = { ...s, enemyBullets: [] };
      if (carrierBeamJustFired(prev, s)) beams++;
      if (carrierAttackRunJustStarted(prev, s)) runs++;
    }
    expect(s.wave).toBe(5);
    expect(carrierOf(s).isAlive).toBe(true);
    expect(volleys).toBeGreaterThan(15);
    expect(beams).toBeGreaterThanOrEqual(3);
    expect(runs).toBeGreaterThanOrEqual(2);
  });
});
