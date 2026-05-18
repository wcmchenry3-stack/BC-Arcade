/**
 * engine.unified.test.ts — unified Matter.js engine tests
 *
 * Tests the single Matter.js engine now used on all platforms (web + native).
 * Uses the real matter-js library — no mocks needed (pure JS, no WASM).
 */
import Matter from "matter-js";
import { createEngine } from "../engine";
import type { EngineHandle } from "../engine.shared";
import {
  MATTER_POSITION_ITERATIONS,
  MATTER_VELOCITY_ITERATIONS,
  MAX_FRUIT_SPEED_PX_S,
  FIXED_STEP_MS,
  WALL_THICKNESS,
  SPAWN_GRACE_TICKS,
  WARM_SPAWN_FRAMES,
  COLLISION_GROUP_DYNAMIC,
  COLLISION_GROUP_WALL,
  GAME_OVER_CONSECUTIVE_TICKS,
  GAME_OVER_MERGE_COOLDOWN_TICKS,
  FRUIT_ANGULAR_DAMPING,
  FRUIT_FRICTION_AIR,
} from "../engine.shared";
import { FRUIT_SETS, FruitSet, FruitDefinition } from "../../../theme/fruitSets";

function requireFruitSet(id: string): FruitSet {
  const fs = FRUIT_SETS[id];
  if (fs === undefined) throw new Error(`FruitSet '${id}' not found`);
  return fs;
}
const fruitSet: FruitSet = requireFruitSet("fruits");
const W = 300;
const H = 600;

/** Get a FruitDefinition by tier index, throws if missing. */
function fruit(tier: number): FruitDefinition {
  const f = fruitSet.fruits[tier];
  if (f === undefined) throw new Error(`No fruit for tier ${tier}`);
  return f;
}

async function buildEngine(): Promise<EngineHandle> {
  return createEngine(W, H, fruitSet);
}

afterEach(() => {
  jest.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// createEngine basics
// ---------------------------------------------------------------------------

describe("createEngine", () => {
  it("resolves to an EngineHandle with step, drop, and cleanup", async () => {
    const handle = await buildEngine();
    expect(typeof handle.step).toBe("function");
    expect(typeof handle.drop).toBe("function");
    expect(typeof handle.cleanup).toBe("function");
    handle.cleanup();
  });

  it("step returns empty snapshots when no fruits exist", async () => {
    const handle = await buildEngine();
    const { snapshots } = handle.step(1 / 60);
    expect(snapshots).toEqual([]);
    handle.cleanup();
  });

  it("sets positionIterations and velocityIterations on the Matter engine", async () => {
    const createSpy = jest.spyOn(Matter.Engine, "create");
    const handle = await buildEngine();
    const engineInstance = createSpy.mock.results[0]?.value as Matter.Engine;
    expect(engineInstance.positionIterations).toBe(MATTER_POSITION_ITERATIONS);
    expect(engineInstance.velocityIterations).toBe(MATTER_VELOCITY_ITERATIONS);
    handle.cleanup();
  });

  it("enables sleeping on the Matter engine", async () => {
    const createSpy = jest.spyOn(Matter.Engine, "create");
    const handle = await buildEngine();
    const engineInstance = createSpy.mock.results[0]?.value as Matter.Engine & {
      enableSleeping: boolean;
    };
    expect(engineInstance.enableSleeping).toBe(true);
    handle.cleanup();
  });
});

// ---------------------------------------------------------------------------
// drop + step
// ---------------------------------------------------------------------------

describe("drop and step", () => {
  it("returns a snapshot with correct tier after dropping a fruit", async () => {
    const handle = await buildEngine();
    const tier0 = fruit(0);
    handle.drop(tier0, "fruits", W / 2, 30);
    const { snapshots } = handle.step(1 / 60);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]?.tier).toBe(0);
    expect(typeof snapshots[0]?.x).toBe("number");
    expect(typeof snapshots[0]?.y).toBe("number");
    expect(typeof snapshots[0]?.angle).toBe("number");
    handle.cleanup();
  });

  it("fruits fall under gravity (y increases over time)", async () => {
    const handle = await buildEngine();
    const tier0 = fruit(0);
    handle.drop(tier0, "fruits", W / 2, 50);
    handle.step(1 / 60);
    const y1 = handle.step(1 / 60).snapshots[0]?.y ?? 0;
    // Step many more frames
    for (let i = 0; i < 10; i++) handle.step(1 / 60);
    const y2 = handle.step(1 / 60).snapshots[0]?.y ?? 0;
    expect(y2).toBeGreaterThan(y1);
    handle.cleanup();
  });

  it("multiple drops produce multiple snapshots", async () => {
    const handle = await buildEngine();
    handle.drop(fruit(0), "fruits", W / 4, 30);
    handle.drop(fruit(1), "fruits", (3 * W) / 4, 30);
    const { snapshots } = handle.step(1 / 60);
    expect(snapshots).toHaveLength(2);
    const tiers = snapshots.map((s) => s.tier).sort();
    expect(tiers).toEqual([0, 1]);
    handle.cleanup();
  });
});

// ---------------------------------------------------------------------------
// Merge detection
// ---------------------------------------------------------------------------

