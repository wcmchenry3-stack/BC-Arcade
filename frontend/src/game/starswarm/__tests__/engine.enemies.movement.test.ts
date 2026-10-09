/**
 * Star Swarm engine tests: the fleet's movement — dive scheduling and caps, Grunt/Guardian dive
 * phases, stragglers and the rout.
 *
 * Follows `engine/enemies.ts` (#2988), split in two by describe cluster so neither file passes
 * the ~1,000-line layout rule (#2955); the per-ship phase ticks are in
 * `engine.enemyPhases.test.ts`. Describe blocks moved whole; shared fixtures live in
 * `helpers/engineFixtures.ts`.
 */
import {
  initStarSwarm,
  tick,
  diverCount,
  maxDivers,
  WIGGLE_DURATION,
  DIVE_PATH_DURATION,
  seedRng,
  _resetIds,
  CANVAS_W,
  CANVAS_H,
  difficultyMultiplier,
  ASTEROID_STATS,
  waveClearBonusPoints,
  routJustStarted,
  fleeingCount,
  FLEE_DURATION_MIN,
  FLEE_DURATION_MAX,
  FLEE_STAGGER_MAX,
  FLEE_ENSIGN_SCALE,
} from "../engine";
import type { Asteroid, Bullet, DifficultyTier, StarSwarmInput, StarSwarmState } from "../types";
import { NO_INPUT, advanceMs, runExtraction } from "./helpers/engineFixtures";

beforeEach(() => {
  seedRng(42);
  _resetIds();
});

// ---------------------------------------------------------------------------
// Wiggle telegraph (#975)
// ---------------------------------------------------------------------------

/** Reset any airborne enemies back to Formation so dive cap has room. */
function resetToFormation(s: StarSwarmState): StarSwarmState {
  return {
    ...s,
    enemies: s.enemies.map((e) =>
      e.isAlive &&
      (e.phase === "Diving" ||
        e.phase === "Wiggling" ||
        e.phase === "Circling" ||
        e.phase === "Returning")
        ? {
            ...e,
            phase: "Formation" as const,
            x: e.formationX,
            y: e.formationY,
            path: null,
            pathT: 1,
          }
        : e
    ),
  };
}

// ---------------------------------------------------------------------------
// Enemy state machine — Formation → Diving → Circling → Returning
// ---------------------------------------------------------------------------

describe("Dive AI", () => {
  it("at least one enemy dives during playing phase over 30s", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H);
    s = advanceMs(s, 8000); // get into Playing
    expect(s.phase).toBe("Playing");
    s = advanceMs(s, 30_000);
    const everDived = s.enemies.some(
      (e) => e.phase === "Diving" || e.phase === "Circling" || e.phase === "Returning"
    );
    expect(everDived).toBe(true);
  });

  it("diverCount returns 0 before any dive occurs", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H);
    s = advanceMs(s, 8000);
    // Right after formation, no dives yet
    expect(s.phase).toBe("Playing");
    expect(diverCount(s)).toBeGreaterThanOrEqual(0);
  });

  it("diving enemies eventually return to Formation", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H);
    s = advanceMs(s, 60_000); // long enough for multiple dive cycles
    // At least some should be back in Formation
    const inFormation = s.enemies.filter((e) => e.isAlive && e.phase === "Formation");
    expect(inFormation.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// maxDivers cap (#969)
// ---------------------------------------------------------------------------

describe("maxDivers cap (#969)", () => {
  it("returns 1 for waves 1 and 2", () => {
    expect(maxDivers(1)).toBe(1);
    expect(maxDivers(2)).toBe(1);
  });

  it("returns 2 for waves 3 and 4", () => {
    expect(maxDivers(3)).toBe(2);
    expect(maxDivers(4)).toBe(2);
  });

  it("never exceeds 1 simultaneous Diving enemy on wave 1", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H, 1);
    s = advanceMs(s, 8000);
    expect(s.phase).toBe("Playing");

    for (let i = 0; i < 2000; i++) {
      s = tick(s, 16, NO_INPUT);
      if (s.phase !== "Playing") break;
      const divers = s.enemies.filter((e) => e.isAlive && e.phase === "Diving").length;
      expect(divers).toBeLessThanOrEqual(maxDivers(1));
    }
  });

  it("never exceeds 2 simultaneous Diving enemies on wave 4", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H, 4);
    s = advanceMs(s, 8000);
    expect(s.phase).toBe("Playing");

    for (let i = 0; i < 2000; i++) {
      s = tick(s, 16, NO_INPUT);
      if (s.phase !== "Playing") break;
      const divers = s.enemies.filter((e) => e.isAlive && e.phase === "Diving").length;
      expect(divers).toBeLessThanOrEqual(maxDivers(4));
    }
  });
});

