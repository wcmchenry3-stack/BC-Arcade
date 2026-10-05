/**
 * Star Swarm engine tests: enemy combat — tier HP, the enemy bullet cap, dive/circle shooting, the
 * Guardian dive threshold and burst-fire, and the Elite phase system.
 *
 * Follows the planned `engine/enemies.ts` (#2988), split in two by describe cluster so neither file
 * passes the ~1,000-line layout rule (#2955). Describe blocks moved whole; shared fixtures live in
 * `helpers/engineFixtures.ts`.
 */
import {
  initStarSwarm,
  tick,
  bulletCap,
  WIGGLE_DURATION,
  GUARDIAN_DIVE_THRESHOLD,
  BURST_INTERVAL,
  BURST_PAUSE_BASE,
  seedRng,
  _resetIds,
  CANVAS_W,
  CANVAS_H,
  GUARDIAN_BULLET_VY,
  BULLET_E_VY,
  isLeaderTier,
} from "../engine";
import type { Bullet } from "../types";
import { NO_INPUT, advanceMs } from "./helpers/engineFixtures";

beforeEach(() => {
  seedRng(42);
  _resetIds();
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
