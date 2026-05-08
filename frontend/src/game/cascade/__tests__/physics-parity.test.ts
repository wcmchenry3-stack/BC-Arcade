/**
 * physics-parity.test.ts — GH #203
 *
 * Cross-engine invariant tests: Rapier (web) vs Matter.js (native).
 *
 * Full positional parity is intentionally NOT asserted — the two engines
 * use different integrators and density scales, so sub-pixel divergence is
 * expected and acceptable. Instead we assert on higher-level invariants that
 * MUST hold on both platforms:
 *
 *   1. Gravity: fruits fall (y increases) on both engines.
 *   2. Fruit count: N drops at non-overlapping x → N fruits, no auto-merges.
 *   3. Merge semantics: same-tier collision produces fruitMerge event on both engines.
 *   4. Score parity: identical merge sequences produce identical fruitMerge counts.
 */

jest.mock("@dimforge/rapier2d-compat");

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
const _rapierEngine: typeof import("../engine") = require(
  require("path").resolve(__dirname, "..", "engine.ts")
);
/* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
const { createEngine: createRapierEngine } = _rapierEngine;
import Matter from "matter-js";
import { createEngine as createNativeEngine } from "../engine.native";
import { FRUIT_SETS, FruitSet, FruitDefinition } from "../../../theme/fruitSets";
import { MockWorld } from "../../../../__mocks__/@dimforge/rapier2d-compat";
import {
  MAX_FRUIT_SPEED_PX_S,
  SCALE,
  FIXED_STEP_MS,
  SPAWN_GRACE_TICKS,
  COLLISION_GROUP_DYNAMIC,
  COLLISION_GROUP_WALL,
  WALL_THICKNESS,
  GAME_OVER_CONSECUTIVE_TICKS,
} from "../engine.shared";

const RAPIER_MOCK = require("@dimforge/rapier2d-compat").default; // eslint-disable-line @typescript-eslint/no-require-imports

function requireFruitSet(id: string): FruitSet {
  const fs = FRUIT_SETS[id];
  if (fs === undefined) throw new Error(`FruitSet '${id}' not found`);
  return fs;
}

function fruit(tier: number): FruitDefinition {
  const f = fruitSet.fruits[tier];
  if (f === undefined) throw new Error(`No fruit for tier ${tier}`);
  return f;
}

const fruitSet: FruitSet = requireFruitSet("fruits");
const W = 300;
const H = 600;

afterEach(() => {
  jest.clearAllMocks();
});

/** Return the MockWorld for the most recent Rapier createEngine call. */
function getRapierWorld(): MockWorld {
  const results = (RAPIER_MOCK.World as jest.Mock).mock.results;
  const last = results[results.length - 1];
  if (last === undefined) throw new Error("No World mock results");
  return last.value as MockWorld;
}

// ---------------------------------------------------------------------------
// 1. Gravity: fruits fall on both engines
// ---------------------------------------------------------------------------

describe("gravity — both engines pull fruits downward", () => {
  it("Rapier: y increases after multiple steps", async () => {
    const handle = await createRapierEngine(W, H, fruitSet);
    handle.drop(fruit(0), fruitSet.id, W / 2, 100);
    const y0 = handle.step().snapshots[0]?.y ?? 0;
    // Mock body falls: advance mock world position manually by tweaking _y
    const world = getRapierWorld();
    world._bodies.get(0)!._y += 0.5; // simulate fall in physics coords
    const y1 = handle.step().snapshots[0]?.y ?? 0;
    expect(y1).toBeGreaterThan(y0);
  });

  it("Matter.js: y increases after multiple steps", async () => {
    const handle = await createNativeEngine(W, H, fruitSet);
    handle.drop(fruit(0), fruitSet.id, W / 2, 100);
    const y0 = handle.step(1 / 60).snapshots[0]?.y ?? 0;
    for (let i = 0; i < 10; i++) handle.step(1 / 60);
    const y1 = handle.step(1 / 60).snapshots[0]?.y ?? 0;
    expect(y1).toBeGreaterThan(y0);
    handle.cleanup();
  });
});

// ---------------------------------------------------------------------------
// 2. Fruit count: N well-separated drops → N fruits, no auto-merges
// ---------------------------------------------------------------------------

