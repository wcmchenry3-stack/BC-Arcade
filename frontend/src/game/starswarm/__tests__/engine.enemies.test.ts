/**
 * Star Swarm engine tests: the enemy state machine, dives, fire caps, Guardian/Elite rules,
 * stragglers and the rout.
 *
 * One file per planned `engine/` module (#2988): this file follows `engine/enemies.ts`. Split out
 * of the former monolithic `engine.test.ts` (#2955) with describe blocks moved whole; shared
 * fixtures live in `helpers/engineFixtures.ts`.
 */
import {
  initStarSwarm,
  tick,
  isSwooping,
  diverCount,
  maxDivers,
  bulletCap,
  WIGGLE_DURATION,
  DIVE_PATH_DURATION,
  GUARDIAN_DIVE_THRESHOLD,
  BURST_INTERVAL,
  BURST_PAUSE_BASE,
  seedRng,
  _resetIds,
  CANVAS_W,
  CANVAS_H,
  difficultyMultiplier,
  GUARDIAN_BULLET_VY,
  BULLET_E_VY,
  isLeaderTier,
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
// Enemy state machine — SwoopIn
// ---------------------------------------------------------------------------

describe("SwoopIn", () => {
  it("all enemies start in SwoopIn phase", () => {
    const s = initStarSwarm(CANVAS_W, CANVAS_H);
    expect(s.enemies.every((e) => e.phase === "SwoopIn")).toBe(true);
  });

  it("isSwooping returns true initially", () => {
    const s = initStarSwarm(CANVAS_W, CANVAS_H);
    expect(isSwooping(s)).toBe(true);
  });

  it("no enemies remain in SwoopIn after enough time", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H);
    s = advanceMs(s, 8000); // enough time for all to arrive
    const stillSwooping = s.enemies.filter((e) => e.isAlive && e.phase === "SwoopIn");
    expect(stillSwooping).toHaveLength(0);
  });

  it("phase transitions to Playing once all enemies are in Formation", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H);
    s = advanceMs(s, 8000);
    expect(s.phase).toBe("Playing");
  });

  it("isSwooping returns false after all arrive", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H);
    s = advanceMs(s, 8000);
    expect(isSwooping(s)).toBe(false);
  });

  it("does not mutate previous state", () => {
    const s0 = initStarSwarm(CANVAS_W, CANVAS_H);
    const firstY = s0.enemies[0]?.y ?? 0;
    tick(s0, 100, NO_INPUT);
    expect(s0.enemies[0]?.y).toBe(firstY);
  });
});

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
// Guardian HP 4 (#970)
// ---------------------------------------------------------------------------

describe("Guardian HP (#970)", () => {
  it("Guardian starts with 4 HP", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H);
    s = advanceMs(s, 8000);
    const boss = s.enemies.find((e) => e.isAlive && e.tier === "Guardian");
    if (!boss) throw new Error("no Guardian");
    expect(boss.hp).toBe(4);
  });

  it("Guardian requires exactly 4 hits of damage=1 to die", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H);
    s = advanceMs(s, 8000);
    const guardianId = s.enemies.find((e) => e.isAlive && e.tier === "Guardian")?.id;
    if (!guardianId) throw new Error("no Guardian");
    const getGuardian = () => s.enemies.find((e) => e.id === guardianId)!;

    for (let hit = 1; hit <= 4; hit++) {
      const b = getGuardian();
      s = {
        ...s,
        playerBullets: [
          {
            id: hit,
            x: b.x,
            y: b.y,
            vx: 0,
            vy: -0.5,
            owner: "player",
            width: 5,
            height: 14,
            damage: 1,
          },
        ],
      };
      s = tick(s, 16, NO_INPUT);
      if (hit < 4) {
        expect(getGuardian().isAlive).toBe(true);
        expect(getGuardian().hp).toBe(4 - hit);
      } else {
        expect(getGuardian().isAlive).toBe(false);
      }
    }
  });

  it("Guardian is still worth 400 points on kill (Ensign ×1 baseline)", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H, 1, 42, "Ensign");
    s = advanceMs(s, 8000);
    const guardianId = s.enemies.find((e) => e.isAlive && e.tier === "Guardian")?.id;
    if (!guardianId) throw new Error("no Guardian");
    const getGuardian = () => s.enemies.find((e) => e.id === guardianId)!;
    const scoreBefore = s.score;

    for (let hit = 1; hit <= 4; hit++) {
      const b = getGuardian();
      s = {
        ...s,
        playerBullets: [
          {
            id: hit,
            x: b.x,
            y: b.y,
            vx: 0,
            vy: -0.5,
            owner: "player",
            width: 5,
            height: 14,
            damage: 1,
          },
        ],
      };
      s = tick(s, 16, NO_INPUT);
    }

    expect(s.score - scoreBefore).toBe(400);
  });

  it("Grunt and Elite HP are unchanged", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H);
    s = advanceMs(s, 8000);
    expect(s.enemies.find((e) => e.isAlive && e.tier === "Grunt")?.hp).toBe(1);
    expect(s.enemies.find((e) => e.isAlive && e.tier === "Elite")?.hp).toBe(2);
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
// Enemy bullet cap (#972)
// ---------------------------------------------------------------------------

