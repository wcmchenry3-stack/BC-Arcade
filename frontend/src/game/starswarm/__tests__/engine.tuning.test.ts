/**
 * Star Swarm engine tests: difficulty tiers and their multipliers.
 *
 * One file per `engine/` module (#2988): this file follows `engine/tuning.ts`. Split out of
 * the former monolithic `engine.test.ts` (#2955) with describe blocks moved whole; shared fixtures
 * live in `helpers/engineFixtures.ts`.
 */
import {
  initStarSwarm,
  tick,
  seedRng,
  _resetIds,
  applyPowerUp,
  buddyBurstCount,
  CANVAS_W,
  CANVAS_H,
  DIFFICULTY_TIERS,
  difficultyMultiplier,
  difficultyParamScale,
  difficultyLabel,
  DEFAULT_TUNING,
  BUDDY_HP,
  BUDDY_SPEED,
  BUDDY_REPLAN_MS,
  BUDDY_BURSTS,
  BUDDY_BULLET_COUNT_MIN,
  BUDDY_BULLET_COUNT_MAX,
  BUDDY_PIERCE_HITS,
  BUDDY_SPREAD_HALF,
  BUDDY_STANDOFF,
  BUDDY_STRAFE,
  BUDDY_NOTICE,
  BUDDY_NOTICE_AIMED,
  BUDDY_MAX_INCOMING,
  BUDDY_TARGETING,
  CARRIER_CADENCE,
  CARRIER_CADENCE_CAP,
  type Tuning,
} from "../engine";
import type { Bullet, DifficultyTier, StarSwarmState } from "../types";
import { FIRE_INPUT, NO_INPUT, advanceMs, runExtraction } from "./helpers/engineFixtures";

beforeEach(() => {
  seedRng(42);
  _resetIds();
});

// ---------------------------------------------------------------------------
// #1037 — Difficulty tiers
// ---------------------------------------------------------------------------

describe("#1037 Difficulty tiers", () => {
  it("DIFFICULTY_TIERS has 10 entries ordered Ensign→FleetAdmiral", () => {
    expect(DIFFICULTY_TIERS.length).toBe(10);
    expect(DIFFICULTY_TIERS[0]).toBe("Ensign");
    expect(DIFFICULTY_TIERS[9]).toBe("FleetAdmiral");
  });

  it("difficultyMultiplier returns 1 for Ensign and 10 for FleetAdmiral", () => {
    expect(difficultyMultiplier("Ensign")).toBe(1);
    expect(difficultyMultiplier("FleetAdmiral")).toBe(10);
  });

  it("difficultyMultiplier returns a positive number for every tier", () => {
    for (const tier of DIFFICULTY_TIERS) {
      expect(difficultyMultiplier(tier)).toBeGreaterThan(0);
    }
  });

  it("difficultyParamScale returns 0.7 for Ensign and 3.0 for FleetAdmiral", () => {
    expect(difficultyParamScale("Ensign")).toBeCloseTo(0.7);
    expect(difficultyParamScale("FleetAdmiral")).toBeCloseTo(3.0);
  });

  it("difficultyLabel returns a non-empty string for every tier", () => {
    for (const tier of DIFFICULTY_TIERS) {
      expect(difficultyLabel(tier).length).toBeGreaterThan(0);
    }
  });

  it("initStarSwarm stores difficulty in state", () => {
    const tiers: DifficultyTier[] = ["Ensign", "Captain", "FleetAdmiral"];
    for (const tier of tiers) {
      const s = initStarSwarm(CANVAS_W, CANVAS_H, 1, 42, tier);
      expect(s.difficulty).toBe(tier);
    }
  });

  it("Ensign disables straggler; all other tiers enable it", () => {
    const ensign = initStarSwarm(CANVAS_W, CANVAS_H, 1, 42, "Ensign");
    expect(ensign.stragglerEnabled).toBe(false);
    for (const tier of DIFFICULTY_TIERS.filter((t) => t !== "Ensign")) {
      const s = initStarSwarm(CANVAS_W, CANVAS_H, 1, 42, tier);
      expect(s.stragglerEnabled).toBe(true);
    }
  });

  it("score multiplier is applied: FleetAdmiral kill worth 10× base", () => {
    let base = initStarSwarm(CANVAS_W, CANVAS_H, 1, 42, "Ensign");
    let hard = initStarSwarm(CANVAS_W, CANVAS_H, 1, 42, "FleetAdmiral");
    base = advanceMs(base, 8000);
    hard = advanceMs(hard, 8000);
    expect(base.phase).toBe("Playing");
    expect(hard.phase).toBe("Playing");

    const gruntBase = base.enemies.find((e) => e.isAlive && e.tier === "Grunt");
    const gruntHard = hard.enemies.find((e) => e.isAlive && e.tier === "Grunt");
    if (!gruntBase || !gruntHard) throw new Error("no grunt found");

    const kill = (s: StarSwarmState, id: number): StarSwarmState => {
      const e = s.enemies.find((en) => en.id === id)!;
      const b: Bullet = {
        id: 55500 + id,
        x: e.x,
        y: e.y,
        vx: 0,
        vy: 0,
        owner: "player",
        width: e.width,
        height: e.height,
        damage: 999,
      };
      return tick({ ...s, playerBullets: [b] }, 16, NO_INPUT);
    };

    const scoreBase = kill(base, gruntBase.id).score;
    const scoreHard = kill(hard, gruntHard.id).score;
    expect(scoreHard).toBe(scoreBase * 10);
  });

  it("difficulty carries over to next wave", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H, 1, 42, "Admiral");
    s = advanceMs(s, 8000);
    s = { ...s, enemies: s.enemies.map((e) => ({ ...e, isAlive: false, hp: 0 })) };
    s = tick(s, 16, NO_INPUT);
    s = advanceMs(s, 3000);
    expect(s.wave).toBe(2);
    expect(s.difficulty).toBe("Admiral");
  });

  it("wave clear bonus is multiplied by difficulty", () => {
    let base = initStarSwarm(CANVAS_W, CANVAS_H, 1, 42, "Ensign");
    let hard = initStarSwarm(CANVAS_W, CANVAS_H, 1, 42, "Captain"); // ×4
    base = advanceMs(base, 8000);
    hard = advanceMs(hard, 8000);

    // Kill all enemies to trigger wave clear bonus
    const wipeAll = (s: StarSwarmState): StarSwarmState => ({
      ...s,
      enemies: s.enemies.map((e) => ({ ...e, isAlive: false, hp: 0 })),
    });
    base = runExtraction(tick(wipeAll(base), 16, NO_INPUT));
    hard = runExtraction(tick(wipeAll(hard), 16, NO_INPUT));

    // Both should have advanced to wave 2, and hard score should be ≥ 4× base score
    expect(base.wave).toBe(2);
    expect(hard.wave).toBe(2);
    expect(hard.score).toBeGreaterThanOrEqual(base.score * 4);
  });
});