describe("fruit count — N drops at distinct x positions → N snapshots", () => {
  const DROP_XS = [50, 150, 250]; // well-separated, no overlap for tier-0 (radius=18)

  it("Rapier: 3 drops → 3 snapshots, 0 merges", async () => {
    const handle = await createRapierEngine(W, H, fruitSet);
    DROP_XS.forEach((x) => handle.drop(fruit(0), fruitSet.id, x, 300));
    const { snapshots, events } = handle.step();
    expect(snapshots).toHaveLength(3);
    expect(events.filter((e) => e.type === "fruitMerge")).toHaveLength(0);
  });

  it("Matter.js: 3 drops → 3 snapshots, 0 merges", async () => {
    const handle = await createNativeEngine(W, H, fruitSet);
    DROP_XS.forEach((x) => handle.drop(fruit(0), fruitSet.id, x, 300));
    const { snapshots, events } = handle.step(1 / 60);
    expect(snapshots).toHaveLength(3);
    expect(events.filter((e) => e.type === "fruitMerge")).toHaveLength(0);
    handle.cleanup();
  });
});

// ---------------------------------------------------------------------------
// 3 & 4. Merge semantics: same-tier collision produces fruitMerge on both engines
// ---------------------------------------------------------------------------

describe("merge semantics — same-tier collision fires fruitMerge on both engines", () => {
  it("Rapier: two tier-1 fruits collide → fruitMerge event with tier=1", async () => {
    const handle = await createRapierEngine(W, H, fruitSet);
    const world = getRapierWorld();

    handle.drop(fruit(1), fruitSet.id, 100, 300);
    handle.drop(fruit(1), fruitSet.id, 110, 300);
    handle.step();
    // Wall colliders take handles 1000–1002; fruit bodies 0–1, colliders 1003–1004
    world._fireCollision(1003, 1004);
    const { events } = handle.step();

    const merges = events.filter((e) => e.type === "fruitMerge");
    expect(merges).toHaveLength(1);
    expect((merges[0] as { tier: number }).tier).toBe(1);
  });

  it("Matter.js: two tier-1 fruits collide → fruitMerge event with tier=1", async () => {
    const handle = await createNativeEngine(W, H, fruitSet);
    const tier1 = fruit(1); // radius=25
    let mergeEvents: { type: string; tier?: number }[] = [];

    // Drop very close so overlap triggers immediate collision
    handle.drop(tier1, fruitSet.id, W / 2 - 5, 50);
    handle.drop(tier1, fruitSet.id, W / 2 + 5, 50);

    for (let i = 0; i < 300; i++) {
      const { events } = handle.step(1 / 60);
      mergeEvents = [...mergeEvents, ...events.filter((e) => e.type === "fruitMerge")];
      if (mergeEvents.length > 0) break;
    }

    expect(mergeEvents.length).toBeGreaterThan(0);
    expect((mergeEvents[0] as { tier: number }).tier).toBe(1);
    handle.cleanup();
  });
});

// ---------------------------------------------------------------------------
// 5. Velocity clamp parity: both engines cap at the same constant
// ---------------------------------------------------------------------------

describe("velocity clamp parity", () => {
  it("Rapier: body exceeding MAX_FRUIT_SPEED_PX_S is clamped after step", async () => {
    const handle = await createRapierEngine(W, H, fruitSet);
    const world = getRapierWorld();

    handle.drop(fruit(0), fruitSet.id, W / 2, 100);
    handle.step(); // register body (handle 0)

    const body = world._bodies.get(0)!;
    body._vx = 99; // >> maxPhysSpeed = MAX_FRUIT_SPEED_PX_S * SCALE = 12
    body._vy = 99;
    handle.step();

    const vel = body.linvel();
    const maxPhysSpeed = MAX_FRUIT_SPEED_PX_S * SCALE;
    expect(Math.sqrt(vel.x ** 2 + vel.y ** 2)).toBeLessThanOrEqual(maxPhysSpeed + 0.001);
  });

  it("Matter.js: body exceeding MAX_FRUIT_SPEED_PX_S is clamped after step", async () => {
    const createSpy = jest.spyOn(Matter.Engine, "create");
    const handle = await createNativeEngine(W, H, fruitSet);
    const engineInstance = createSpy.mock.results[0]?.value as Matter.Engine;

    handle.drop(fruit(0), fruitSet.id, W / 2, 100);
    handle.step(1 / 60); // register body

    const dynamicBodies = Matter.Composite.allBodies(engineInstance.world).filter(
      (b) => !b.isStatic
    );
    const fruitBody = dynamicBodies[0];
    if (!fruitBody) throw new Error("Expected a fruit body");

    Matter.Body.setVelocity(fruitBody, { x: 0, y: 9999 });
    handle.step(1 / 60);

    const speed = Math.sqrt(fruitBody.velocity.x ** 2 + fruitBody.velocity.y ** 2);
    expect(speed).toBeLessThanOrEqual(MAX_FRUIT_SPEED_PX_S / 60 + 0.5);

    handle.cleanup();
  });
});