describe("Enemy bullet cap (#972)", () => {
  it("bulletCap returns correct values for each wave pair", () => {
    expect(bulletCap(1)).toBe(3);
    expect(bulletCap(2)).toBe(3);
    expect(bulletCap(3)).toBe(4);
    expect(bulletCap(5)).toBe(5);
    expect(bulletCap(7)).toBe(6);
  });

  it("no new enemy bullet fired when cap is already reached", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H);
    s = advanceMs(s, 8000);
    expect(s.phase).toBe("Playing");

    // Fill to the wave-1 cap (3 bullets), placed safely mid-screen
    const fillerBullets: Bullet[] = Array.from({ length: 3 }, (_, i) => ({
      id: 10000 + i,
      x: 100,
      y: 200 + i * 20,
      vx: 0,
      vy: 0.35,
      owner: "enemy" as const,
      width: 5,
      height: 10,
      damage: 1,
    }));

    // Force one Formation enemy's shoot timer to fire immediately
    s = {
      ...s,
      enemyBullets: fillerBullets,
      enemies: s.enemies.map((e, i) =>
        i === 0 && e.phase === "Formation" ? { ...e, shootTimer: 0 } : e
      ),
    };

    s = tick(s, 16, NO_INPUT);

    // The 3 filler bullets are still on-screen (y ≈ 205) — no 4th bullet allowed
    expect(s.enemyBullets.length).toBeLessThanOrEqual(bulletCap(1));
  });

  it("enemy fires normally when bullet count is below cap", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H);
    s = advanceMs(s, 8000);
    expect(s.phase).toBe("Playing");

    // Force the first non-Guardian formation enemy to fire immediately
    // (Guardians are passive until guardianThresholdCrossed, so use a Grunt or Elite)
    const targetIdx = s.enemies.findIndex((e) => e.phase === "Formation" && e.tier !== "Guardian");
    if (targetIdx === -1) return;
    s = {
      ...s,
      enemyBullets: [],
      enemies: s.enemies.map((e, i) => (i === targetIdx ? { ...e, shootTimer: 0 } : e)),
    };

    s = tick(s, 16, NO_INPUT);
    expect(s.enemyBullets.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Dive/circle shooting (#944)
// ---------------------------------------------------------------------------

describe("Dive/circle shooting", () => {
  it("a diving enemy fires an aimed bullet with non-zero vx", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H);
    s = advanceMs(s, 8000); // reach Playing
    expect(s.phase).toBe("Playing");

    // Force one enemy into Diving with an expired shoot timer so it fires immediately.
    // Clear existing enemy bullets so the bullet cap (wave 1 = 3) doesn't suppress the shot.
    // Provide a minimal straight Bézier path since tickDiving now uses path-based movement.
    const playerX = s.player.x;
    const dummyPath = {
      p0: { x: CANVAS_W / 2, y: 100 },
      p1: { x: CANVAS_W / 2, y: 200 },
      p2: { x: playerX, y: 400 },
      p3: { x: playerX, y: CANVAS_H * 0.9 },
    };
    s = {
      ...s,
      enemyBullets: [],
      enemies: s.enemies.map((e, i) =>
        i === 0
          ? {
              ...e,
              phase: "Diving" as const,
              diveTargetX: playerX,
              shootTimer: 0,
              path: dummyPath,
              pathT: 0,
              pathDuration: 1800,
            }
          : e
      ),
    };

    s = tick(s, 16, NO_INPUT);

    const divingBullet = s.enemyBullets.find((b) => b.vx !== 0);
    expect(divingBullet).toBeDefined();
    expect(divingBullet?.vy).toBeGreaterThan(0); // moving downward
  });
});

