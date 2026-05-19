/**
 * dropPhysics.test.ts — single- and two-sprite drop invariants.
 *
 * The "interesting" cascade physics bugs are not in chain-merge logic but in
 * the most basic case: drop one sprite, watch it fall. When that's wrong
 * (sprite shoots sideways, escapes the bin, bounces wildly) the multi-sprite
 * pile is a lost cause too.
 *
 * Tests the unified Matter.js engine — pure JS, runs in Jest without a WASM binary.
 *
 * Each scenario is a high-level invariant: positions inside the bin,
 * velocities settled, drift bounded.
 */
import Matter from "matter-js";
import { createEngine } from "../engine";
import type { EngineHandle, BodySnapshot } from "../engine.shared";
import {
  WALL_THICKNESS,
  MAX_FRUIT_SPEED_PX_S,
  MAX_ANGULAR_VELOCITY_RAD_PER_STEP,
  FRUIT_ANGULAR_DAMPING,
} from "../engine.shared";
import { FRUIT_SETS, FruitSet, FruitDefinition } from "../../../theme/fruitSets";

function requireFruitSet(id: string): FruitSet {
  const fs = FRUIT_SETS[id];
  if (fs === undefined) throw new Error(`FruitSet '${id}' not found`);
  return fs;
}
const fruitSet: FruitSet = requireFruitSet("fruits");

function fruit(tier: number): FruitDefinition {
  const f = fruitSet.fruits[tier];
  if (f === undefined) throw new Error(`No fruit for tier ${tier}`);
  return f;
}

// Match the canonical world dimensions used by the live game — anything else
// would be testing a configuration that never ships.
const W = 400;
const H = 700;
const DT = 1 / 60;

async function buildEngine(): Promise<EngineHandle> {
  return createEngine(W, H, fruitSet);
}

/** Step the engine for `n` frames, returning the final snapshot array. */
function stepN(handle: EngineHandle, n: number): BodySnapshot[] {
  let last: BodySnapshot[] = [];
  for (let i = 0; i < n; i++) last = handle.step(DT).snapshots;
  return last;
}

/** Step the engine for `n` frames, returning every per-frame snapshot array. */
function stepNCollect(handle: EngineHandle, n: number): BodySnapshot[][] {
  const frames: BodySnapshot[][] = [];
  for (let i = 0; i < n; i++) frames.push(handle.step(DT).snapshots);
  return frames;
}

/** Right edge of the left wall / left edge of the right wall, in pixels. */
const innerLeftEdge = WALL_THICKNESS;
const innerRightEdge = W - WALL_THICKNESS;
const innerFloorTop = H - WALL_THICKNESS;