// ---------------------------------------------------------------------------
// 7. Fixed-step parity: both engines run 2 sub-steps for dt=1/30 — GH #1220
// ---------------------------------------------------------------------------

describe("fixed-step parity — dt=1/30 produces 2 sub-steps on both engines", () => {
  it("Rapier: step(1/30) calls world.step() exactly twice", async () => {
    const handle = await createRapierEngine(W, H, fruitSet);
    const world = getRapierWorld();
    const stepSpy = jest.spyOn(world, "step");
    handle.step(1 / 30);
    expect(stepSpy).toHaveBeenCalledTimes(2);
  });

  it("Matter.js: step(1/30) calls Matter.Engine.update() exactly twice", async () => {
    const handle = await createNativeEngine(W, H, fruitSet);
    const updateSpy = jest.spyOn(Matter.Engine, "update");
    handle.step(1 / 30);
    expect(updateSpy).toHaveBeenCalledTimes(2);
    for (const call of updateSpy.mock.calls) {
      expect(call[1]).toBeLessThanOrEqual(FIXED_STEP_MS + 0.001);
    }
    handle.cleanup();
  });
});

// ---------------------------------------------------------------------------
// 8. Body sleeping parity — GH #1222
// ---------------------------------------------------------------------------

describe("body sleeping parity — sleeping is enabled on both engines", () => {
  it("Rapier: canSleep(true) is called on every spawned body", async () => {
    const canSleepSpy = jest.fn().mockImplementation(function (this: unknown) {
      return this;
    });
    const origDynamic = RAPIER_MOCK.RigidBodyDesc.dynamic;
    RAPIER_MOCK.RigidBodyDesc.dynamic = () => {
      const builder = origDynamic();
      builder.setCanSleep = canSleepSpy;
      return builder;
    };

    try {
      const handle = await createRapierEngine(W, H, fruitSet);
      handle.drop(fruit(0), fruitSet.id, W / 2, 300);
      handle.step();
      expect(canSleepSpy).toHaveBeenCalledWith(true);
    } finally {
      RAPIER_MOCK.RigidBodyDesc.dynamic = origDynamic;
    }
  });

  it("Matter.js: enableSleeping is true on the Matter engine", async () => {
    const createSpy = jest.spyOn(Matter.Engine, "create");
    const handle = await createNativeEngine(W, H, fruitSet);
    const engineInstance = createSpy.mock.results[0]?.value as Matter.Engine & {
      enableSleeping: boolean;
    };
    expect(engineInstance.enableSleeping).toBe(true);
    handle.cleanup();
  });
});

// ---------------------------------------------------------------------------
// 6. Different-tier fruits never merge on either engine
// ---------------------------------------------------------------------------

describe("no cross-tier merges", () => {
  it("Rapier: tier-0 and tier-2 collision does NOT fire fruitMerge", async () => {
    const handle = await createRapierEngine(W, H, fruitSet);
    const world = getRapierWorld();

    handle.drop(fruit(0), fruitSet.id, 100, 300);
    handle.drop(fruit(2), fruitSet.id, 110, 300);
    handle.step();
    world._fireCollision(1003, 1004);
    const { events } = handle.step();

    expect(events.filter((e) => e.type === "fruitMerge")).toHaveLength(0);
  });

  it("Matter.js: tier-0 and tier-2 do NOT merge even when overlapping", async () => {
    const handle = await createNativeEngine(W, H, fruitSet);
    let mergeCount = 0;

    handle.drop(fruit(0), fruitSet.id, W / 2, 50);
    handle.drop(fruit(2), fruitSet.id, W / 2, 60);

    for (let i = 0; i < 200; i++) {
      const { events } = handle.step(1 / 60);
      mergeCount += events.filter((e) => e.type === "fruitMerge").length;
    }

    expect(mergeCount).toBe(0);
    handle.cleanup();
  });
});