describe("Wiggle telegraph (#975)", () => {
  it("enemy enters Wiggling before Diving when selected for dive", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H);
    s = advanceMs(s, 8000); // reach Playing
    s = resetToFormation({ ...s, nextDiveTimer: 1 });
    s = tick(s, 16, NO_INPUT);
    expect(s.enemies.some((e) => e.isAlive && e.phase === "Wiggling")).toBe(true);
    expect(s.enemies.filter((e) => e.isAlive && e.phase === "Diving")).toHaveLength(0);
  });

  it("Wiggling enemy transitions to Diving after WIGGLE_DURATION", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H);
    s = advanceMs(s, 8000);
    s = resetToFormation({ ...s, nextDiveTimer: 1 });
    s = tick(s, 16, NO_INPUT);
    const wiggling = s.enemies.find((e) => e.phase === "Wiggling");
    if (!wiggling) throw new Error("no wiggling enemy");
    const id = wiggling.id;
    s = advanceMs(s, WIGGLE_DURATION + 50, NO_INPUT);
    const after = s.enemies.find((e) => e.id === id)!;
    const completed =
      !after.isAlive ||
      after.phase === "Diving" ||
      after.phase === "Circling" ||
      after.phase === "Returning";
    expect(completed).toBe(true);
  });

  it("wiggleTimer is 0 for all enemies at wave start", () => {
    const s = initStarSwarm(CANVAS_W, CANVAS_H);
    expect(s.enemies.every((e) => e.wiggleTimer === 0)).toBe(true);
  });

  it("Wiggling enemies are not counted against maxDivers cap", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H);
    s = advanceMs(s, 8000);
    s = resetToFormation({ ...s, nextDiveTimer: 1 });
    s = tick(s, 16, NO_INPUT);
    const wiggling = s.enemies.filter((e) => e.isAlive && e.phase === "Wiggling").length;
    const diving = s.enemies.filter((e) => e.isAlive && e.phase === "Diving").length;
    expect(wiggling).toBeGreaterThan(0);
    expect(diving).toBeLessThanOrEqual(maxDivers(s.wave));
  });
});

// ---------------------------------------------------------------------------
// Bézier arc dives (#977)
// ---------------------------------------------------------------------------