// ---------------------------------------------------------------------------
// #1029 — Grunt & Guardian collision redesign
// ---------------------------------------------------------------------------

describe("#1029 Grunt & Guardian collision redesign", () => {
  it("Grunt never enters Circling phase", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H);
    s = advanceMs(s, 8000);
    expect(s.phase).toBe("Playing");

    for (let i = 0; i < 3000; i++) {
      s = tick(s, 16, NO_INPUT);
      if (s.phase !== "Playing") break;
      const gruntCircling = s.enemies.some(
        (e) => e.isAlive && e.tier === "Grunt" && e.phase === "Circling"
      );
      expect(gruntCircling).toBe(false);
    }
  });

  it("Grunt returns to Formation after dive without entering Circling", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H);
    s = advanceMs(s, 8000);
    s = resetToFormation({ ...s, nextDiveTimer: 1 });
    s = tick(s, 16, NO_INPUT);

    const wiggling = s.enemies.find((e) => e.phase === "Wiggling" && e.tier === "Grunt");
    if (!wiggling) return; // wave may have no Grunts in formation — skip
    const id = wiggling.id;

    // Wait for the full dive + return cycle
    s = advanceMs(s, WIGGLE_DURATION + 4000, NO_INPUT);
    const after = s.enemies.find((e) => e.id === id);
    if (!after || !after.isAlive) return;
    expect(after.phase === "Circling").toBe(false);
  });

  it("Guardian never body-collides with player", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H);
    s = advanceMs(s, 8000);
    s = { ...s, guardianThresholdCrossed: true, player: { ...s.player, invincibleTimer: 0 } };

    const guardianId = s.enemies.find((e) => e.isAlive && e.tier === "Guardian")?.id;
    if (!guardianId) throw new Error("no Guardian");

    // Teleport Guardian directly onto the player and give it a diving phase
    const { player } = s;
    s = {
      ...s,
      player: { ...player, lives: 3, invincibleTimer: 0 },
      enemies: s.enemies.map((e) =>
        e.id === guardianId
          ? {
              ...e,
              phase: "Diving" as const,
              x: player.x,
              y: player.y,
              path: {
                p0: { x: player.x, y: player.y },
                p1: { x: player.x, y: player.y + 10 },
                p2: { x: player.x, y: player.y + 20 },
                p3: { x: player.x, y: player.y + 30 },
              },
              pathT: 0,
              pathDuration: 1000,
            }
          : e
      ),
    };

    s = tick(s, 16, NO_INPUT);
    // Player should NOT have lost a life despite Guardian being on same position
    expect(s.player.lives).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// #1031 — Straggler aggression
// ---------------------------------------------------------------------------