// ---------------------------------------------------------------------------
// 9. Merge count parity (#1224)
// ---------------------------------------------------------------------------

describe("merge count parity — same collision sequence → same fruitMerge count", () => {
  it("Rapier: 3 non-overlapping pairs each produce exactly 1 fruitMerge", async () => {
    const handle = await createRapierEngine(W, H, fruitSet);
    const world = getRapierWorld();

    handle.drop(fruit(1), fruitSet.id, 50, 300);
    handle.drop(fruit(1), fruitSet.id, 60, 300);
    handle.drop(fruit(1), fruitSet.id, 100, 300);
    handle.drop(fruit(1), fruitSet.id, 110, 300);
    handle.drop(fruit(1), fruitSet.id, 150, 300);
    handle.drop(fruit(1), fruitSet.id, 160, 300);
    handle.step();

    world._fireCollision(1003, 1004);
    world._fireCollision(1005, 1006);
    world._fireCollision(1007, 1008);
    const { events } = handle.step();

    expect(events.filter((e) => e.type === "fruitMerge")).toHaveLength(3);
  });

  it("Matter.js: same-tier pairs produce the same fruitMerge count as Rapier", async () => {
    const handle = await createNativeEngine(W, H, fruitSet);
    const tier1 = fruit(1);
    let mergeCount = 0;

    handle.drop(tier1, fruitSet.id, 50, 30);
    handle.drop(tier1, fruitSet.id, 58, 30);

    for (let i = 0; i < 300; i++) {
      const { events } = handle.step(1 / 60);
      mergeCount += events.filter((e) => e.type === "fruitMerge").length;
      if (mergeCount > 0) break;
    }
    // Both engines should produce exactly 1 merge for one pair
    expect(mergeCount).toBe(1);
    handle.cleanup();
  });
});

// ---------------------------------------------------------------------------
// 10. Spawn grace parity (#1226)
// ---------------------------------------------------------------------------

describe("spawn grace parity — both engines apply and expire grace on the same tick count", () => {
  it("Rapier: grace collision groups restored after exactly SPAWN_GRACE_TICKS steps", async () => {
    const handle = await createRapierEngine(W, H, fruitSet);
    const world = getRapierWorld();

    handle.drop(fruit(2), fruitSet.id, 100, 300); // body 0, col 1003
    handle.drop(fruit(2), fruitSet.id, 110, 300); // body 1, col 1004
    handle.step();

    world._fireCollision(1003, 1004);
    handle.step(); // merge → spawns grace body (body 2, col 1005)

    const spawnedCollider = world._bodies.get(2)?._colliders[0];
    expect(spawnedCollider).toBeDefined();

    const GRACE_GROUPS = COLLISION_GROUP_DYNAMIC | (COLLISION_GROUP_WALL << 16);
    const NORMAL_GROUPS =
      COLLISION_GROUP_DYNAMIC | ((COLLISION_GROUP_WALL | COLLISION_GROUP_DYNAMIC) << 16);

    // After spawn step: graceTicksRemaining was 3, decremented to 2 → still grace
    expect(spawnedCollider!._collisionGroups).toBe(GRACE_GROUPS);

    // Step SPAWN_GRACE_TICKS-1 more times to exhaust grace
    for (let i = 0; i < SPAWN_GRACE_TICKS - 1; i++) {
      handle.step();
    }
    expect(spawnedCollider!._collisionGroups).toBe(NORMAL_GROUPS);
  });

  it("Matter.js: grace filter restored after exactly SPAWN_GRACE_TICKS steps", async () => {
    const createSpy = jest.spyOn(Matter.Engine, "create");
    const handle = await createNativeEngine(W, H, fruitSet);
    const engineInstance = createSpy.mock.results[0]?.value as Matter.Engine;

    const tier0 = fruit(0);
    handle.drop(tier0, fruitSet.id, W / 2 - 5, 30);
    handle.drop(tier0, fruitSet.id, W / 2 + 5, 30);

    let mergeStep = -1;
    for (let i = 0; i < 300; i++) {
      const { events } = handle.step(1 / 60);
      if (events.some((e) => e.type === "fruitMerge")) {
        mergeStep = i;
        break;
      }
    }
    expect(mergeStep).toBeGreaterThanOrEqual(0);

    // Spawned body should have grace filter right after merge step
    const dynBodies = () =>
      Matter.Composite.allBodies(engineInstance.world).filter((b) => !b.isStatic);
    const graceBody = dynBodies().find(
      (b) => b.collisionFilter.category === COLLISION_GROUP_DYNAMIC
    );
    expect(graceBody).toBeDefined();
    expect(graceBody!.collisionFilter.mask & COLLISION_GROUP_DYNAMIC).toBe(0);

    // Step SPAWN_GRACE_TICKS-1 more times
    for (let i = 0; i < SPAWN_GRACE_TICKS - 1; i++) {
      handle.step(1 / 60);
    }

    // After grace expires, dynamic collisions allowed again
    const restoredBody = dynBodies().find(
      (b) => b.collisionFilter.category === COLLISION_GROUP_DYNAMIC
    );
    expect(restoredBody).toBeDefined();
    expect(restoredBody!.collisionFilter.mask & COLLISION_GROUP_DYNAMIC).not.toBe(0);

    handle.cleanup();
  });
});