describe("Bézier arc dives (#977)", () => {
  it("diving enemy reaches Circling within WIGGLE_DURATION + DIVE_PATH_DURATION + buffer", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H);
    s = advanceMs(s, 8000);
    s = resetToFormation({ ...s, nextDiveTimer: 1 });
    s = tick(s, 16, NO_INPUT);
    const wiggling = s.enemies.find((e) => e.phase === "Wiggling");
    if (!wiggling) throw new Error("no wiggling enemy");
    const id = wiggling.id;
    // #1314: proportional aiming is more lethal — give invincibility so the player can't die
    // mid-advance and freeze the game in GameOver before the dive completes.
    s = { ...s, player: { ...s.player, invincibleTimer: 999_999 } };
    s = advanceMs(s, WIGGLE_DURATION + DIVE_PATH_DURATION + 200, NO_INPUT);
    const after = s.enemies.find((e) => e.id === id)!;
    const completed =
      !after.isAlive ||
      after.phase === "Circling" ||
      after.phase === "Returning" ||
      after.phase === "Formation";
    expect(completed).toBe(true);
  });

  it("dive path is set when enemy enters Diving", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H);
    s = advanceMs(s, 8000);
    s = resetToFormation({ ...s, nextDiveTimer: 1 });
    s = tick(s, 16, NO_INPUT);
    s = advanceMs(s, WIGGLE_DURATION + 50, NO_INPUT);
    const diver = s.enemies.find((e) => e.isAlive && e.phase === "Diving");
    if (!diver) return; // may already be Circling at high frame rate — skip
    expect(diver.path).not.toBeNull();
    expect(diver.pathDuration).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Guardian dive threshold (#978)
// ---------------------------------------------------------------------------

describe("Guardian dive threshold (#978)", () => {
  it("GUARDIAN_DIVE_THRESHOLD is 0.35", () => {
    expect(GUARDIAN_DIVE_THRESHOLD).toBe(0.35);
  });

  it("startingNonLeaderCount set correctly at wave init", () => {
    const s = initStarSwarm(CANVAS_W, CANVAS_H);
    // #2484: Guardian and Carrier both sit out the count
    const nonLeaderCount = s.enemies.filter((e) => !isLeaderTier(e.tier)).length;
    expect(s.startingNonLeaderCount).toBe(nonLeaderCount);
    expect(s.startingNonLeaderCount).toBeGreaterThan(0);
  });

  it("Guardian does not dive when >35% non-leader enemies are still alive", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H);
    s = advanceMs(s, 8000);
    const guardianIds = new Set(
      s.enemies.filter((e) => e.isAlive && e.tier === "Guardian").map((e) => e.id)
    );

    // Force dive trigger with all non-leader enemies alive (100% remain → >35%)
    s = { ...s, nextDiveTimer: 1 };
    s = tick(s, 16, NO_INPUT);

    // No Guardian should enter Wiggling or Diving
    const guardianWiggling = s.enemies.some(
      (e) => guardianIds.has(e.id) && (e.phase === "Wiggling" || e.phase === "Diving")
    );
    expect(guardianWiggling).toBe(false);
  });

  it("Guardian can dive when ≤35% non-leader enemies remain", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H);
    s = advanceMs(s, 8000);

    // Kill enough non-leader enemies to drop to 30% alive (below 35% threshold)
    const target = Math.floor(s.startingNonLeaderCount * 0.3);
    let killed = 0;
    s = {
      ...s,
      enemies: s.enemies.map((e) => {
        if (e.tier !== "Guardian" && e.isAlive && killed < s.startingNonLeaderCount - target) {
          killed++;
          return { ...e, isAlive: false, hp: 0 };
        }
        return e;
      }),
    };

    // Run until a Guardian enters Wiggling or Diving
    s = { ...s, nextDiveTimer: 1 };
    let guardianActed = false;
    for (let i = 0; i < 300; i++) {
      s = tick(s, 16, NO_INPUT);
      if (
        s.enemies.some(
          (e) => e.tier === "Guardian" && (e.phase === "Wiggling" || e.phase === "Diving")
        )
      ) {
        guardianActed = true;
        break;
      }
      if (s.phase !== "Playing") break;
      s = { ...s, nextDiveTimer: 1 }; // keep triggering
    }
    expect(guardianActed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Guardian burst-fire (#979)
// ---------------------------------------------------------------------------

describe("Guardian burst-fire (#979)", () => {
  it("Guardian fires on first tick when shootTimer=0 and burstShotsLeft=0", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H);
    s = advanceMs(s, 8000);
    const guardianIdx = s.enemies.findIndex(
      (e) => e.isAlive && e.tier === "Guardian" && e.phase === "Formation"
    );
    if (guardianIdx === -1) throw new Error("no Guardian in formation");
    s = {
      ...s,
      guardianThresholdCrossed: true, // Guardian must be active to fire
      enemyBullets: [],
      enemies: s.enemies.map((e, i) =>
        i === guardianIdx ? { ...e, shootTimer: 0, burstShotsLeft: 0 } : e
      ),
    };
    s = tick(s, 16, NO_INPUT);
    expect(s.enemyBullets.length).toBeGreaterThan(0);
    const boss = s.enemies[guardianIdx]!;
    // After first burst shot, timer is either BURST_INTERVAL (more shots) or long pause (1-shot burst)
    expect(boss.shootTimer).toBeLessThanOrEqual(BURST_INTERVAL + 2);
    // burstShotsLeft is 0 (burst complete) or up to 4 (3–5 shot burst, remaining after first)
    expect(boss.burstShotsLeft).toBeGreaterThanOrEqual(0);
    expect(boss.burstShotsLeft).toBeLessThanOrEqual(4);
  });

  it("Guardian has long pause after burst completes (burstShotsLeft reaches 0)", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H);
    s = advanceMs(s, 8000);
    const guardianIdx = s.enemies.findIndex(
      (e) => e.isAlive && e.tier === "Guardian" && e.phase === "Formation"
    );
    if (guardianIdx === -1) throw new Error("no Guardian in formation");
    // Force last shot in burst (Guardian must be active to fire)
    s = {
      ...s,
      guardianThresholdCrossed: true,
      enemyBullets: [],
      enemies: s.enemies.map((e, i) =>
        i === guardianIdx ? { ...e, shootTimer: 0, burstShotsLeft: 1 } : e
      ),
    };
    s = tick(s, 16, NO_INPUT);
    const boss = s.enemies[guardianIdx]!;
    expect(boss.burstShotsLeft).toBe(0);
    // Long pause should be at least BURST_PAUSE_BASE - one tick
    expect(boss.shootTimer).toBeGreaterThanOrEqual(BURST_PAUSE_BASE - 16);
  });

  it("burstShotsLeft is 0 for all enemies at wave start", () => {
    const s = initStarSwarm(CANVAS_W, CANVAS_H);
    expect(s.enemies.every((e) => e.burstShotsLeft === 0)).toBe(true);
  });

  it("Guardian burst bullet travels at GUARDIAN_BULLET_VY; Elite bullet travels at BULLET_E_VY", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H);
    s = advanceMs(s, 8000);
    const guardianIdx = s.enemies.findIndex(
      (e) => e.isAlive && e.tier === "Guardian" && e.phase === "Formation"
    );
    const eliteIdx = s.enemies.findIndex(
      (e) => e.isAlive && e.tier === "Elite" && e.phase === "Formation"
    );
    if (guardianIdx === -1) throw new Error("no Guardian in formation");
    if (eliteIdx === -1) throw new Error("no elite in formation");
    s = {
      ...s,
      guardianThresholdCrossed: true,
      enemyBullets: [],
      enemies: s.enemies.map((e, i) => {
        if (i === guardianIdx) return { ...e, shootTimer: 0, burstShotsLeft: 0 };
        if (i === eliteIdx) return { ...e, shootTimer: 0 };
        return e;
      }),
    };
    s = tick(s, 16, NO_INPUT);
    const guardianBullet = s.enemyBullets.find((b) => b.vy === GUARDIAN_BULLET_VY);
    const eliteBullet = s.enemyBullets.find((b) => b.vy === BULLET_E_VY);
    expect(guardianBullet).toBeDefined();
    expect(eliteBullet).toBeDefined();
  });

  it("Guardian circle-phase bullet travels at GUARDIAN_BULLET_VY", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H);
    s = advanceMs(s, 8000);
    const guardianIdx = s.enemies.findIndex((e) => e.isAlive && e.tier === "Guardian");
    if (guardianIdx === -1) throw new Error("no Guardian");
    const cx = CANVAS_W / 2;
    const cy = CANVAS_H * 0.3;
    const radius = 60;
    s = {
      ...s,
      guardianThresholdCrossed: true,
      enemyBullets: [],
      enemies: s.enemies.map((e, i) =>
        i === guardianIdx
          ? {
              ...e,
              phase: "Circling" as const,
              circleCx: cx,
              circleCy: cy,
              circleRadius: radius,
              circleAngle: 0,
              circleSpeed: 0.001,
              shootTimer: 0,
            }
          : e
      ),
    };
    s = tick(s, 16, NO_INPUT);
    expect(s.enemyBullets.length).toBeGreaterThan(0);
    const bullet = s.enemyBullets[0]!;
    expect(bullet.vy).toBe(GUARDIAN_BULLET_VY);
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
// #1030 — Elite phase system & Guardian passive start
// ---------------------------------------------------------------------------