describe("merge detection", () => {
  it("same-tier fruits merge when they collide", async () => {
    const handle = await buildEngine();
    const tier0 = fruit(0);
    let mergeEvents: { type: string; tier?: number }[] = [];

    // Drop two same-tier fruits close together so they collide when falling
    handle.drop(tier0, "fruits", W / 2 - 5, 30);
    handle.drop(tier0, "fruits", W / 2 + 5, 30);

    // Run enough steps for them to fall and collide
    for (let i = 0; i < 300; i++) {
      const { events } = handle.step(1 / 60);
      mergeEvents = [...mergeEvents, ...events.filter((e) => e.type === "fruitMerge")];
      if (mergeEvents.length > 0) break;
    }

    expect(mergeEvents.length).toBeGreaterThan(0);
    expect((mergeEvents[0] as { tier: number }).tier).toBe(0);
    handle.cleanup();
  });

  it("merge spawns tier+1 fruit", async () => {
    const handle = await buildEngine();
    const tier0 = fruit(0);
    let merged = false;

    // Drop two tier-0 fruits on top of each other
    handle.drop(tier0, "fruits", W / 2, 30);
    handle.drop(tier0, "fruits", W / 2, 50);

    // Step until merge fires
    for (let i = 0; i < 300; i++) {
      const { events } = handle.step(1 / 60);
      if (events.some((e) => e.type === "fruitMerge")) {
        merged = true;
        break;
      }
    }

    if (merged) {
      // After merge, step once more and check for tier-1 body
      const { snapshots } = handle.step(1 / 60);
      const tier1Bodies = snapshots.filter((s) => s.tier === 1);
      expect(tier1Bodies.length).toBeGreaterThanOrEqual(1);
    }
    handle.cleanup();
  });

  it("different-tier fruits do NOT merge", async () => {
    const handle = await buildEngine();
    let mergeCount = 0;

    // Drop tier 0 and tier 1 close together
    handle.drop(fruit(0), "fruits", W / 2, 30);
    handle.drop(fruit(1), "fruits", W / 2, 60);

    for (let i = 0; i < 200; i++) {
      const { events } = handle.step(1 / 60);
      mergeCount += events.filter((e) => e.type === "fruitMerge").length;
    }

    expect(mergeCount).toBe(0);
    handle.cleanup();
  });
});

// ---------------------------------------------------------------------------
// Game over
// ---------------------------------------------------------------------------

describe("game over", () => {
  it("fires when a settled fruit is above the danger line", async () => {
    // Mock Date.now so the fruit is immediately past the grace period
    const fakeNow = Date.now();
    jest.spyOn(Date, "now").mockReturnValue(fakeNow);

    const handle = await buildEngine();

    // Drop a fruit above the danger line (dangerY = H * 0.18 = 108px)
    // The fruit's top edge (y - radius) must be < 108
    const tier0 = fruit(0);
    handle.drop(tier0, "fruits", W / 2, 50);

    // Advance time past the grace period (3000ms)
    (Date.now as jest.Mock).mockReturnValue(fakeNow + 5000);

    // Hysteresis requires GAME_OVER_CONSECUTIVE_TICKS consecutive ticks above the line.
    // Use tiny dt so physics doesn't advance (fruit stays at y=50 throughout).
    let fired = false;
    for (let i = 0; i < GAME_OVER_CONSECUTIVE_TICKS + 5; i++) {
      if (handle.step(1e-7).events.some((e) => e.type === "gameOver")) {
        fired = true;
        break;
      }
    }

    expect(fired).toBe(true);
    handle.cleanup();
  });
});

// ---------------------------------------------------------------------------
// cleanup
// ---------------------------------------------------------------------------