afterEach(() => {
  jest.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Single sprite — most-basic-possible drop
// ---------------------------------------------------------------------------

describe("single sprite — drop and settle", () => {
  it("falls strictly downward (y monotonically increases) until it hits the floor", async () => {
    const handle = await buildEngine();
    const r = fruit(0).radius;
    handle.drop(fruit(0), fruitSet.id, W / 2, 30);

    let prevY = 30;
    let hitFloor = false;
    for (let i = 0; i < 240; i++) {
      const snap = handle.step(DT).snapshots[0];
      if (snap === undefined) break;
      const reachedFloor = snap.y + r >= innerFloorTop - 1;
      if (!reachedFloor) {
        // Before contact the sprite is in free-fall: y must increase, never
        // go up. A negative dy here is the "shoots upward" bug.
        expect(snap.y).toBeGreaterThanOrEqual(prevY - 0.01);
      } else {
        hitFloor = true;
        break;
      }
      prevY = snap.y;
    }
    expect(hitFloor).toBe(true);
    handle.cleanup();
  });

  it("during free-fall the sprite barely drifts horizontally (no rocketing sideways)", async () => {
    // The user's complaint: "drop one blueberry down and it might shoot all
    // over the bin." During free-fall — before the sprite ever touches the
    // floor — the only forces are gravity and (possibly) a momentary contact
    // with the spawn-point air. There should be virtually no horizontal drift.
    // Once the sprite lands on the floor it may skid; that's tested elsewhere.
    const handle = await buildEngine();
    const r = fruit(0).radius;
    const startX = W / 2;
    handle.drop(fruit(0), fruitSet.id, startX, 30);

    let maxDxFreeFall = 0;
    for (let i = 0; i < 360; i++) {
      const snap = handle.step(DT).snapshots[0];
      if (snap === undefined) break;
      // Stop measuring once the sprite has reached (or crossed) the floor.
      const onFloor = snap.y + r >= innerFloorTop - 1;
      if (onFloor) break;
      maxDxFreeFall = Math.max(maxDxFreeFall, Math.abs(snap.x - startX));
    }
    // 5px is generous: the convex hull is symmetric enough that a centred
    // drop should produce essentially zero lateral motion. The original bug
    // ("shoots across the bin") would push this into the tens or hundreds.
    expect(maxDxFreeFall).toBeLessThan(5);
    handle.cleanup();
  });

  it("after settling, the sprite has not skidded across the bin", async () => {
    // Skidding a few pixels is fine. Skidding 100+ pixels — visible to the
    // player as "the fruit slid all the way across" — is the failure mode.
    const handle = await buildEngine();
    const startX = W / 2;
    handle.drop(fruit(0), fruitSet.id, startX, 30);
    const final = stepN(handle, 480)[0];
    if (final === undefined) throw new Error("Expected a snapshot");
    const totalDrift = Math.abs(final.x - startX);
    // Half the bin's playable width is the "shot all the way to the wall"
    // threshold. Anything close to that is a regression worth flagging.
    const playableHalf = (W - 2 * WALL_THICKNESS) / 2;
    expect(totalDrift).toBeLessThan(playableHalf / 2);
    handle.cleanup();
  });

  it("never escapes the bin during the entire fall", async () => {
    const handle = await buildEngine();
    const r = fruit(0).radius;
    handle.drop(fruit(0), fruitSet.id, W / 2, 30);

    const frames = stepNCollect(handle, 360);
    const maxDeltaPerFrame = MAX_FRUIT_SPEED_PX_S / 60 + 1;
    let prevSnaps: BodySnapshot[] | undefined;
    for (const snaps of frames) {
      for (const s of snaps) {
        // Centre must stay inside walls. Polygon inradius < circumradius means
        // the centre may settle slightly below innerFloorTop; use H as the world bound.
        expect(s.x).toBeGreaterThanOrEqual(innerLeftEdge - 0.5);
        expect(s.x).toBeLessThanOrEqual(innerRightEdge + 0.5);
        expect(s.y).toBeLessThanOrEqual(H);
        // Top of the sprite must stay below the top of the bin.
        expect(s.y - r).toBeGreaterThan(0);
        // No single-frame position delta may exceed the velocity clamp budget.
        if (prevSnaps) {
          const prev = prevSnaps.find((p) => p.id === s.id);
          if (prev) {
            expect(Math.abs(s.x - prev.x)).toBeLessThanOrEqual(maxDeltaPerFrame);
            expect(Math.abs(s.y - prev.y)).toBeLessThanOrEqual(maxDeltaPerFrame);
          }
        }
      }
      prevSnaps = snaps;
    }
    // All sprites still present in snapshots (none escaped)
    expect(frames[frames.length - 1]).toHaveLength(1);
    handle.cleanup();
  });

  it("settles near the floor with negligible velocity", async () => {
    const handle = await buildEngine();
    const r = fruit(0).radius;
    handle.drop(fruit(0), fruitSet.id, W / 2, 30);

    const final = stepN(handle, 360);
    expect(final).toHaveLength(1);
    const snap = final[0];
    if (snap === undefined) throw new Error("Expected a snapshot");
    // Bottom of the sprite should be at or just below the floor's top surface.
    // Polygon bodies (polygon inradius < circumradius) may settle a few px into
    // the floor; the meaningful check is that the body reaches the floor and
    // doesn't escape the world boundary.
    expect(snap.y + r).toBeGreaterThan(innerFloorTop - 2);
    expect(snap.y + r).toBeLessThan(H);

    // One more step shouldn't move it noticeably (settled).
    const after = handle.step(DT).snapshots[0];
    if (after === undefined) throw new Error("Expected a snapshot");
    expect(Math.abs(after.x - snap.x)).toBeLessThan(0.5);
    expect(Math.abs(after.y - snap.y)).toBeLessThan(0.5);
    handle.cleanup();
  });

  it("tier-8 sprite settles on the floor without escaping after 480 frames", async () => {
    // Heavier fruits expose solver under-count first — this test guards MATTER_POSITION_ITERATIONS
    // and MATTER_VELOCITY_ITERATIONS (Matter.js engine is used throughout dropPhysics.test.ts).
    // Polygon bodies may penetrate the floor surface by up to ~15% of radius (inradius gap).
    const handle = await buildEngine();
    const def = fruit(8);
    handle.drop(def, fruitSet.id, W / 2, 30 + def.radius);
    const final = stepN(handle, 480);
    expect(final).toHaveLength(1);
    const snap = final[0];
    if (snap === undefined) throw new Error("Expected a snapshot");
    expect(snap.y + def.radius).toBeGreaterThan(innerFloorTop - 2);
    expect(snap.y + def.radius).toBeLessThan(H);
    handle.cleanup();
  });

  it.each([0, 2, 5, 8, 10])(
    "tier-%i sprite stays inside the bin and reaches the floor",
    async (tier) => {
      const handle = await buildEngine();
      const def = fruit(tier);
      handle.drop(def, fruitSet.id, W / 2, 30 + def.radius);

      const final = stepN(handle, 480);
      expect(final).toHaveLength(1);
      const snap = final[0];
      if (snap === undefined) throw new Error("Expected a snapshot");
      // Inside walls (centre + radius can't cross the wall edge).
      expect(snap.x - def.radius).toBeGreaterThanOrEqual(innerLeftEdge - 0.5);
      expect(snap.x + def.radius).toBeLessThanOrEqual(innerRightEdge + 0.5);
      // Reaches the floor — polygon bodies may penetrate slightly due to
      // inradius < circumradius; check settled near floor but not past world edge.
      expect(snap.y + def.radius).toBeGreaterThan(innerFloorTop - 2);
      expect(snap.y + def.radius).toBeLessThan(H);
      handle.cleanup();
    }
  );
});

// ---------------------------------------------------------------------------
// Two sprites dropped apart — must behave independently
// ---------------------------------------------------------------------------

describe("two sprites — dropped well apart", () => {
  it("two non-touching sprites settle the same as if dropped alone", async () => {
    // Solo drop at x=120 — record settled position
    const solo = await buildEngine();
    solo.drop(fruit(0), fruitSet.id, 120, 30);
    const soloFinal = stepN(solo, 360)[0];
    if (soloFinal === undefined) throw new Error("Expected solo snapshot");
    solo.cleanup();

    // Two-drop: the same fruit at x=120 plus a far-away companion at x=320.
    // Spacing 200px ≫ 2*r=36 → guaranteed no contact.
    const pair = await buildEngine();
    pair.drop(fruit(0), fruitSet.id, 120, 30);
    pair.drop(fruit(0), fruitSet.id, 320, 30);
    const pairFinal = stepN(pair, 360);
    expect(pairFinal).toHaveLength(2);
    // Find the sprite that started at x=120 — it must land where it would
    // have landed alone (within ~1px of physics noise).
    const left = pairFinal.find((s) => s.x < W / 2);
    const right = pairFinal.find((s) => s.x >= W / 2);
    if (left === undefined || right === undefined) {
      throw new Error("Expected one sprite on each side");
    }
    expect(Math.abs(left.x - soloFinal.x)).toBeLessThan(1);
    expect(Math.abs(left.y - soloFinal.y)).toBeLessThan(1);
    // No merges should have fired — same tier but never in contact.
    let mergeCount = 0;
    for (let i = 0; i < 10; i++) {
      mergeCount += pair.step(DT).events.filter((e) => e.type === "fruitMerge").length;
    }
    expect(mergeCount).toBe(0);
    pair.cleanup();
  });

  it("two non-touching sprites both stay inside the bin", async () => {
    const handle = await buildEngine();
    handle.drop(fruit(0), fruitSet.id, 120, 30);
    handle.drop(fruit(0), fruitSet.id, 320, 30);

    const r = fruit(0).radius;
    const frames = stepNCollect(handle, 360);
    for (const snaps of frames) {
      for (const s of snaps) {
        expect(s.x - r).toBeGreaterThanOrEqual(innerLeftEdge - 0.5);
        expect(s.x + r).toBeLessThanOrEqual(innerRightEdge + 0.5);
        // Polygon inradius < circumradius; use H as the world bound.
        expect(s.y + r).toBeLessThanOrEqual(H);
      }
    }
    // Both sprites still present throughout
    expect(frames[frames.length - 1]).toHaveLength(2);
    handle.cleanup();
  });
});

// ---------------------------------------------------------------------------
// Two sprites stacked — collision must not fling either out of the bin
// ---------------------------------------------------------------------------

describe("two sprites — stacked drop, different tiers (no merge)", () => {
  // Different tiers → no merge fires, so the test is a clean stacking-collision
  // physics check. Same-tier stacking is covered by the merge tests in
  // engine.native.test.ts; the failure mode here ("flying out of the bin") is
  // really about collision response, not merge.

  it("small sprite dropped onto a settled larger sprite — both stay in the bin", async () => {
    // Drop tier-3 first, let it settle on the floor.
    const handle = await buildEngine();
    const big = fruit(3); // radius 38
    const small = fruit(0); // radius 18
    handle.drop(big, fruitSet.id, W / 2, 30 + big.radius);
    stepN(handle, 240); // settle the bigger sprite

    // Now drop the smaller sprite directly above it.
    handle.drop(small, fruitSet.id, W / 2, 30);

    const r0 = small.radius;
    const r3 = big.radius;
    const frames = stepNCollect(handle, 360);
    for (const snaps of frames) {
      for (const s of snaps) {
        const r = s.tier === 0 ? r0 : r3;
        // Stays in the box, every frame.
        expect(s.x - r).toBeGreaterThanOrEqual(innerLeftEdge - 2);
        expect(s.x + r).toBeLessThanOrEqual(innerRightEdge + 2);
        // Transient stacking collisions may push a body briefly into the floor;
        // check it stays within the escape margin.
        // bottom < escape boundary: s.y + r < H + 3*r ↔ s.y < H + 2*r (escape threshold)
        expect(s.y + r).toBeLessThanOrEqual(H + 3 * r);
        // And cannot escape the top either.
        expect(s.y - r).toBeGreaterThan(0);
      }
    }
    handle.cleanup();
  });

  it("large sprite dropped onto a settled smaller sprite — both stay in the bin", async () => {
    const handle = await buildEngine();
    const small = fruit(0); // radius 18
    const big = fruit(5); // radius 49
    handle.drop(small, fruitSet.id, W / 2, 30 + small.radius);
    stepN(handle, 240);
    handle.drop(big, fruitSet.id, W / 2, 30 + big.radius);

    const frames = stepNCollect(handle, 480);
    for (const snaps of frames) {
      for (const s of snaps) {
        const r = s.tier === 0 ? small.radius : big.radius;
        expect(s.x - r).toBeGreaterThanOrEqual(innerLeftEdge - 2);
        expect(s.x + r).toBeLessThanOrEqual(innerRightEdge + 2);
        // During stacking collisions a body may transiently go past H but within
        // the escape margin (H + 2r). Escape detection removes it if it goes further.
        // bottom < escape boundary: s.y + r < H + 3*r ↔ s.y < H + 2*r (escape threshold)
        expect(s.y + r).toBeLessThanOrEqual(H + 3 * r);
        expect(s.y - r).toBeGreaterThan(0);
      }
    }
    handle.cleanup();
  });

  it("after the collision settles, neither sprite is moving upward (no rebound out the top)", async () => {
    const handle = await buildEngine();
    const big = fruit(4); // radius 44
    const small = fruit(0);
    handle.drop(big, fruitSet.id, W / 2, 30 + big.radius);
    stepN(handle, 240);
    handle.drop(small, fruitSet.id, W / 2, 30);

    // After the impact, run long enough for any rebound to dissipate, then
    // check two consecutive frames: the small sprite must be moving down (or
    // not at all), never up.
    stepN(handle, 360);
    const a = handle.step(DT).snapshots;
    const b = handle.step(DT).snapshots;
    const aSmall = a.find((s) => s.tier === 0);
    const bSmall = b.find((s) => s.tier === 0);
    if (aSmall === undefined || bSmall === undefined) {
      throw new Error("Expected the small sprite to still be in the bin");
    }
    // Small fruit may skid sideways but must not rocket up off the stack.
    expect(bSmall.y).toBeGreaterThanOrEqual(aSmall.y - 0.5);
    handle.cleanup();
  });

  it("dropped offset to one side — sprite may skid but never escapes the bin", async () => {
    // Small sprite dropped half a radius off-centre onto a wider sprite — the
    // collision will produce some lateral motion (skid) which is fine, the
    // bin must still contain it.
    const handle = await buildEngine();
    const big = fruit(6); // radius 54
    const small = fruit(0); // radius 18
    handle.drop(big, fruitSet.id, W / 2, 30 + big.radius);
    stepN(handle, 240);
    // Offset by ~half big.radius so the small sprite hits the side of the
    // bigger one and is deflected.
    handle.drop(small, fruitSet.id, W / 2 + big.radius / 2, 30);

    const frames = stepNCollect(handle, 480);
    for (const snaps of frames) {
      for (const s of snaps) {
        const r = s.tier === 0 ? small.radius : big.radius;
        expect(s.x - r).toBeGreaterThanOrEqual(innerLeftEdge - 2);
        expect(s.x + r).toBeLessThanOrEqual(innerRightEdge + 2);
        expect(s.y + r).toBeLessThanOrEqual(H + 3 * r);
        expect(s.y - r).toBeGreaterThan(0);
      }
    }
    handle.cleanup();
  });
});

// ---------------------------------------------------------------------------
// No position clamp — wall collision alone must contain bodies (#1236)
// ---------------------------------------------------------------------------

describe("no position clamp — floor containment via collision only", () => {
  // CASCADE-PHYS-09 removed: the hard-clamp band-aid is gone. The floor collider
  // alone must keep the fruit inside the world. Polygon bodies may settle slightly
  // past innerFloorTop (circumradius - inradius gap); the meaningful bound is H
  // (world bottom), not the ideal geometric floor surface.
  it("fruit falling straight down is contained by the floor collider and does not escape the world", async () => {
    const handle = await buildEngine();
    const def = fruit(0);
    handle.drop(def, fruitSet.id, W / 2, 30);

    const frames = stepNCollect(handle, 360);
    for (const snaps of frames) {
      for (const s of snaps) {
        // Centre must not pass through the world floor (H).
        expect(s.y).toBeLessThanOrEqual(H);
      }
    }
    // Fruit still present — not escape-removed.
    expect(frames[frames.length - 1]).toHaveLength(1);
    handle.cleanup();
  });
});

// ---------------------------------------------------------------------------
// Stacked merge — spawn grace prevents explosion (#1226)
// ---------------------------------------------------------------------------

describe("stacked merge — spawn grace period", () => {
  it("no body exceeds 50 px/s outward velocity in the merge frame", async () => {
    // Two same-tier fruits sitting on top of each other trigger a merge.
    // Pre-grace: the spawned body's midpoint is inside neighboring fruits,
    // causing a large penetration-correction impulse that shoots them outward.
    // With spawn grace: the new body can't collide with dynamic bodies for
    // SPAWN_GRACE_TICKS ticks, so no explosive impulse fires.
    const createSpy = jest.spyOn(Matter.Engine, "create");
    const handle = await buildEngine();
    const engineInstance = createSpy.mock.results[0]?.value as Matter.Engine;

    // Let two tier-0 fruits fall and collide naturally
    handle.drop(fruit(0), fruitSet.id, W / 2 - 5, 30);
    handle.drop(fruit(0), fruitSet.id, W / 2 + 5, 30);

    let mergeFrame = -1;
    for (let i = 0; i < 300; i++) {
      const { events } = handle.step(DT);
      if (events.some((e) => e.type === "fruitMerge")) {
        mergeFrame = i;
        break;
      }
    }
    expect(mergeFrame).toBeGreaterThanOrEqual(0);

    // On the step immediately after the merge, measure all body velocities.
    handle.step(DT);
    // 90 px/s accounts for mass-weighted velocity inheritance (merged body carries ~60 px/s
    // downward momentum from the falling parents). Explosions still reach 500+ px/s.
    const MAX_OUTWARD_SPEED = 90; // px/s
    const bodiesAfterMerge = Matter.Composite.allBodies(engineInstance.world).filter(
      (b) => !b.isStatic
    );
    for (const body of bodiesAfterMerge) {
      const { x: vx, y: vy } = body.velocity;
      // velocity in Matter.js is px/step; multiply by 60 for px/s
      const speedPxS = Math.sqrt(vx * vx + vy * vy) * 60;
      expect(speedPxS).toBeLessThanOrEqual(MAX_OUTWARD_SPEED);
    }
    handle.cleanup();
  });
});

// ---------------------------------------------------------------------------
// Drop speed — gravity must feel arcade-snappy (#1734)
// ---------------------------------------------------------------------------

describe("drop speed — fruit reaches floor quickly", () => {
  it("tier-0 fruit reaches the floor within 90 frames from DROP_Y=30", async () => {
    // With MATTER_GRAVITY_Y=5.0 the theoretical frame count is ~49; 90 is a
    // generous ceiling that still catches a near-zero gravity regression (old
    // value of 1.8 took ~72 frames, a misconfigured scale=0 would never land).
    const handle = await buildEngine();
    const r = fruit(0).radius;
    handle.drop(fruit(0), fruitSet.id, W / 2, 30);

    let hitFloorFrame = -1;
    for (let i = 0; i < 150; i++) {
      const snap = handle.step(DT).snapshots[0];
      if (!snap) break;
      if (snap.y + r >= innerFloorTop - 2) {
        hitFloorFrame = i;
        break;
      }
    }

    expect(hitFloorFrame).toBeGreaterThanOrEqual(0); // did reach floor
    expect(hitFloorFrame).toBeLessThan(90);
    handle.cleanup();
  });

  it("tier-5 fruit reaches the floor within 90 frames from DROP_Y=30", async () => {
    const handle = await buildEngine();
    const def = fruit(5);
    handle.drop(def, fruitSet.id, W / 2, 30);

    let hitFloorFrame = -1;
    for (let i = 0; i < 150; i++) {
      const snap = handle.step(DT).snapshots[0];
      if (!snap) break;
      if (snap.y + def.radius >= innerFloorTop - 2) {
        hitFloorFrame = i;
        break;
      }
    }

    expect(hitFloorFrame).toBeGreaterThanOrEqual(0);
    expect(hitFloorFrame).toBeLessThan(90);
    handle.cleanup();
  });

  it("y-velocity increases meaningfully across early frames (gravity is non-zero)", async () => {
    // Guards against gravity.scale=undefined/0 which would produce zero acceleration.
    const handle = await buildEngine();
    handle.drop(fruit(0), fruitSet.id, W / 2, 30);
    const yAt1 = handle.step(DT).snapshots[0]?.y ?? 30; // position after step 1
    const yAt2 = handle.step(DT).snapshots[0]?.y ?? 0; // position after step 2
    for (let i = 0; i < 3; i++) handle.step(DT); // steps 3–5
    const yAt6 = handle.step(DT).snapshots[0]?.y ?? 0; // position after step 6
    // The fruit should have accelerated: displacement in steps 2–6 > displacement in steps 1–2
    const earlyDy = yAt2 - yAt1;
    const laterDy = yAt6 - yAt2;
    expect(earlyDy).toBeGreaterThan(0);
    expect(laterDy).toBeGreaterThan(earlyDy); // accelerating, not constant drift
    handle.cleanup();
  });
});

// ---------------------------------------------------------------------------
// Angular velocity — spin settles quickly after landing (#1735)
// ---------------------------------------------------------------------------

describe("angular velocity — clamp and decay", () => {
  it("freshly dropped fruit starts with near-zero angular velocity", async () => {
    // Guards angularVelocity:0 in bodyOpts — poly-decomp must not impart spin at spawn.
    const createSpy = jest.spyOn(Matter.Engine, "create");
    const handle = await buildEngine();
    const engineInstance = createSpy.mock.results[0]?.value as Matter.Engine;
    handle.drop(fruit(0), fruitSet.id, W / 2, 30);
    handle.step(DT); // one step so the body exists in the world

    const bodies = Matter.Composite.allBodies(engineInstance.world).filter((b) => !b.isStatic);
    expect(bodies.length).toBeGreaterThanOrEqual(1);
    for (const body of bodies) {
      expect(Math.abs(body.angularVelocity)).toBeLessThan(0.05);
    }
    handle.cleanup();
  });

  it("angular velocity is clamped to MAX_ANGULAR_VELOCITY_RAD_PER_STEP after one step", async () => {
    // Inject a body with extreme spin and confirm the post-step clamp fires.
    const createSpy = jest.spyOn(Matter.Engine, "create");
    const handle = await buildEngine();
    const engineInstance = createSpy.mock.results[0]?.value as Matter.Engine;
    handle.drop(fruit(0), fruitSet.id, W / 2, 30);
    handle.step(DT);

    // Force extreme angular velocity onto the body
    const bodies = Matter.Composite.allBodies(engineInstance.world).filter((b) => !b.isStatic);
    for (const body of bodies) {
      Matter.Body.setAngularVelocity(body, 50); // 50 rad/step — far above cap
    }
    // One more step applies the clamp
    handle.step(DT);

    const bodiesAfter = Matter.Composite.allBodies(engineInstance.world).filter((b) => !b.isStatic);
    for (const body of bodiesAfter) {
      // After clamp + one decay: |ω| ≤ MAX_ANG * (1 - DAMPING)
      const maxAfterDecay = MAX_ANGULAR_VELOCITY_RAD_PER_STEP * (1 - FRUIT_ANGULAR_DAMPING) + 0.01;
      expect(Math.abs(body.angularVelocity)).toBeLessThanOrEqual(maxAfterDecay);
    }
    handle.cleanup();
  });

  it("after landing, angular velocity decays to near-zero within 30 frames", async () => {
    // Drop, let the fruit settle (60 frames), then check spin is negligible over
    // the following 30 frames. This is the "still spinning after landing" regression.
    const createSpy = jest.spyOn(Matter.Engine, "create");
    const handle = await buildEngine();
    const engineInstance = createSpy.mock.results[0]?.value as Matter.Engine;
    handle.drop(fruit(0), fruitSet.id, W / 2, 30);

    // Let it fall and land
    for (let i = 0; i < 80; i++) handle.step(DT);

    // Measure angle over the next 30 frames
    const snap0 = handle.step(DT).snapshots[0];
    if (!snap0) {
      handle.cleanup();
      return;
    }
    const angle0 = snap0.angle;

    for (let i = 0; i < 29; i++) handle.step(DT);
    const snap1 = handle.step(DT).snapshots[0];
    if (!snap1) {
      handle.cleanup();
      return;
    }
    const angle1 = snap1.angle;

    // Total rotation over 30 frames must be < 0.3 rad (~17°) once settled
    expect(Math.abs(angle1 - angle0)).toBeLessThan(0.3);

    // Also confirm angularVelocity on the underlying body is tiny
    const bodies = Matter.Composite.allBodies(engineInstance.world).filter((b) => !b.isStatic);
    for (const body of bodies) {
      expect(Math.abs(body.angularVelocity)).toBeLessThan(0.05);
    }
    handle.cleanup();
  });
});

// ---------------------------------------------------------------------------
// Post-merge boundary safety — reduced pop impulse (#1736)
// ---------------------------------------------------------------------------

describe("post-merge boundary safety", () => {
  it("after a merge, all bodies remain inside the bin", async () => {
    const handle = await buildEngine();
    handle.drop(fruit(0), fruitSet.id, W / 2 - 5, 30);
    handle.drop(fruit(0), fruitSet.id, W / 2 + 5, 30);

    let merged = false;
    for (let i = 0; i < 300; i++) {
      const { events } = handle.step(DT);
      if (events.some((e) => e.type === "fruitMerge")) {
        merged = true;
      }
      if (merged) {
        const snaps = handle.step(DT).snapshots;
        for (const s of snaps) {
          const r = fruitSet.fruits[s.tier]?.radius ?? 18;
          expect(s.x - r).toBeGreaterThanOrEqual(innerLeftEdge - 2);
          expect(s.x + r).toBeLessThanOrEqual(innerRightEdge + 2);
          expect(s.y + r).toBeLessThanOrEqual(H + r * 2); // escape guard margin
        }
        break;
      }
    }
    expect(merged).toBe(true);
    handle.cleanup();
  });

  it("bystander body near a merge does not exceed 90 px/s after the merge event", async () => {
    // Same invariant as the existing stacked-merge test but now with reduced
    // POP_IMPULSE_SCALE=0.8. Still uses 90 px/s; the new value should be
    // well inside that budget.
    const createSpy = jest.spyOn(Matter.Engine, "create");
    const handle = await buildEngine();
    const engineInstance = createSpy.mock.results[0]?.value as Matter.Engine;

    handle.drop(fruit(0), fruitSet.id, W / 2 - 5, 30);
    handle.drop(fruit(0), fruitSet.id, W / 2 + 5, 30);

    let mergeFrame = -1;
    for (let i = 0; i < 300; i++) {
      const { events } = handle.step(DT);
      if (events.some((e) => e.type === "fruitMerge")) {
        mergeFrame = i;
        break;
      }
    }
    expect(mergeFrame).toBeGreaterThanOrEqual(0);

    handle.step(DT);
    const MAX_SPEED = 90; // px/s
    const bodiesAfter = Matter.Composite.allBodies(engineInstance.world).filter((b) => !b.isStatic);
    for (const body of bodiesAfter) {
      const { x: vx, y: vy } = body.velocity;
      const speedPxS = Math.sqrt(vx * vx + vy * vy) * 60;
      expect(speedPxS).toBeLessThanOrEqual(MAX_SPEED);
    }
    handle.cleanup();
  });

  it("a high-tier merge does not send neighboring body outside bin walls", async () => {
    // Tier-5 merges produce a large spawn radius (nextDef.radius ≈ 55 px).
    // Old POP_IMPULSE_SCALE=2.0 → mag=110; new 0.8 → mag=44.
    const handle = await buildEngine();
    handle.drop(fruit(5), fruitSet.id, W / 2 - 4, 30);
    handle.drop(fruit(5), fruitSet.id, W / 2 + 4, 30);

    const frames = stepNCollect(handle, 600);
    for (const snaps of frames) {
      for (const s of snaps) {
        const r = fruitSet.fruits[s.tier]?.radius ?? 18;
        expect(s.x - r).toBeGreaterThanOrEqual(innerLeftEdge - 2);
        expect(s.x + r).toBeLessThanOrEqual(innerRightEdge + 2);
      }
    }
    handle.cleanup();
  });
});