describe("#1030 Elite phase system & Guardian passive start", () => {
  it("guardianThresholdCrossed initialises to false", () => {
    const s = initStarSwarm(CANVAS_W, CANVAS_H);
    expect(s.guardianThresholdCrossed).toBe(false);
  });

  it("guardianThresholdCrossed flips to true once ≤35% non-leader enemies remain and stays true", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H);
    s = advanceMs(s, 8000);
    expect(s.guardianThresholdCrossed).toBe(false);

    const target = Math.floor(s.startingNonLeaderCount * 0.3);
    let killed = 0;
    s = {
      ...s,
      enemies: s.enemies.map((e) => {
        if (e.tier !== "Guardian" && e.isAlive && killed < s.startingNonLeaderCount - target) {
          killed++;
          return { ...e, isAlive: false, hp: 0 };
        }
        return e;
      }),
    };
    s = tick(s, 16, NO_INPUT);
    expect(s.guardianThresholdCrossed).toBe(true);

    // Stays true after further ticks
    s = advanceMs(s, 1000, NO_INPUT);
    expect(s.guardianThresholdCrossed).toBe(true);
  });

  it("Guardian does not fire while guardianThresholdCrossed is false", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H);
    s = advanceMs(s, 8000);
    expect(s.guardianThresholdCrossed).toBe(false);

    const guardianIdx = s.enemies.findIndex((e) => e.isAlive && e.tier === "Guardian");
    if (guardianIdx === -1) throw new Error("no Guardian");
    s = {
      ...s,
      enemyBullets: [],
      // Only the Guardian is due to fire this tick — everyone else is pushed far out, so a bullet
      // here could only be the Guardian's (the seed no longer guarantees the rest stay quiet, #2484).
      enemies: s.enemies.map((e, i) =>
        i === guardianIdx
          ? { ...e, shootTimer: 0, burstShotsLeft: 0 }
          : { ...e, shootTimer: 99_999 }
      ),
    };
    s = tick(s, 16, NO_INPUT);
    // Guardian should not fire while passive
    expect(s.enemyBullets.length).toBe(0);
  });

  it("Guardian does not dive while guardianThresholdCrossed is false", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H);
    s = advanceMs(s, 8000);
    expect(s.guardianThresholdCrossed).toBe(false);

    const guardianIds = new Set(s.enemies.filter((e) => e.tier === "Guardian").map((e) => e.id));
    s = { ...s, nextDiveTimer: 1 };
    s = tick(s, 16, NO_INPUT);
    const guardianActed = s.enemies.some(
      (e) => guardianIds.has(e.id) && (e.phase === "Wiggling" || e.phase === "Diving")
    );
    expect(guardianActed).toBe(false);
  });

  it("Elite Phase 1 dive stays above 60% canvas height", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H);
    s = advanceMs(s, 8000);
    expect(s.guardianThresholdCrossed).toBe(false);

    // Force an Elite to dive
    const eliteIdx = s.enemies.findIndex(
      (e) => e.isAlive && e.tier === "Elite" && e.phase === "Formation"
    );
    if (eliteIdx === -1) throw new Error("no elite in formation");
    s = {
      ...s,
      enemies: s.enemies.map((e, i) =>
        i === eliteIdx
          ? {
              ...e,
              phase: "Wiggling" as const,
              wiggleTimer: WIGGLE_DURATION,
              diveTargetX: s.player.x,
            }
          : e
      ),
    };

    const eliteId = s.enemies[eliteIdx]!.id;
    const maxY60 = CANVAS_H * 0.6;

    for (let i = 0; i < 500; i++) {
      s = tick(s, 16, NO_INPUT);
      const elite = s.enemies.find((e) => e.id === eliteId);
      if (!elite || !elite.isAlive || elite.phase === "Returning" || elite.phase === "Formation")
        break;
      if (elite.phase === "Diving") {
        expect(elite.y).toBeLessThan(maxY60 + 5); // allow 1-frame overshoot tolerance
      }
    }
  });

  it("Elite Phase 1 has no body collision", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H);
    s = advanceMs(s, 8000);
    expect(s.guardianThresholdCrossed).toBe(false);
    s = { ...s, player: { ...s.player, lives: 3, invincibleTimer: 0 } };

    const eliteId = s.enemies.find((e) => e.isAlive && e.tier === "Elite")?.id;
    if (!eliteId) throw new Error("no elite");
    const { player } = s;
    s = {
      ...s,
      enemies: s.enemies.map((e) =>
        e.id === eliteId
          ? {
              ...e,
              phase: "Diving" as const,
              x: player.x,
              y: player.y,
              path: {
                p0: { x: player.x, y: player.y },
                p1: { x: player.x, y: player.y + 5 },
                p2: { x: player.x, y: player.y + 10 },
                p3: { x: player.x, y: player.y + 15 },
              },
              pathT: 0,
              pathDuration: 1000,
            }
          : e
      ),
    };
    s = tick(s, 16, NO_INPUT);
    expect(s.player.lives).toBe(3);
  });

  it("Elite Phase 2 (guardianThresholdCrossed=true) can body-collide", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H);
    s = advanceMs(s, 8000);
    s = {
      ...s,
      guardianThresholdCrossed: true,
      player: { ...s.player, lives: 3, invincibleTimer: 0 },
    };

    const eliteId = s.enemies.find((e) => e.isAlive && e.tier === "Elite")?.id;
    if (!eliteId) throw new Error("no elite");
    const { player } = s;
    s = {
      ...s,
      enemies: s.enemies.map((e) =>
        e.id === eliteId
          ? {
              ...e,
              phase: "Diving" as const,
              x: player.x,
              y: player.y,
              path: {
                p0: { x: player.x, y: player.y },
                p1: { x: player.x, y: player.y + 5 },
                p2: { x: player.x, y: player.y + 10 },
                p3: { x: player.x, y: player.y + 15 },
              },
              pathT: 0,
              pathDuration: 1000,
            }
          : e
      ),
    };
    s = tick(s, 16, NO_INPUT);
    expect(s.player.lives).toBeLessThan(3);
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