describe("cleanup", () => {
  it("does not throw", async () => {
    const handle = await buildEngine();
    handle.drop(fruit(0), "fruits", W / 2, 30);
    handle.step(1 / 60);
    expect(() => handle.cleanup()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Velocity clamp
// ---------------------------------------------------------------------------

describe("velocity clamp", () => {
  it("Matter body velocity is capped per step", async () => {
    const createSpy = jest.spyOn(Matter.Engine, "create");
    const handle = await buildEngine();
    const engineInstance = createSpy.mock.results[0]?.value as Matter.Engine;

    handle.drop(fruit(0), "fruits", W / 2, 300);
    handle.step(1 / 60); // register body

    const dynamicBodies = Matter.Composite.allBodies(engineInstance.world).filter(
      (b) => !b.isStatic
    );
    const fruitBody = dynamicBodies[0];
    if (!fruitBody) throw new Error("Expected a fruit body");

    // Force velocity far above the clamp threshold
    Matter.Body.setVelocity(fruitBody, { x: 0, y: 9999 });
    handle.step(1 / 60);

    const speed = Math.sqrt(fruitBody.velocity.x ** 2 + fruitBody.velocity.y ** 2);
    const maxSpeedPerStep = MAX_FRUIT_SPEED_PX_S / 60;
    expect(speed).toBeLessThanOrEqual(maxSpeedPerStep + 0.5);

    handle.cleanup();
  });
});

// ---------------------------------------------------------------------------
// Merge detection — extended (#202)
// ---------------------------------------------------------------------------

describe("merge detection — extended", () => {
  it("does NOT spawn a new fruit when merging tier-10 (watermelon disappears)", async () => {
    const handle = await buildEngine();
    const tier10 = fruit(10); // radius = 168
    let mergeEvents: { type: string; tier?: number }[] = [];

    // Drop two tier-10 fruits nearly on top of each other — overlap triggers immediate collision
    handle.drop(tier10, "fruits", W / 2 - 5, 50);
    handle.drop(tier10, "fruits", W / 2 + 5, 50);

    for (let i = 0; i < 300; i++) {
      const { events } = handle.step(1 / 60);
      mergeEvents = [...mergeEvents, ...events.filter((e) => e.type === "fruitMerge")];
      if (mergeEvents.length > 0) break;
    }

    expect(mergeEvents.some((e) => (e as { tier: number }).tier === 10)).toBe(true);
    // No tier-11 exists; step once more and verify no bodies remain
    const { snapshots } = handle.step(1 / 60);
    expect(snapshots.every((s) => s.tier !== 11)).toBe(true);
    handle.cleanup();
  });
});

// ---------------------------------------------------------------------------
// Game-over detection — extended (#202)
// ---------------------------------------------------------------------------

describe("game-over detection — extended", () => {
  // dangerY = H * DANGER_LINE_RATIO = 600 * 0.18 = 108px

  it("does NOT fire gameOver during the grace period", async () => {
    const fakeNow = Date.now();
    jest.spyOn(Date, "now").mockReturnValue(fakeNow);

    const handle = await buildEngine();
    handle.drop(fruit(0), "fruits", W / 2, 50);

    // Step within the grace period — time hasn't advanced
    const { events } = handle.step(1 / 60);
    expect(events.some((e) => e.type === "gameOver")).toBe(false);

    handle.cleanup();
  });

  it("does NOT fire gameOver when fruit is safely below the danger line", async () => {
    const fakeNow = Date.now();
    jest.spyOn(Date, "now").mockReturnValue(fakeNow);

    const handle = await buildEngine();
    // y=500 → top = 500 - 18 = 482 > dangerY (108) → safe
    handle.drop(fruit(0), "fruits", W / 2, 500);
    handle.step(1 / 60);

    (Date.now as jest.Mock).mockReturnValue(fakeNow + 5000);
    const { events } = handle.step(1 / 60);

    expect(events.some((e) => e.type === "gameOver")).toBe(false);
    handle.cleanup();
  });

  it("fires gameOver only once across multiple steps", async () => {
    const fakeNow = Date.now();
    jest.spyOn(Date, "now").mockReturnValue(fakeNow);

    const handle = await buildEngine();
    handle.drop(fruit(0), "fruits", W / 2, 50);

    (Date.now as jest.Mock).mockReturnValue(fakeNow + 5000);
    let gameOverCount = 0;
    // Run well past the 30-tick threshold with frozen physics; gameOver must fire exactly once.
    for (let i = 0; i < GAME_OVER_CONSECUTIVE_TICKS + 30; i++) {
      gameOverCount += handle.step(1e-7).events.filter((e) => e.type === "gameOver").length;
    }

    expect(gameOverCount).toBe(1);
    handle.cleanup();
  });
});

// ---------------------------------------------------------------------------
// Game-over hysteresis (CASCADE-PHYS-07)
// ---------------------------------------------------------------------------
// Tiny dt (1e-7 s) is used so physics sub-steps don't execute
// (remainingMs < 0.01 ms threshold), keeping body positions frozen
// while still advancing game-tick counters.

describe("game-over hysteresis", () => {
  // dangerY = H * 0.18 = 108px; tier-0 top = y - 18; above line when y < 126.

  it("single tick above danger does not fire gameOver", async () => {
    const fakeNow = Date.now();
    jest.spyOn(Date, "now").mockReturnValue(fakeNow);
    const handle = await buildEngine();
    handle.drop(fruit(0), "fruits", W / 2, 50);

    (Date.now as jest.Mock).mockReturnValue(fakeNow + 5000);
    const { events } = handle.step(1e-7); // physics frozen

    expect(events.some((e) => e.type === "gameOver")).toBe(false);
    handle.cleanup();
  });

  it("30 consecutive ticks above danger fires gameOver on the 30th", async () => {
    const fakeNow = Date.now();
    jest.spyOn(Date, "now").mockReturnValue(fakeNow);
    const handle = await buildEngine();
    handle.drop(fruit(0), "fruits", W / 2, 50);

    (Date.now as jest.Mock).mockReturnValue(fakeNow + 5000);
    let firedAt = -1;
    for (let i = 1; i <= GAME_OVER_CONSECUTIVE_TICKS + 5; i++) {
      if (handle.step(1e-7).events.some((e) => e.type === "gameOver")) {
        firedAt = i;
        break;
      }
    }

    expect(firedAt).toBe(GAME_OVER_CONSECUTIVE_TICKS);
    handle.cleanup();
  });

  it("counter resets when fruit drops below danger line", async () => {
    const createSpy = jest.spyOn(Matter.Engine, "create");
    const fakeNow = Date.now();
    jest.spyOn(Date, "now").mockReturnValue(fakeNow);
    const handle = await buildEngine();
    const engineInstance = createSpy.mock.results[0]?.value as Matter.Engine;

    handle.drop(fruit(0), "fruits", W / 2, 50);
    (Date.now as jest.Mock).mockReturnValue(fakeNow + 5000);

    const getDynamic = () =>
      Matter.Composite.allBodies(engineInstance.world).filter((b) => !b.isStatic);

    // 15 ticks above danger — dangerTicksAbove=15; not enough to fire (need 30)
    const halfThreshold = 15;
    for (let i = 0; i < halfThreshold; i++) {
      expect(handle.step(1e-7).events.some((e) => e.type === "gameOver")).toBe(false);
    }

    // Move below danger line (y=400, top=382 > 108) — counter resets to 0
    const fruitBody = getDynamic()[0]!;
    Matter.Body.setPosition(fruitBody, { x: W / 2, y: 400 });
    handle.step(1e-7);

    // Move back above danger line
    Matter.Body.setPosition(fruitBody, { x: W / 2, y: 50 });

    // Needs a full 30 consecutive ticks from the reset (not just 15 more)
    let firedAt = -1;
    for (let i = 1; i <= GAME_OVER_CONSECUTIVE_TICKS + 5; i++) {
      if (handle.step(1e-7).events.some((e) => e.type === "gameOver")) {
        firedAt = i;
        break;
      }
    }

    expect(firedAt).toBe(GAME_OVER_CONSECUTIVE_TICKS);
    handle.cleanup();
  });

  it("merge in last 90 ticks suppresses gameOver even after 30 consecutive ticks above", async () => {
    const createSpy = jest.spyOn(Matter.Engine, "create");
    const fakeNow = Date.now();
    jest.spyOn(Date, "now").mockReturnValue(fakeNow);
    const handle = await buildEngine();
    const engineInstance = createSpy.mock.results[0]?.value as Matter.Engine;

    // Dangerous fruit above danger line
    handle.drop(fruit(0), "fruits", W / 2, 50);
    // Merge pair — same tier, positioned away from danger zone
    handle.drop(fruit(0), "fruits", W / 4, 300);
    handle.drop(fruit(0), "fruits", W / 4 + 1, 300);

    (Date.now as jest.Mock).mockReturnValue(fakeNow + 5000);

    const getDynamic = () =>
      Matter.Composite.allBodies(engineInstance.world).filter((b) => !b.isStatic);

    // 29 ticks above danger — dangerTicksAbove=29
    for (let i = 0; i < GAME_OVER_CONSECUTIVE_TICKS - 1; i++) handle.step(1e-7);

    // Inject a synthetic merge between the pair → resets ticksSinceLastMerge to 0
    const allDynamic = getDynamic();
    const mergeBodyA = allDynamic.find((b) => Math.abs(b.position.y - 300) < 20)!;
    const mergeBodyB = allDynamic.find(
      (b) => b !== mergeBodyA && Math.abs(b.position.y - 300) < 20
    )!;
    Matter.Events.trigger(engineInstance, "collisionStart", {
      pairs: [{ bodyA: mergeBodyA, bodyB: mergeBodyB }],
    });

    // This step processes the merge: dangerTicksAbove=30, ticksSinceLastMerge=0
    // 30 >= 30 but 0 < 90 → must NOT fire
    const { events: mergeStep } = handle.step(1e-7);
    expect(mergeStep.some((e) => e.type === "gameOver")).toBe(false);
    expect(mergeStep.some((e) => e.type === "fruitMerge")).toBe(true);

    // 89 more steps — ticksSinceLastMerge climbs to 89; still suppressed
    for (let i = 0; i < GAME_OVER_MERGE_COOLDOWN_TICKS - 1; i++) {
      expect(handle.step(1e-7).events.some((e) => e.type === "gameOver")).toBe(false);
    }

    // Final step: ticksSinceLastMerge=90 >= cooldown → fires
    const { events: finalStep } = handle.step(1e-7);
    expect(finalStep.some((e) => e.type === "gameOver")).toBe(true);
    handle.cleanup();
  });
});

// ---------------------------------------------------------------------------
// CCD analysis (CASCADE-PHYS-08)
// ---------------------------------------------------------------------------

describe("CCD analysis", () => {
  it("tier-0 fruit cannot tunnel wall in one sub-step at MAX_FRUIT_SPEED_PX_S", () => {
    // Arithmetic assertion: max travel per 1/60 sub-step must be < WALL_THICKNESS.
    // tier-0 radius = 18px (smallest fruit); WALL_THICKNESS = 16px.
    const maxTravelPerStep = (MAX_FRUIT_SPEED_PX_S * FIXED_STEP_MS) / 1000;
    expect(maxTravelPerStep).toBeLessThan(WALL_THICKNESS);
  });

  it("fruit at terminal velocity does not escape through floor in one step", async () => {
    const createSpy = jest.spyOn(Matter.Engine, "create");
    const handle = await buildEngine();
    const engineInstance = createSpy.mock.results[0]?.value as Matter.Engine;

    const tier0 = fruit(0);
    // Place fruit just above the floor boundary
    const innerBottom = H - WALL_THICKNESS - tier0.radius;
    handle.drop(tier0, "fruits", W / 2, innerBottom - 1);
    handle.step(1 / 60); // register body

    const fruitBody = Matter.Composite.allBodies(engineInstance.world).filter(
      (b) => !b.isStatic
    )[0];
    if (!fruitBody) throw new Error("Expected fruit body");

    // Set velocity to exactly terminal speed downward
    const maxVelPerStep = (MAX_FRUIT_SPEED_PX_S * FIXED_STEP_MS) / 1000;
    Matter.Body.setVelocity(fruitBody, { x: 0, y: maxVelPerStep });
    Matter.Body.setPosition(fruitBody, { x: W / 2, y: innerBottom - 1 });

    handle.step(1 / 60);

    // Fruit must remain within the floor boundary. Allow 2px for polygon-inradius
    // vs circumradius drift (the hard clamp is removed; polygon vertices contact
    // the floor at inradius, so the centre sits slightly below innerBottom).
    expect(fruitBody.position.y).toBeLessThanOrEqual(innerBottom + 2);
    handle.cleanup();
  });
});

// ---------------------------------------------------------------------------
// Boundary escape (#202)
// ---------------------------------------------------------------------------

describe("boundary escape", () => {
  // tier-0 radius = 18, margin = 36
  const RADIUS = fruit(0).radius; // 18
  const MARGIN = RADIUS * 2; // 36

  it("removes body when fruit is dropped below the floor", async () => {
    const handle = await buildEngine();
    // Drop directly below the floor — py > H + margin on first step
    handle.drop(fruit(0), "fruits", W / 2, H + MARGIN + 10);
    const { snapshots } = handle.step(1 / 60);
    // Escaped body not in snapshots
    expect(snapshots).toHaveLength(0);
    handle.cleanup();
  });

  it("removes body when fruit is dropped past the left wall", async () => {
    const handle = await buildEngine();
    handle.drop(fruit(0), "fruits", -MARGIN - 10, H / 2);
    const { snapshots } = handle.step(1 / 60);
    expect(snapshots).toHaveLength(0);
    handle.cleanup();
  });

  it("removes body when fruit is dropped past the right wall", async () => {
    const handle = await buildEngine();
    handle.drop(fruit(0), "fruits", W + MARGIN + 10, H / 2);
    const { snapshots } = handle.step(1 / 60);
    expect(snapshots).toHaveLength(0);
    handle.cleanup();
  });

  it("does NOT remove a fruit inside the escape margin", async () => {
    const handle = await buildEngine();
    // px = W + RADIUS: outside the right wall but within the escape margin (W + MARGIN).
    // Escape detection threshold is W + MARGIN, so this body stays in snapshots.
    handle.drop(fruit(0), "fruits", W + RADIUS, H / 2);
    const { snapshots } = handle.step(1 / 60);
    expect(snapshots).toHaveLength(1);
    handle.cleanup();
  });

  it("boundary escape does not emit gameOver event", async () => {
    const handle = await buildEngine();
    handle.drop(fruit(0), "fruits", W / 2, H + MARGIN + 10);
    const { events } = handle.step(1 / 60);
    expect(events.some((e) => e.type === "gameOver")).toBe(false);
    handle.cleanup();
  });

  it("a body spawned just below the floor drifts out and is escape-removed", async () => {
    const handle = await buildEngine();
    const tier0 = fruit(0);
    // y = H + radius is below the floor surface but inside the escape margin
    // (H + radius < H + margin = H + radius*2). Without the hard clamp, gravity
    // pulls it through the escape margin within a few steps.
    handle.drop(tier0, "fruits", W / 2, H + tier0.radius);

    // Step until the body escapes (or 30 frames max).
    let snapshots: { id: number; x: number; y: number; tier: number }[] = [];
    for (let i = 0; i < 30; i++) {
      snapshots = handle.step(1 / 60).snapshots;
      if (snapshots.length === 0) break;
    }
    expect(snapshots).toHaveLength(0);
    handle.cleanup();
  });
});

// ---------------------------------------------------------------------------
// Boundary containment after wall-adjacent merges (#552)
// ---------------------------------------------------------------------------

describe("boundary containment — wall-adjacent merges", () => {
  it("merged fruit spawn position is clamped inside left wall", async () => {
    const handle = await buildEngine();
    const tier0 = fruit(0);

    handle.drop(tier0, "fruits", 5, 30);
    handle.drop(tier0, "fruits", 5, 50);

    for (let i = 0; i < 300; i++) {
      const { snapshots: snaps } = handle.step(1 / 60);
      const tier1 = snaps.filter((s) => s.tier === 1);
      if (tier1.length > 0) {
        const tier1Def = fruit(1);
        const innerLeft = 16 + tier1Def.radius; // WALL_THICKNESS=16
        for (const snap of tier1) {
          expect(snap.x).toBeGreaterThanOrEqual(innerLeft - 0.5); // allow float drift
        }
        break;
      }
    }
    handle.cleanup();
  });

  it("merged fruit spawn position is clamped inside right wall", async () => {
    const handle = await buildEngine();
    const tier0 = fruit(0);

    handle.drop(tier0, "fruits", W - 5, 30);
    handle.drop(tier0, "fruits", W - 5, 50);

    for (let i = 0; i < 300; i++) {
      const { snapshots: snaps } = handle.step(1 / 60);
      const tier1 = snaps.filter((s) => s.tier === 1);
      if (tier1.length > 0) {
        const tier1Def = fruit(1);
        const innerRight = W - 16 - tier1Def.radius;
        for (const snap of tier1) {
          expect(snap.x).toBeLessThanOrEqual(innerRight + 0.5);
        }
        break;
      }
    }
    handle.cleanup();
  });
});

// ---------------------------------------------------------------------------
// Wall containment — velocity clamp keeps bodies inside the play area.
// ---------------------------------------------------------------------------

describe("wall containment — velocity clamp", () => {
  it("a normally-dropped body stays inside the play area throughout normal play", async () => {
    const handle = await buildEngine();
    const tier0 = fruit(0);

    handle.drop(tier0, "fruits", W / 2, 300);
    // Let it settle, then verify it remains in bounds.
    for (let i = 0; i < 30; i++) handle.step(1 / 60);

    const { snapshots: snaps } = handle.step(1 / 60);
    for (const snap of snaps) {
      if (snap.tier === 0) {
        expect(snap.x).toBeGreaterThanOrEqual(0);
        expect(snap.x).toBeLessThanOrEqual(W);
      }
    }
    handle.cleanup();
  });

  it("no hard-clamp: merged fruit spawned near left wall does not penetrate it", async () => {
    const handle = await buildEngine();
    const tier0 = fruit(0);
    const innerLeft = 16 + fruit(1).radius; // WALL_THICKNESS + tier-1 radius

    handle.drop(tier0, "fruits", 20, 30);
    handle.drop(tier0, "fruits", 20, 50);

    for (let i = 0; i < 300; i++) {
      const { snapshots: snaps } = handle.step(1 / 60);
      const tier1 = snaps.filter((s) => s.tier === 1);
      if (tier1.length > 0) {
        for (const snap of tier1) {
          expect(snap.x).toBeGreaterThanOrEqual(innerLeft - 1);
        }
        break;
      }
    }
    handle.cleanup();
  });
});

// ---------------------------------------------------------------------------
// Physics sub-stepping (#499)
// ---------------------------------------------------------------------------

describe("physics sub-stepping", () => {
  it("splits a 33ms frame into two Matter.Engine.update calls", async () => {
    const handle = await createEngine(W, H, fruitSet);
    const updateSpy = jest.spyOn(Matter.Engine, "update");
    handle.step(1 / 30); // 33.33ms
    expect(updateSpy).toHaveBeenCalledTimes(2);
    // Each sub-step should be at or under the 60Hz fixed step (~16.67ms).
    for (const call of updateSpy.mock.calls) {
      expect(call[1]).toBeLessThanOrEqual(1000 / 60 + 0.001);
    }
    handle.cleanup();
  });

  it("clamps a huge frame delta (1s) to ≤ 1/6s of simulated time", async () => {
    const handle = await createEngine(W, H, fruitSet);
    const updateSpy = jest.spyOn(Matter.Engine, "update");
    handle.step(1); // 1 second — would be 60 sub-steps uncapped
    const totalMs = updateSpy.mock.calls.reduce((sum, c) => sum + (c[1] as number), 0);
    // 1/6s cap = ~166.67ms. Allow a hair of float drift.
    expect(totalMs).toBeLessThanOrEqual(1000 / 6 + 0.1);
    expect(updateSpy.mock.calls.length).toBeLessThanOrEqual(11);
    handle.cleanup();
  });
});

// ---------------------------------------------------------------------------
// Merge pipeline hardening (#1224)
// ---------------------------------------------------------------------------

describe("merge pipeline hardening — tier snapshot guard", () => {
  it("rejects stale pair when collisionStart fires twice for the same pair", async () => {
    const createSpy = jest.spyOn(Matter.Engine, "create");
    const handle = await buildEngine();
    const engineInstance = createSpy.mock.results[0]?.value as Matter.Engine;

    // Drop well apart (2× radius = 64px; use 80+220=140px gap) so they don't auto-merge
    handle.drop(fruit(2), "fruits", 80, 300);
    handle.drop(fruit(2), "fruits", 220, 300);
    handle.step(1 / 60); // register without collision

    const dynamicBodies = Matter.Composite.allBodies(engineInstance.world).filter(
      (b) => !b.isStatic && b.parent === b
    );
    const [bodyA, bodyB] = dynamicBodies;
    if (!bodyA || !bodyB) throw new Error("Expected two fruit bodies");

    // Emit collisionStart twice for the same pair — simulates two sub-steps
    const fakePair = { bodyA, bodyB, activeContacts: [], separation: 0, isActive: true };
    Matter.Events.trigger(engineInstance, "collisionStart", { pairs: [fakePair] });
    Matter.Events.trigger(engineInstance, "collisionStart", { pairs: [fakePair] });

    const { events } = handle.step(1 / 60);
    const merges = events.filter((e) => e.type === "fruitMerge");
    expect(merges).toHaveLength(1);
    handle.cleanup();
  });

  it("no duplicate fruitMerge when collisionStart fires multiple times for same pair", async () => {
    const createSpy = jest.spyOn(Matter.Engine, "create");
    const handle = await buildEngine();
    const engineInstance = createSpy.mock.results[0]?.value as Matter.Engine;

    handle.drop(fruit(3), "fruits", 80, 300);
    handle.drop(fruit(3), "fruits", 220, 300);
    handle.step(1 / 60);

    const allBodies = Matter.Composite.allBodies(engineInstance.world).filter(
      (b) => !b.isStatic && b.parent === b
    );
    const [bA, bB] = allBodies;
    if (!bA || !bB) throw new Error("Expected two fruit bodies");

    const fakePair = { bodyA: bA, bodyB: bB, activeContacts: [], separation: 0, isActive: true };
    Matter.Events.trigger(engineInstance, "collisionStart", { pairs: [fakePair] });
    Matter.Events.trigger(engineInstance, "collisionStart", { pairs: [fakePair] });
    Matter.Events.trigger(engineInstance, "collisionStart", { pairs: [fakePair] });

    const { events } = handle.step(1 / 60);
    // No matter how many times the event fires, at most one merge per pair
    expect(events.filter((e) => e.type === "fruitMerge").length).toBeLessThanOrEqual(1);
    handle.cleanup();
  });
});

// ---------------------------------------------------------------------------
// Spawn grace period (#1226)
// ---------------------------------------------------------------------------

describe("spawn grace", () => {
  it("merge-spawned body has collision filter excluding dynamic for SPAWN_GRACE_TICKS ticks", async () => {
    const createSpy = jest.spyOn(Matter.Engine, "create");
    const handle = await buildEngine();
    const engineInstance = createSpy.mock.results[0]?.value as Matter.Engine;

    const tier0 = fruit(0);
    handle.drop(tier0, "fruits", W / 2 - 5, 30);
    handle.drop(tier0, "fruits", W / 2 + 5, 30);

    // Run until merge fires
    let spawned = false;
    for (let i = 0; i < 300; i++) {
      const { events } = handle.step(1 / 60);
      if (events.some((e) => e.type === "fruitMerge")) {
        spawned = true;
        break;
      }
    }
    expect(spawned).toBe(true);

    // After the merge step, check the spawned tier-1 body's collision filter
    const dynBodies = Matter.Composite.allBodies(engineInstance.world).filter((b) => !b.isStatic);
    const tier1Body = dynBodies.find((b) => b.collisionFilter.category === COLLISION_GROUP_DYNAMIC);
    expect(tier1Body).toBeDefined();
    // Grace body: mask should only include WALL group, not DYNAMIC
    expect(tier1Body!.collisionFilter.mask & COLLISION_GROUP_DYNAMIC).toBe(0);
    expect(tier1Body!.collisionFilter.mask & COLLISION_GROUP_WALL).not.toBe(0);

    handle.cleanup();
  });

  it("spawned grace body collision filter is restored after SPAWN_GRACE_TICKS steps", async () => {
    const createSpy = jest.spyOn(Matter.Engine, "create");
    const handle = await buildEngine();
    const engineInstance = createSpy.mock.results[0]?.value as Matter.Engine;

    const tier0 = fruit(0);
    handle.drop(tier0, "fruits", W / 2 - 5, 30);
    handle.drop(tier0, "fruits", W / 2 + 5, 30);

    let mergeStep = -1;
    for (let i = 0; i < 300; i++) {
      const { events } = handle.step(1 / 60);
      if (events.some((e) => e.type === "fruitMerge")) {
        mergeStep = i;
        break;
      }
    }
    expect(mergeStep).toBeGreaterThanOrEqual(0);

    // Step SPAWN_GRACE_TICKS-1 more times (the merge step already decremented once)
    for (let i = 0; i < SPAWN_GRACE_TICKS - 1; i++) {
      handle.step(1 / 60);
    }

    // After grace expires, the spawned body should collide with DYNAMIC group again
    const dynBodies = Matter.Composite.allBodies(engineInstance.world).filter((b) => !b.isStatic);
    const tier1Body = dynBodies.find((b) => b.collisionFilter.category === COLLISION_GROUP_DYNAMIC);
    expect(tier1Body).toBeDefined();
    expect(tier1Body!.collisionFilter.mask & COLLISION_GROUP_DYNAMIC).not.toBe(0);

    handle.cleanup();
  });

  it("player-dropped body is not in grace (can collide with other dynamic bodies immediately)", async () => {
    const handle = await buildEngine();

    const tier0 = fruit(0);
    handle.drop(tier0, "fruits", W / 2 - 5, 30);
    handle.drop(tier0, "fruits", W / 2 + 5, 30);

    let mergeCount = 0;
    for (let i = 0; i < 300; i++) {
      const { events } = handle.step(1 / 60);
      mergeCount += events.filter((e) => e.type === "fruitMerge").length;
      if (mergeCount > 0) break;
    }
    // Player drops should be able to merge (no grace restriction)
    expect(mergeCount).toBeGreaterThan(0);
    handle.cleanup();
  });
});

// ---------------------------------------------------------------------------
// Determinism — CASCADE-PHYS-10 (#1240)
// ---------------------------------------------------------------------------

describe("determinism — nowProvider injection removes Date.now() non-determinism", () => {
  it("50 drops + 300 ticks with a fixed nowProvider produce identical snapshots on two runs", async () => {
    const FIXED_NOW = 1_000_000;
    const nowFn = () => FIXED_NOW;

    async function run() {
      const handle = await createEngine(W, H, fruitSet, nowFn);
      for (let i = 0; i < 50; i++) {
        handle.drop(fruit(i % 5), "fruits", 50 + (i % 5) * 40, 30 + (i % 3) * 10);
      }
      let last = handle.step(1 / 60).snapshots;
      for (let i = 1; i < 300; i++) last = handle.step(1 / 60).snapshots;
      handle.cleanup();
      return last.map((s) => ({
        x: Math.round(s.x * 10),
        y: Math.round(s.y * 10),
        tier: s.tier,
      }));
    }

    const run1 = await run();
    const run2 = await run();
    expect(run1).toEqual(run2);
  });
});

// ---------------------------------------------------------------------------
// UC1 — angular damping, air friction, body sleeping (#1610)
// ---------------------------------------------------------------------------

describe("UC1 — angular damping and air friction", () => {
  it("post-step angular damping reduces spin faster than frictionAir alone", async () => {
    const createSpy = jest.spyOn(Matter.Engine, "create");
    const handle = await buildEngine();
    const engineInstance = createSpy.mock.results[0]?.value as Matter.Engine;

    // Drop in free-fall (not touching floor) so only frictionAir + our post-step
    // damping act on angular velocity — no contact friction involved.
    handle.drop(fruit(0), "fruits", W / 2, 50);
    handle.step(1 / 60);

    const body = Matter.Composite.allBodies(engineInstance.world).filter((b) => !b.isStatic)[0];
    if (!body) throw new Error("Expected fruit body");

    const initialOmega = 1.0;
    Matter.Body.setAngularVelocity(body, initialOmega);
    handle.step(1 / 60);

    // frictionAir alone (0.01/step) would leave omega ≈ 0.99.
    // Our post-step damping (FRUIT_ANGULAR_DAMPING = 0.05) cuts it by at least 5%.
    // So the combined result must be < (1 - FRUIT_ANGULAR_DAMPING) = 0.95.
    expect(Math.abs(body.angularVelocity)).toBeLessThan(initialOmega * (1 - FRUIT_ANGULAR_DAMPING));

    handle.cleanup();
  });

  it("spawned body has frictionAir = FRUIT_FRICTION_AIR", async () => {
    const createSpy = jest.spyOn(Matter.Engine, "create");
    const handle = await buildEngine();
    const engineInstance = createSpy.mock.results[0]?.value as Matter.Engine;

    handle.drop(fruit(0), "fruits", W / 2, 50);
    handle.step(1 / 60);

    const body = Matter.Composite.allBodies(engineInstance.world).filter((b) => !b.isStatic)[0];
    expect(body).toBeDefined();
    expect(body!.frictionAir).toBe(FRUIT_FRICTION_AIR);

    handle.cleanup();
  });

  it("body angular velocity drops below 0.01 rad/step after settling on the floor", async () => {
    const createSpy = jest.spyOn(Matter.Engine, "create");
    const handle = await buildEngine();
    const engineInstance = createSpy.mock.results[0]?.value as Matter.Engine;

    handle.drop(fruit(0), "fruits", W / 2, H - 80);
    handle.step(1 / 60);

    const body = Matter.Composite.allBodies(engineInstance.world).filter((b) => !b.isStatic)[0];
    if (!body) throw new Error("Expected fruit body");
    Matter.Body.setAngularVelocity(body, 2); // spin it hard

    // Step 3000ms worth of ticks (180 ticks at 60 Hz)
    for (let i = 0; i < 180; i++) handle.step(1 / 60);

    expect(Math.abs(body.angularVelocity)).toBeLessThan(0.01);

    handle.cleanup();
  });

  it("sleeping body count > 0 after 3000ms fast-forward with a settled fruit", async () => {
    const createSpy = jest.spyOn(Matter.Engine, "create");
    const handle = await buildEngine();
    const engineInstance = createSpy.mock.results[0]?.value as Matter.Engine;

    handle.drop(fruit(0), "fruits", W / 2, H - 80);

    // Step 180 ticks (≈3000ms) to let the body settle and sleep
    for (let i = 0; i < 180; i++) handle.step(1 / 60);

    const sleepingCount = Matter.Composite.allBodies(engineInstance.world).filter(
      (b) => !b.isStatic && b.isSleeping
    ).length;
    expect(sleepingCount).toBeGreaterThan(0);

    handle.cleanup();
  });
});

// ---------------------------------------------------------------------------
// UC2 — warm-spawn merge + mass-weighted velocity (#1611)
// ---------------------------------------------------------------------------

describe("UC2 — warm-spawn merge", () => {
  it("merge-spawned body starts at ~50% radius (area well below full-size analytical bound)", async () => {
    const createSpy = jest.spyOn(Matter.Engine, "create");
    const handle = await buildEngine();
    const engineInstance = createSpy.mock.results[0]?.value as Matter.Engine;

    handle.drop(fruit(0), "fruits", W / 2 - 5, 30);
    handle.drop(fruit(0), "fruits", W / 2 + 5, 30);

    let mergeStep = -1;
    for (let i = 0; i < 300; i++) {
      const { events } = handle.step(1 / 60);
      if (events.some((e) => e.type === "fruitMerge")) {
        mergeStep = i;
        break;
      }
    }
    expect(mergeStep).toBeGreaterThanOrEqual(0);

    // After merge: the two tier-0 bodies are removed; the tier-1 warm body is the only survivor.
    // After 1 warm frame (applied in the merge step) the body is at 55% radius.
    // area(55% r) = (0.55)² × area(r) ≈ 0.3025 × full area — well under 50%.
    const dynBodies = Matter.Composite.allBodies(engineInstance.world).filter((b) => !b.isStatic);
    expect(dynBodies).toHaveLength(1);
    const tier1Body = dynBodies[0]!;

    // Analytical upper bound: 50% of the inscribed-circle area for tier-1 radius=23.
    // For both circle and polygon bodies, area scales as r², so this bound holds.
    const tier1Radius = fruit(1).radius; // 23
    const circleUpperBound = Math.PI * tier1Radius * tier1Radius * 0.5;
    expect(tier1Body.area).toBeLessThan(circleUpperBound);

    handle.cleanup();
  });

  it("warm body reaches ~100% radius after WARM_SPAWN_FRAMES total warm steps", async () => {
    const createSpy = jest.spyOn(Matter.Engine, "create");
    const handle = await buildEngine();
    const engineInstance = createSpy.mock.results[0]?.value as Matter.Engine;

    handle.drop(fruit(0), "fruits", W / 2 - 5, 30);
    handle.drop(fruit(0), "fruits", W / 2 + 5, 30);

    // Step until merge fires (the merge step also applies the first warm advancement)
    let merged = false;
    for (let i = 0; i < 300; i++) {
      const { events } = handle.step(1 / 60);
      if (events.some((e) => e.type === "fruitMerge")) {
        merged = true;
        break;
      }
    }
    expect(merged).toBe(true);

    // After merge: only the tier-1 warm body remains
    const getDyn = () =>
      Matter.Composite.allBodies(engineInstance.world).filter((b) => !b.isStatic);
    const tier1Body = getDyn()[0];
    expect(tier1Body).toBeDefined();
    const areaAfterMerge = tier1Body!.area;

    // Apply remaining WARM_SPAWN_FRAMES - 1 tiny steps to complete warm period.
    // Tiny dt (1e-9) skips physics but still runs processMerges + warm advancement.
    for (let i = 0; i < WARM_SPAWN_FRAMES - 1; i++) {
      handle.step(1e-9);
    }

    // After full warm: radius = targetRadius. Area grew from (0.55r)² to r².
    // Ratio = (1.0/0.55)² ≈ 3.31 — check it's in the [3.0, 4.0] range.
    const areaAfterWarm = tier1Body!.area;
    expect(areaAfterWarm / areaAfterMerge).toBeGreaterThan(3.0);
    expect(areaAfterWarm / areaAfterMerge).toBeLessThan(4.0);

    handle.cleanup();
  });

  it("mass-weighted velocity applied — equal-mass bodies: merged body gets average velocity", async () => {
    const createSpy = jest.spyOn(Matter.Engine, "create");
    const handle = await buildEngine();
    const engineInstance = createSpy.mock.results[0]?.value as Matter.Engine;

    // Drop far apart so they don't auto-merge
    handle.drop(fruit(0), "fruits", 80, 300);
    handle.drop(fruit(0), "fruits", 220, 300);
    handle.step(1 / 60); // register

    const dynBodies = Matter.Composite.allBodies(engineInstance.world).filter(
      (b) => !b.isStatic && b.parent === b
    );
    const [bodyA, bodyB] = dynBodies;
    if (!bodyA || !bodyB) throw new Error("Expected two fruit bodies");

    // Set opposing equal velocities — weighted average = (v + (-v)) / 2 = 0
    Matter.Body.setVelocity(bodyA, { x: 10, y: 0 });
    Matter.Body.setVelocity(bodyB, { x: -10, y: 0 });

    // Trigger merge programmatically
    const fakePair = { bodyA, bodyB, activeContacts: [], separation: 0, isActive: true };
    Matter.Events.trigger(engineInstance, "collisionStart", { pairs: [fakePair] });

    // Use tiny dt so physics doesn't run — only processMerges and warm advancement fire.
    // dt < 0.01ms → physics loop skips; only processMerges + warm advancement fire.
    handle.step(1e-9);

    // The spawned tier-1 body should have near-zero x velocity (average of +10 and -10)
    const spawnedBodies = Matter.Composite.allBodies(engineInstance.world).filter(
      (b) => !b.isStatic
    );
    // Two originals removed; one new body spawned
    expect(spawnedBodies).toHaveLength(1);
    const merged = spawnedBodies[0];
    if (merged) {
      expect(Math.abs(merged.velocity.x)).toBeLessThan(0.5);
    }

    handle.cleanup();
  });

  it("mass-weighted velocity applied — unequal masses: heavier body dominates velocity", async () => {
    const createSpy = jest.spyOn(Matter.Engine, "create");
    const handle = await buildEngine();
    const engineInstance = createSpy.mock.results[0]?.value as Matter.Engine;

    handle.drop(fruit(0), "fruits", 80, 300);
    handle.drop(fruit(0), "fruits", 220, 300);
    handle.step(1 / 60);

    const dynBodies = Matter.Composite.allBodies(engineInstance.world).filter(
      (b) => !b.isStatic && b.parent === b
    );
    const [bodyA, bodyB] = dynBodies;
    if (!bodyA || !bodyB) throw new Error("Expected two fruit bodies");

    // Triple bodyA's mass to make it dominant
    const originalMassA = bodyA.mass;
    Matter.Body.setMass(bodyA, originalMassA * 3);

    // bodyA moves right (+10), bodyB moves left (-10).
    // Weighted: (3m·10 + m·(-10)) / 4m = 20/4 = +5 → net rightward velocity
    Matter.Body.setVelocity(bodyA, { x: 10, y: 0 });
    Matter.Body.setVelocity(bodyB, { x: -10, y: 0 });

    const fakePair = { bodyA, bodyB, activeContacts: [], separation: 0, isActive: true };
    Matter.Events.trigger(engineInstance, "collisionStart", { pairs: [fakePair] });
    // dt < 0.01ms → physics loop skips; only processMerges + warm advancement fire.
    handle.step(1e-9);

    const spawnedBodies = Matter.Composite.allBodies(engineInstance.world).filter(
      (b) => !b.isStatic
    );
    expect(spawnedBodies).toHaveLength(1);
    const merged = spawnedBodies[0];
    if (merged) {
      // Heavier bodyA moving right should push merged velocity positive
      expect(merged.velocity.x).toBeGreaterThan(0);
    }

    handle.cleanup();
  });

  it("tier-10 merge produces no warm body (no spawn)", async () => {
    const handle = await buildEngine();
    const tier10 = fruit(10);
    let mergeEvents: { type: string }[] = [];

    handle.drop(tier10, "fruits", W / 2 - 5, 50);
    handle.drop(tier10, "fruits", W / 2 + 5, 50);

    for (let i = 0; i < 300; i++) {
      const { events } = handle.step(1 / 60);
      mergeEvents = [...mergeEvents, ...events.filter((e) => e.type === "fruitMerge")];
      if (mergeEvents.length > 0) break;
    }

    expect(mergeEvents.length).toBeGreaterThan(0);
    // No bodies remain (tier-10 produces no spawn, no warm body)
    const { snapshots } = handle.step(1 / 60);
    expect(snapshots).toHaveLength(0);

    handle.cleanup();
  });

  it("step() with 20+ bodies including warm bodies completes in <16ms", async () => {
    const handle = await buildEngine();

    // Pack 20 bodies across the bin
    for (let i = 0; i < 20; i++) {
      handle.drop(fruit(i % 5), "fruits", 50 + (i % 8) * 30, 50 + (i % 4) * 40);
    }
    // Settle for 60 ticks
    for (let i = 0; i < 60; i++) handle.step(1 / 60);

    // Trigger a merge to create a warm body
    handle.drop(fruit(0), "fruits", W / 2 - 4, 30);
    handle.drop(fruit(0), "fruits", W / 2 + 4, 30);
    for (let i = 0; i < 50; i++) handle.step(1 / 60);

    // Measure a single step that may include warm body advancement
    const start = Date.now();
    handle.step(1 / 60);
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(16);

    handle.cleanup();
  });
});