// ---------------------------------------------------------------------------
// #2988 — injectable Tuning
// ---------------------------------------------------------------------------

describe("#2988 injectable Tuning", () => {
  it("DEFAULT_TUNING is the shipped constants, and its prototype knobs are off", () => {
    expect(DEFAULT_TUNING.BUDDY_HP).toBe(BUDDY_HP);
    expect(DEFAULT_TUNING.BUDDY_SPEED).toBe(BUDDY_SPEED);
    expect(DEFAULT_TUNING.BUDDY_REPLAN_MS).toBe(BUDDY_REPLAN_MS);
    expect(DEFAULT_TUNING.BUDDY_BURSTS).toBe(BUDDY_BURSTS);
    expect(DEFAULT_TUNING.BUDDY_BULLET_COUNT_MIN).toBe(BUDDY_BULLET_COUNT_MIN);
    expect(DEFAULT_TUNING.BUDDY_BULLET_COUNT_MAX).toBe(BUDDY_BULLET_COUNT_MAX);
    expect(DEFAULT_TUNING.BUDDY_PIERCE_HITS).toBe(BUDDY_PIERCE_HITS);
    expect(DEFAULT_TUNING.BUDDY_SPREAD_HALF).toBe(BUDDY_SPREAD_HALF);
    expect(DEFAULT_TUNING.BUDDY_STANDOFF).toBe(BUDDY_STANDOFF);
    expect(DEFAULT_TUNING.BUDDY_STRAFE).toBe(BUDDY_STRAFE);
    expect(DEFAULT_TUNING.BUDDY_NOTICE).toBe(BUDDY_NOTICE);
    expect(DEFAULT_TUNING.BUDDY_NOTICE_AIMED).toBe(BUDDY_NOTICE_AIMED);
    expect(DEFAULT_TUNING.BUDDY_MAX_INCOMING).toBe(BUDDY_MAX_INCOMING);
    expect(DEFAULT_TUNING.BUDDY_TARGETING).toBe(BUDDY_TARGETING);
    expect(DEFAULT_TUNING.CARRIER_CADENCE).toBe(CARRIER_CADENCE);
    // the shipped values of the knobs the simulator used to patch into the source
    expect(DEFAULT_TUNING.BUDDY_SHOT_DAMAGE).toBe(1);
    expect(DEFAULT_TUNING.BUDDY_LANE_FLOOR).toBe(0.4);
    expect(DEFAULT_TUNING.CARRIER_RUN_AT_BUDDY).toBe(false);
    expect(DEFAULT_TUNING.CARRIER_TRACK_BUDDY_SPEED).toBe(0);
  });

  it("tick without a tuning is tick with DEFAULT_TUNING, state for state", () => {
    const run = (tuning?: Tuning): StarSwarmState => {
      _resetIds();
      let s = initStarSwarm(CANVAS_W, CANVAS_H, 3, 42, "Captain");
      s = advanceMs(s, 8000);
      s = applyPowerUp(s, "buddy", tuning);
      for (let t = 0; t < 3000; t += 16) s = tick(s, 16, FIRE_INPUT, tuning);
      return s;
    };
    const random = jest.spyOn(Math, "random").mockReturnValue(0.5);
    try {
      expect(run(DEFAULT_TUNING)).toEqual(run());
    } finally {
      random.mockRestore();
    }
  });

  it("a tuning override reaches Buddy's launch, bursts and shots, and the Carrier's cadence", () => {
    const tuning: Tuning = {
      ...DEFAULT_TUNING,
      BUDDY_HP: 123,
      BUDDY_BURSTS: 7,
      BUDDY_BULLET_COUNT_MIN: 6,
      BUDDY_BULLET_COUNT_MAX: 6,
      BUDDY_PIERCE_HITS: Infinity,
      BUDDY_SHOT_DAMAGE: 0.5,
      CARRIER_CADENCE: {
        ...DEFAULT_TUNING.CARRIER_CADENCE,
        beam: { protected: { min: 99_000, max: 99_000 } },
      },
    };
    _resetIds();
    const s0 = initStarSwarm(CANVAS_W, CANVAS_H, 3, 42, "Captain", undefined, tuning);
    const carrier = s0.enemies.find((e) => e.tier === "Carrier")!;
    expect(carrier.beamTimer).toBeGreaterThanOrEqual(99_000 / CARRIER_CADENCE_CAP - 1);
    let s = advanceMs(s0, 8000);
    s = applyPowerUp(s, "buddy", tuning);
    expect(s.buddyShips[0]!.hp).toBe(123);
    expect(s.buddyShips[0]!.burstsLeft).toBe(7);
    expect(buddyBurstCount(s.buddyShips[0]!, tuning)).toBe(6);
    s = { ...s, player: { ...s.player, invincibleTimer: 999_999 }, enemyFireDisabled: true };
    let fan: Bullet[] = [];
    for (let t = 0; t < 4000 && fan.length === 0; t += 16) {
      s = tick(s, 16, NO_INPUT, tuning);
      fan = s.playerBullets.filter((b) => b.source === "buddy");
    }
    expect(fan.length).toBe(6);
    for (const b of fan) {
      expect(b.damage).toBe(0.5);
      expect(b.pierceLeft).toBe(Infinity);
    }
  });

  it("the Carrier tracks an on-station Buddy only when CARRIER_TRACK_BUDDY_SPEED is set", () => {
    const station = (speed: number): number => {
      _resetIds();
      const tuning: Tuning = { ...DEFAULT_TUNING, CARRIER_TRACK_BUDDY_SPEED: speed };
      let s = initStarSwarm(CANVAS_W, CANVAS_H, 5, 42, "Captain", undefined, tuning);
      s = advanceMs(s, 8000);
      // expose the Carrier and park a Buddy on station far to one side
      s = {
        ...s,
        enemies: s.enemies.map((e) =>
          e.tier === "Guardian" ? { ...e, isAlive: false, hp: 0 } : e
        ),
        player: { ...s.player, invincibleTimer: 999_999 },
      };
      s = applyPowerUp(s, "buddy", tuning);
      s = {
        ...s,
        buddyShips: s.buddyShips.map((b) => ({
          ...b,
          phase: "OnStation" as const,
          x: 40,
          goalX: 40,
        })),
      };
      for (let t = 0; t < 1000; t += 16) s = tick(s, 16, NO_INPUT, tuning);
      return s.enemies.find((e) => e.tier === "Carrier")!.formationX;
    };
    const centre = CANVAS_W / 2;
    expect(station(0)).toBe(centre);
    expect(station(0.1)).toBeLessThan(centre);
  });
});