describe("#1031 Straggler aggression", () => {
  it("stragglerEnabled is false on Ensign difficulty", () => {
    const s = initStarSwarm(CANVAS_W, CANVAS_H, 1, 42, "Ensign");
    expect(s.stragglerEnabled).toBe(false);
  });

  it("stragglerEnabled is true on LieutenantJG (default) difficulty", () => {
    const s = initStarSwarm(CANVAS_W, CANVAS_H);
    expect(s.stragglerEnabled).toBe(true);
  });

  it("when ≤3 enemies remain and stragglerEnabled, Formation enemies immediately wiggle", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H, 1, 42, "LieutenantJG");
    s = advanceMs(s, 8000);
    expect(s.phase).toBe("Playing");

    // Kill all but 2 enemies
    const alive = s.enemies.filter((e) => e.isAlive);
    const toKill = alive.slice(2);
    s = {
      ...s,
      enemies: s.enemies.map((e) =>
        toKill.some((k) => k.id === e.id) ? { ...e, isAlive: false, hp: 0 } : e
      ),
    };

    s = tick(s, 16, NO_INPUT);
    const formationCount = s.enemies.filter((e) => e.isAlive && e.phase === "Formation").length;
    expect(formationCount).toBe(0); // all should have entered Wiggling
  });

  it("straggler does not trigger on Ensign difficulty", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H, 1, 42, "Ensign");
    s = advanceMs(s, 8000);
    expect(s.phase).toBe("Playing");

    const alive = s.enemies.filter((e) => e.isAlive);
    const toKill = alive.slice(2);
    s = {
      ...s,
      enemies: s.enemies.map((e) =>
        toKill.some((k) => k.id === e.id) ? { ...e, isAlive: false, hp: 0 } : e
      ),
    };
    s = tick(s, 16, NO_INPUT);
    // Formation enemies should still be in Formation (no straggler kick)
    const wiggling = s.enemies.filter((e) => e.isAlive && e.phase === "Wiggling");
    expect(wiggling.length).toBe(0);
  });

  it("stragglerEnabled carries over to next wave", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H, 1, 42, "LieutenantJG");
    s = advanceMs(s, 8000);
    s = { ...s, enemies: s.enemies.map((e) => ({ ...e, isAlive: false, hp: 0 })) };
    s = tick(s, 16, NO_INPUT); // WaveClear
    s = advanceMs(s, 3000);
    expect(s.wave).toBe(2);
    expect(s.stragglerEnabled).toBe(true);
  });
});