// ---------------------------------------------------------------------------
// Game-over hysteresis parity (CASCADE-PHYS-07)
// ---------------------------------------------------------------------------

describe("game-over hysteresis parity — both engines fire gameOver on same tick", () => {
  it("both engines fire gameOver on tick 30 after 30 consecutive ticks above danger line", async () => {
    const rapierHandle = await createRapierEngine(W, H, fruitSet);
    const nativeHandle = await createNativeEngine(W, H, fruitSet);

    // Drop tier-0 at y=50; top = 50-18 = 32 < dangerY (108) → above danger line
    rapierHandle.drop(fruit(0), fruitSet.id, W / 2, 50);
    nativeHandle.drop(fruit(0), fruitSet.id, W / 2, 50);

    jest.useFakeTimers();
    jest.setSystemTime(Date.now() + 5000); // past grace for both engines

    let rapierFiredAt = -1;
    let nativeFiredAt = -1;

    for (let i = 1; i <= GAME_OVER_CONSECUTIVE_TICKS + 5; i++) {
      if (rapierFiredAt === -1) {
        if (rapierHandle.step().events.some((e) => e.type === "gameOver")) rapierFiredAt = i;
      }
      if (nativeFiredAt === -1) {
        // Tiny dt keeps Matter.js body frozen at y=50 (no physics advancement)
        if (nativeHandle.step(1e-7).events.some((e) => e.type === "gameOver")) nativeFiredAt = i;
      }
    }

    jest.useRealTimers();
    nativeHandle.cleanup();

    expect(rapierFiredAt).toBe(GAME_OVER_CONSECUTIVE_TICKS);
    expect(nativeFiredAt).toBe(GAME_OVER_CONSECUTIVE_TICKS);
    expect(rapierFiredAt).toBe(nativeFiredAt);
  });
});

// ---------------------------------------------------------------------------
// Wall containment parity (CASCADE-PHYS-08)
// ---------------------------------------------------------------------------

describe("wall containment parity — no fruit escapes through left or right wall in 600 frames", () => {
  const tier0Radius = fruit(0).radius;
  const innerLeft = WALL_THICKNESS + tier0Radius;
  const innerRight = W - WALL_THICKNESS - tier0Radius;

  it("Rapier: x stays within wall bounds", async () => {
    const handle = await createRapierEngine(W, H, fruitSet);
    handle.drop(fruit(0), fruitSet.id, W / 2, 100);
    for (let i = 0; i < 600; i++) {
      const { snapshots } = handle.step();
      for (const snap of snapshots) {
        expect(snap.x).toBeGreaterThanOrEqual(innerLeft - 1);
        expect(snap.x).toBeLessThanOrEqual(innerRight + 1);
      }
    }
  });

  it("Matter.js: x stays within wall bounds", async () => {
    const handle = await createNativeEngine(W, H, fruitSet);
    handle.drop(fruit(0), fruitSet.id, W / 2, 100);
    for (let i = 0; i < 600; i++) {
      const { snapshots } = handle.step(1 / 60);
      for (const snap of snapshots) {
        expect(snap.x).toBeGreaterThanOrEqual(innerLeft - 1);
        expect(snap.x).toBeLessThanOrEqual(innerRight + 1);
      }
    }
    handle.cleanup();
  });
});