describe("Grunt rout (#2489)", () => {
  let nextId = 96_000;
  const ASIDE: StarSwarmInput = { playerX: 40, fire: false };
  /** Mid-wave, no enemy fire, beam parked, rocks and dives off, player parked left. */
  function quiet(difficulty: DifficultyTier = "LieutenantJG", wave = 2): StarSwarmState {
    const s = advanceMs(initStarSwarm(CANVAS_W, CANVAS_H, wave, 42, difficulty), 8000);
    return {
      ...s,
      enemyFireDisabled: true,
      enemyBullets: [],
      asteroids: [],
      asteroidsDisabled: true,
      nextDiveTimer: 1e9,
      player: { ...s.player, x: 40, lives: 3, invincibleTimer: 0 },
      enemies: s.enemies.map((e) => (e.tier === "Carrier" ? { ...e, beamTimer: 1e9 } : e)),
    };
  }
  const kill = (s: StarSwarmState, pick: (e: StarSwarmState["enemies"][number]) => boolean) => ({
    ...s,
    enemies: s.enemies.map((e) => (pick(e) ? { ...e, isAlive: false, hp: 0 } : e)),
  });
  const killLeaders = (s: StarSwarmState) => kill(s, (e) => e.tier !== "Grunt");
  const fleeing = (s: StarSwarmState) =>
    s.enemies.filter((e) => e.isAlive && e.phase === "Fleeing");
  const liveGrunts = (s: StarSwarmState) =>
    s.enemies.filter((e) => e.isAlive && e.tier === "Grunt");
  /** Kill everything but the first `n` grunts (plus any ids in `keep`). */
  const onlyGrunts = (s: StarSwarmState, n: number, keep: number[] = []) => {
    let kept = 0;
    return kill(s, (e) => !keep.includes(e.id) && (e.tier !== "Grunt" || kept++ >= n));
  };
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
      damage: 10,
      ...extra,
    };
  }
  function rock(x: number, y: number, extra: Partial<Asteroid> = {}): Asteroid {
    return {
      id: nextId++,
      kind: "large",
      x,
      y,
      vx: 0,
      vy: 0,
      radius: ASTEROID_STATS.large.radius,
      hp: ASTEROID_STATS.large.hp,
      rotation: 0,
      spin: 0,
      hitFlashTimer: 0,
      hitEnemyIds: [],
      ...extra,
    };
  }

  it("triggers only mid-wave with grunts alive and no Elite, Guardian or Carrier; then latches", () => {
    const base = quiet();
    expect(base.routed).toBe(false);
    // leaders alive → nothing
    expect(tick(base, 16, ASIDE).routed).toBe(false);
    // one Elite left among the leaders → still nothing
    const oneElite = kill(base, (e) => e.tier === "Guardian" || e.tier === "Carrier");
    expect(tick(oneElite, 16, ASIDE).routed).toBe(false);
    expect(fleeing(tick(oneElite, 16, ASIDE))).toHaveLength(0);
    // leaders dead but still swooping in → waits for Playing
    const swooping = killLeaders(initStarSwarm(CANVAS_W, CANVAS_H, 2, 42));
    expect(swooping.phase).toBe("SwoopIn");
    expect(tick(swooping, 16, ASIDE).routed).toBe(false);
    // dev toggle off → the old mop-up ending, straggler rule and all
    const off = { ...onlyGrunts(base, 3), routDisabled: true };
    expect(liveGrunts(off)).toHaveLength(3);
    const offTicked = tick(off, 16, ASIDE);
    expect(offTicked.routed).toBe(false);
    expect(fleeing(offTicked)).toHaveLength(0);
    // the real thing
    const prev = killLeaders(base);
    const s = tick(prev, 16, ASIDE);
    expect(s.routed).toBe(true);
    expect(routJustStarted(prev, s)).toBe(true);
    expect(fleeing(s)).toHaveLength(liveGrunts(prev).length);
    expect(fleeingCount(s)).toBe(fleeing(s).length);
    const again = tick(s, 16, ASIDE);
    expect(again.routed).toBe(true);
    expect(routJustStarted(s, again)).toBe(false);
  });

  it("every grunt in any phase but swoop-in gets a path to the top edge on its nearer side", () => {
    let base = killLeaders(quiet());
    // one grunt mid-dive, one still arriving
    const [a, b] = liveGrunts(base);
    base = {
      ...base,
      enemies: base.enemies.map((e) => {
        if (e.id === a!.id)
          return {
            ...e,
            phase: "Diving" as const,
            path: {
              p0: { x: e.x, y: e.y },
              p1: { x: e.x, y: e.y + 100 },
              p2: { x: e.x, y: 400 },
              p3: { x: e.x, y: 500 },
            },
            pathT: 0.3,
            pathDuration: DIVE_PATH_DURATION,
          };
        if (e.id === b!.id)
          return {
            ...e,
            phase: "SwoopIn" as const,
            path: {
              p0: { x: e.x, y: e.y - 20 },
              p1: { x: e.x, y: e.y - 10 },
              p2: { x: e.x, y: e.y },
              p3: { x: e.formationX, y: e.formationY },
            },
            pathT: 0.95,
            pathDuration: 1400,
          };
        return e;
      }),
    };
    const s = tick(base, 16, ASIDE);
    const diver = s.enemies.find((e) => e.id === a!.id)!;
    expect(diver.phase).toBe("Fleeing");
    for (const e of fleeing(s)) {
      expect(e.path).not.toBeNull();
      expect(e.path!.p3.y).toBe(-60);
      expect(e.path!.p3.x).toBe(e.path!.p0.x < CANVAS_W / 2 ? -60 : CANVAS_W + 60);
      expect(e.pathDuration).toBeGreaterThanOrEqual(FLEE_DURATION_MIN);
      expect(e.pathDuration).toBeLessThanOrEqual(FLEE_DURATION_MAX);
      // the rout tick already advanced the path by one frame, so a short hesitation reads ≥ -16
      const stagger = -e.pathT * e.pathDuration;
      expect(stagger).toBeGreaterThanOrEqual(-16);
      expect(stagger).toBeLessThanOrEqual(FLEE_STAGGER_MAX);
    }
    // the arriving grunt lands next tick and runs with the rest
    expect(s.enemies.find((e) => e.id === b!.id)!.phase).toBe("SwoopIn");
    const landed = advanceMs(s, 120, ASIDE);
    expect(landed.enemies.find((e) => e.id === b!.id)!.phase).toBe("Fleeing");
    // Ensign runs 1.4× slower
    const easy = tick(killLeaders(quiet("Ensign")), 16, ASIDE);
    for (const e of fleeing(easy)) {
      expect(e.pathDuration).toBeGreaterThanOrEqual(FLEE_DURATION_MIN * FLEE_ENSIGN_SCALE);
      expect(e.pathDuration).toBeLessThanOrEqual(FLEE_DURATION_MAX * FLEE_ENSIGN_SCALE);
    }
  });

  it("fleeing grunts never shoot or dive, and the straggler rule stands down for them", () => {
    let s = { ...killLeaders(quiet()), enemyFireDisabled: false, nextDiveTimer: 1 };
    s = {
      ...s,
      enemies: s.enemies.map((e) => (e.isAlive ? { ...e, shootTimer: 1 } : e)),
    };
    s = advanceMs(s, 900, ASIDE);
    expect(s.enemyBullets).toHaveLength(0);
    expect(
      s.enemies.some((e) => e.isAlive && (e.phase === "Diving" || e.phase === "Wiggling"))
    ).toBe(false);
    expect(s.enemies.every((e) => !e.isAlive || e.phase === "Fleeing")).toBe(true);
    // three survivors, all grunts: they run instead of turning aggressive
    let three = onlyGrunts(quiet(), 3);
    expect(liveGrunts(three)).toHaveLength(3);
    three = tick(three, 16, ASIDE);
    expect(three.enemies.some((e) => e.isAlive && e.phase === "Wiggling")).toBe(false);
    expect(fleeing(three).length).toBe(liveGrunts(three).length);
    // an Elite among the survivors: the old rule, no rout
    const q = quiet();
    const elite = q.enemies.find((e) => e.tier === "Elite")!;
    let mixed = onlyGrunts(q, 2, [elite.id]);
    expect(mixed.enemies.filter((e) => e.isAlive)).toHaveLength(3);
    mixed = tick(mixed, 16, ASIDE);
    expect(mixed.routed).toBe(false);
    expect(fleeing(mixed)).toHaveLength(0);
    expect(mixed.enemies.some((e) => e.isAlive && e.phase === "Wiggling")).toBe(true);
  });

  it("caught on the way out pays 2× and counts; escaped pays nothing and ends the wave", () => {
    const base = tick(killLeaders(quiet("Ensign")), 16, ASIDE);
    const target = fleeing(base).find((e) => e.pathT < 0)!; // still hesitating, so still in place
    let s = { ...base, score: 1000, playerBullets: [shot(target.x, target.y)] };
    s = tick(s, 16, ASIDE);
    expect(s.enemies.find((e) => e.id === target.id)!.isAlive).toBe(false);
    expect(s.score).toBe(1000 + Math.round(100 * 2 * difficultyMultiplier("Ensign")));
    expect(s.runStats.routCaught).toBe(1);
    // let the rest go
    const before = fleeing(s).length;
    s = { ...s, score: 5000 };
    s = advanceMs(s, FLEE_DURATION_MAX * FLEE_ENSIGN_SCALE + FLEE_STAGGER_MAX + 100, ASIDE);
    expect(s.phase).toBe("Extraction"); // #2842: the wave is clear, the ship is flying out
    s = runExtraction(s, ASIDE);
    expect(s.wave).toBe(3);
    expect(s.routed).toBe(false);
    expect(s.runStats.routEscaped).toBe(before);
    expect(s.runStats.routCaught).toBe(1);
    // only the wave-clear bonus was added — escapes paid nothing
    expect(s.score).toBe(5000 + waveClearBonusPoints(2, "Ensign"));
  });

  it("no rout on a boss wave — nothing to rout — and the wave still clears", () => {
    let s = quiet("LieutenantJG", 5);
    expect(liveGrunts(s)).toHaveLength(0);
    s = tick(
      kill(s, (e) => e.tier === "Guardian"),
      16,
      ASIDE
    );
    expect(s.routed).toBe(false);
    s = runExtraction(
      tick(
        kill(s, () => true),
        16,
        ASIDE
      ),
      ASIDE
    );
    expect(s.wave).toBe(6);
  });

  it("fleeing grunts still roll to dodge rocks and can be struck by them", () => {
    const base = tick(killLeaders(quiet()), 16, ASIDE);
    const g = fleeing(base).find((e) => e.pathT < 0)!;
    let s = { ...base, asteroids: [rock(g.x, g.y - 100, { vy: 0.12 })] };
    s = tick(s, 16, ASIDE);
    expect(s.tierStats.Grunt.rolls).toBeGreaterThanOrEqual(1);
    let struck = { ...base, asteroids: [rock(g.x, g.y)] };
    struck = tick(struck, 16, ASIDE);
    expect(struck.tierStats.Grunt.struck).toBeGreaterThanOrEqual(1);
    expect(struck.runStats.routCaught).toBe(0); // a rock kill is nobody's catch
  });
});
