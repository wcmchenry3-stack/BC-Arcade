import Matter from "matter-js";
import { FruitDefinition, FruitSet, FruitTier } from "../../theme/fruitSets.engine";
import { getVerticesForFruit } from "./fruitVertices";

// Re-export shared types so imports from './engine' resolve correctly on native
export {
  WORLD_W,
  WORLD_H,
  WALL_THICKNESS,
  DANGER_LINE_RATIO,
  GAME_OVER_GRACE_MS,
  GAME_OVER_CONSECUTIVE_TICKS,
  GAME_OVER_MERGE_COOLDOWN_TICKS,
  FRUIT_RESTITUTION,
  FRUIT_FRICTION,
  FRUIT_DENSITY,
  SCALE,
  GRAVITY_Y,
  FIXED_STEP_MS,
  RAPIER_SOLVER_ITERATIONS, // re-exported for import-parity with engine.ts; not used by Matter.js
  MATTER_POSITION_ITERATIONS,
  MATTER_VELOCITY_ITERATIONS,
  MATTER_SLEEP_THRESHOLD,
  MAX_FRUIT_SPEED_PX_S,
  SPAWN_GRACE_TICKS,
  COLLISION_GROUP_WALL,
  COLLISION_GROUP_DYNAMIC,
} from "./engine.shared";
export type {
  FruitBody,
  BodySnapshot,
  MergeEvent,
  EngineHandle,
  EngineSetup,
} from "./engine.shared";

import {
  WALL_THICKNESS,
  DANGER_LINE_RATIO,
  GAME_OVER_GRACE_MS,
  GAME_OVER_CONSECUTIVE_TICKS,
  GAME_OVER_MERGE_COOLDOWN_TICKS,
  FRUIT_RESTITUTION,
  FRUIT_FRICTION,
  FIXED_STEP_MS,
  MATTER_POSITION_ITERATIONS,
  MATTER_VELOCITY_ITERATIONS,
  MATTER_SLEEP_THRESHOLD,
  MAX_FRUIT_SPEED_PX_S,
  SPAWN_GRACE_TICKS,
  COLLISION_GROUP_WALL,
  COLLISION_GROUP_DYNAMIC,
} from "./engine.shared";
import type { FruitBody, BodySnapshot, EngineHandle } from "./engine.shared";
import type { GameEvent } from "./types";

/** @deprecated Callbacks removed in #834 — events now returned from step(). Kept for type compat. */
export interface BoundaryEscapeEvent {
  tier: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

const COMBO_THRESHOLD = 3;

// matter.js gravity scale: Rapier uses GRAVITY_Y=14 with SCALE=0.01, i.e. 1400 px/s².
// matter.js default gravity.scale = 0.001 and gravity.y = 1 → effective ≈ 1 px/tick².
// We want ~1400 px/s² at 60fps (dt=16.67ms). matter.js applies gravity as:
//   force = body.mass * gravity.y * gravity.scale  (per tick)
// With default scale 0.001 and y=1.4, that gives us a punchy-but-controllable fall.
const MATTER_GRAVITY_Y = 1.4;

export async function createEngine(
  W: number,
  H: number,
  fruitSet: FruitSet
): Promise<EngineHandle> {
  const engine = Matter.Engine.create({
    gravity: { x: 0, y: MATTER_GRAVITY_Y },
    enableSleeping: true,
  });
  // Matter defaults: positionIterations=6, velocityIterations=4.
  // Higher counts resolve penetration in 15-deep stacks cleanly.
  engine.positionIterations = MATTER_POSITION_ITERATIONS;
  engine.velocityIterations = MATTER_VELOCITY_ITERATIONS;

  const world = engine.world;

  // body.id → FruitBody metadata
  const fruitMap = new Map<number, FruitBody>();

  // --- Static walls and floor ---
  const floor = Matter.Bodies.rectangle(W / 2, H - WALL_THICKNESS / 2, W, WALL_THICKNESS, {
    isStatic: true,
    friction: FRUIT_FRICTION,
  });
  const leftWall = Matter.Bodies.rectangle(WALL_THICKNESS / 2, H / 2, WALL_THICKNESS, H, {
    isStatic: true,
    friction: FRUIT_FRICTION,
  });
  const rightWall = Matter.Bodies.rectangle(W - WALL_THICKNESS / 2, H / 2, WALL_THICKNESS, H, {
    isStatic: true,
    friction: FRUIT_FRICTION,
  });
  Matter.Composite.add(world, [floor, leftWall, rightWall]);

  const dangerY = H * DANGER_LINE_RATIO;
  let gameOverFired = false;
  let dangerTicksAbove = 0;
  let ticksSinceLastMerge = GAME_OVER_MERGE_COOLDOWN_TICKS;

  // mergeQueue carries [idA, idB, snapshotTier] — tier is snapshotted at enqueue time
  // so processMerges can re-verify it (mirrors the Rapier engine's guard).
  const mergeQueue: Array<[number, number, number]> = [];
  let comboMergeCount = 0;
  let comboFired = false;

  // --- Collision handler ---
  // isMerging is set atomically when enqueueing so that a second collisionStart
  // for the same pair (fired during a later sub-step) is filtered out before
  // it can create a duplicate queue entry.
  Matter.Events.on(engine, "collisionStart", (event) => {
    for (const pair of event.pairs) {
      const fa = fruitMap.get(pair.bodyA.id);
      const fb = fruitMap.get(pair.bodyB.id);
      if (!fa || !fb || fa.isMerging || fb.isMerging) continue;
      // Skip merges during grace period — the body is immune to dynamic collisions.
      if (fa.graceTicksRemaining > 0 || fb.graceTicksRemaining > 0) continue;
      if (fa.fruitTier === fb.fruitTier) {
        fa.isMerging = true;
        fb.isMerging = true;
        mergeQueue.push([pair.bodyA.id, pair.bodyB.id, fa.fruitTier]);
      }
    }
  });

  function spawnAt(
    def: FruitDefinition,
    setId: string,
    x: number,
    y: number,
    graceTicks = 0
  ): FruitBody {
    const nameKey = (def as { nameKey?: string }).nameKey ?? def.name.toLowerCase();
    const verts = getVerticesForFruit(setId, nameKey);

    let body: Matter.Body;
    const bodyOpts = {
      restitution: FRUIT_RESTITUTION,
      friction: FRUIT_FRICTION,
      density: 0.001, // matter.js density is per-pixel-area; tuned for natural feel
      sleepThreshold: MATTER_SLEEP_THRESHOLD,
      collisionFilter: {
        category: COLLISION_GROUP_DYNAMIC,
        mask:
          graceTicks > 0 ? COLLISION_GROUP_WALL : COLLISION_GROUP_WALL | COLLISION_GROUP_DYNAMIC,
      },
    };

    if (verts && verts.length >= 3) {
      const matterVerts = verts.map((v) => ({
        x: v.x * def.radius,
        y: v.y * def.radius,
      }));
      const polyBody = Matter.Bodies.fromVertices(x, y, [matterVerts], bodyOpts);
      // fromVertices can return a body whose centre-of-mass differs from (x, y).
      // Force the position to the requested drop point so it matches the circle
      // fallback behaviour and the renderer's expectations.
      if (polyBody) {
        Matter.Body.setPosition(polyBody, { x, y });
        body = polyBody;
      } else {
        body = Matter.Bodies.circle(x, y, def.radius, bodyOpts);
      }
    } else {
      body = Matter.Bodies.circle(x, y, def.radius, bodyOpts);
    }

    if (graceTicks > 0) {
      Matter.Body.setVelocity(body, { x: 0, y: 0 });
    }

    Matter.Composite.add(world, body);

    const fb: FruitBody = {
      handle: body.id,
      fruitTier: def.tier,
      fruitSetId: setId,
      isMerging: false,
      createdAt: Date.now(),
      fruitRadius: def.radius,
      collisionVerts: verts,
      graceTicksRemaining: graceTicks,
    };
    fruitMap.set(body.id, fb);
    return fb;
  }

  function removeBody(bodyId: number): void {
    const bodies = Matter.Composite.allBodies(world);
    const body = bodies.find((b) => b.id === bodyId);
    if (body) {
      Matter.Composite.remove(world, body);
    }
    fruitMap.delete(bodyId);
  }

  function processMerges(events: GameEvent[]): void {
    for (const [idA, idB, enqueuedTier] of mergeQueue) {
      const fa = fruitMap.get(idA);
      const fb = fruitMap.get(idB);
      // isMerging is guaranteed true for all queued entries (set atomically at enqueue).
      // The !fa/!fb guard catches the edge case where a body was already removed.
      if (!fa || !fb) continue;
      // Re-verify tiers against the snapshot taken at enqueue time, mirroring
      // the Rapier engine's guard against handle-reuse phantom merges.
      if (fa.fruitTier !== enqueuedTier || fb.fruitTier !== enqueuedTier) continue;

      const tier = enqueuedTier;
      const bodies = Matter.Composite.allBodies(world);
      const bodyA = bodies.find((b) => b.id === idA);
      const bodyB = bodies.find((b) => b.id === idB);
      if (!bodyA || !bodyB) continue;

      const midX = (bodyA.position.x + bodyB.position.x) / 2;
      const midY = (bodyA.position.y + bodyB.position.y) / 2;

      removeBody(idA);
      removeBody(idB);
      events.push({ type: "fruitMerge", tier, x: midX, y: midY });

      if (tier < 10) {
        const nextDef = fruitSet.fruits[(tier + 1) as FruitTier];
        if (nextDef !== undefined) {
          // Clamp spawn to valid physics bounds so the merged body never starts inside a wall.
          // CASCADE-PHYS-08 analysis: Matter.js has no CCD for dynamic bodies.
          //   tier-0 radius=18 px, MAX_FRUIT_SPEED_PX_S=900 px/s → max travel per 1/60 sub-step = 15 px
          //   WALL_THICKNESS=16 px → 15 px < 16 px → sub-stepping alone is geometrically sufficient.
          // Outcome C chosen: MAX_FRUIT_SPEED_PX_S lowered 1200→900 to keep max travel below wall thickness.
          const innerLeft = WALL_THICKNESS + nextDef.radius;
          const innerRight = W - WALL_THICKNESS - nextDef.radius;
          const spawnX = Math.max(innerLeft, Math.min(innerRight, midX));
          const spawnY = Math.max(
            nextDef.radius,
            Math.min(H - WALL_THICKNESS - nextDef.radius, midY)
          );
          const newFb = spawnAt(nextDef, fruitSet.id, spawnX, spawnY, SPAWN_GRACE_TICKS);
          // Wake sleeping neighbors within 2× spawn radius so they react to the new body.
          const wakeRadiusSq = (nextDef.radius * 2) ** 2;
          for (const b of Matter.Composite.allBodies(world)) {
            if (b.isStatic || b.id === newFb.handle) continue;
            const dx = b.position.x - midX;
            const dy = b.position.y - midY;
            if (dx * dx + dy * dy < wakeRadiusSq) {
              Matter.Sleeping.set(b, false);
            }
          }
        }
      }
    }
    mergeQueue.length = 0;
  }

  return {
    step(dt?: number): { snapshots: BodySnapshot[]; events: GameEvent[] } {
      // Matter recommends physics steps ≤ 16.67ms; larger steps let
      // fast bodies tunnel through thin static walls (#499). Break a
      // large frame into fixed sub-steps. Clamp total elapsed to 1/6s
      // so a backgrounded tab can't schedule a hundred catch-up steps.
      const rawElapsed = dt ?? 1 / 60;
      let remainingMs = Math.min(rawElapsed, 1 / 6) * 1000;
      while (remainingMs > 0.01) {
        const stepMs = Math.min(remainingMs, FIXED_STEP_MS);
        Matter.Engine.update(engine, stepMs);
        remainingMs -= stepMs;
      }

      const events: GameEvent[] = [];
      const mergesThisStep = mergeQueue.length;
      processMerges(events);

      // Cascade combo and merge-cooldown tracking.
      if (mergesThisStep > 0) {
        comboMergeCount += mergesThisStep;
        if (!comboFired && comboMergeCount >= COMBO_THRESHOLD) {
          events.push({ type: "cascadeCombo", count: comboMergeCount });
          comboFired = true;
        }
        ticksSinceLastMerge = 0;
      } else {
        comboMergeCount = 0;
        comboFired = false;
        ticksSinceLastMerge++;
      }

      // Single allBodies snapshot shared by grace-tick, velocity-clamp, and wall-clamp below.
      // processMerges has already run, so this reflects the post-merge body list.
      const allBodiesPostMerge = Matter.Composite.allBodies(world);

      // Grace-tick decrement: restore normal collision filter when grace period expires.
      fruitMap.forEach((fb, bodyId) => {
        if (fb.graceTicksRemaining <= 0) return;
        fb.graceTicksRemaining--;
        if (fb.graceTicksRemaining === 0) {
          const body = allBodiesPostMerge.find((b) => b.id === bodyId);
          if (body) {
            body.collisionFilter.mask = COLLISION_GROUP_WALL | COLLISION_GROUP_DYNAMIC;
          }
        }
      });

      // Velocity clamp: cap per-step speed so no body can tunnel through a 16px wall.
      // Runs after the sub-step loop, before the wall-clamp band-aid (CASCADE-PHYS-09).
      // body.velocity in Matter.js is position change per step (px/step), so the threshold
      // is MAX_FRUIT_SPEED_PX_S × FIXED_STEP_MS/1000. On sub-60 Hz frames (dt < 1/60),
      // the last sub-step is shorter, body.velocity is proportionally smaller, and the
      // clamp threshold is never exceeded — this is safe because travel distance also shrinks.
      {
        const maxVelPerStep = (MAX_FRUIT_SPEED_PX_S * FIXED_STEP_MS) / 1000;
        const maxVelSq = maxVelPerStep * maxVelPerStep;
        fruitMap.forEach((_fb, bodyId) => {
          const body = allBodiesPostMerge.find((b) => b.id === bodyId);
          if (!body) return;
          const { x: vx, y: vy } = body.velocity;
          const speedSq = vx * vx + vy * vy;
          if (speedSq > maxVelSq) {
            const factor = maxVelPerStep / Math.sqrt(speedSq);
            Matter.Body.setVelocity(body, { x: vx * factor, y: vy * factor });
          }
        });
      }

      // Safety net: hard-clamp any body that drifted slightly outside the
      // left/right walls or below the floor and zero outward velocity so it
      // can't re-tunnel next frame. This catches the rare case where Matter.js
      // corrective impulses from polygon vertex decomposition push a body
      // through a thin static collider. Only applies within the escape margin
      // — bodies farther outside are left for the escape-detection pass below
      // to remove. See #699 for the floor case (19 events / 5 users).
      {
        fruitMap.forEach((fb, bodyId) => {
          const body = allBodiesPostMerge.find((b) => b.id === bodyId);
          if (!body) return;
          const innerLeft = WALL_THICKNESS + fb.fruitRadius;
          const innerRight = W - WALL_THICKNESS - fb.fruitRadius;
          const innerBottom = H - WALL_THICKNESS - fb.fruitRadius;
          const escapeMargin = fb.fruitRadius * 2;
          let px = body.position.x;
          let py = body.position.y;
          let vx = body.velocity.x;
          let vy = body.velocity.y;
          let clamped = false;
          if (px < innerLeft && px >= -escapeMargin) {
            px = innerLeft;
            vx = Math.max(0, vx);
            clamped = true;
          } else if (px > innerRight && px <= W + escapeMargin) {
            px = innerRight;
            vx = Math.min(0, vx);
            clamped = true;
          }
          if (py > innerBottom && py <= H + escapeMargin) {
            py = innerBottom;
            vy = Math.min(0, vy);
            clamped = true;
          }
          if (clamped) {
            Matter.Body.setPosition(body, { x: px, y: py });
            Matter.Body.setVelocity(body, { x: vx, y: vy });
          }
        });
      }

      // Game-over: requires GAME_OVER_CONSECUTIVE_TICKS consecutive ticks above the danger line
      // AND no merge in the last GAME_OVER_MERGE_COOLDOWN_TICKS ticks.
      if (!gameOverFired) {
        const now = Date.now();
        let anyAbove = false;
        fruitMap.forEach((fb, bodyId) => {
          if (anyAbove || fb.isMerging) return;
          if (now - fb.createdAt < GAME_OVER_GRACE_MS) return;
          const body = allBodiesPostMerge.find((b) => b.id === bodyId);
          if (!body) return;
          const topY = body.position.y - fb.fruitRadius;
          if (topY < dangerY) anyAbove = true;
        });
        if (anyAbove) dangerTicksAbove++;
        else dangerTicksAbove = 0;
        if (
          dangerTicksAbove >= GAME_OVER_CONSECUTIVE_TICKS &&
          ticksSinceLastMerge >= GAME_OVER_MERGE_COOLDOWN_TICKS
        ) {
          gameOverFired = true;
          events.push({ type: "gameOver" });
        }
      }

      // Collect snapshots and detect boundary escapes
      const snapshots: BodySnapshot[] = [];
      const escapedIds: number[] = [];
      const allBodies = Matter.Composite.allBodies(world);
      fruitMap.forEach((fb, bodyId) => {
        const body = allBodies.find((b) => b.id === bodyId);
        if (!body) return;
        const px = body.position.x;
        const py = body.position.y;

        // Detect bodies that have escaped the play area (with margin)
        const margin = fb.fruitRadius * 2;
        if (px < -margin || px > W + margin || py > H + margin) {
          escapedIds.push(bodyId);
          console.warn(`[Engine.native] boundary escape tier=${fb.fruitTier} x=${px} y=${py}`);
          return;
        }

        snapshots.push({
          id: bodyId,
          x: px,
          y: py,
          tier: fb.fruitTier,
          angle: body.angle,
          collisionVerts: fb.collisionVerts,
        });
      });
      // Clean up escaped bodies
      for (const id of escapedIds) {
        removeBody(id);
      }
      return { snapshots, events };
    },

    drop(def: FruitDefinition, fruitSetId: string, x: number, y: number): void {
      spawnAt(def, fruitSetId, x, y);
    },

    cleanup(): void {
      Matter.Events.off(engine, "collisionStart");
      Matter.World.clear(world, false);
      Matter.Engine.clear(engine);
      fruitMap.clear();
    },
  };
}

export function dropFruit(
  engineHandle: EngineHandle,
  def: FruitDefinition,
  fruitSetId: string,
  x: number,
  spawnY: number
): void {
  engineHandle.drop(def, fruitSetId, x, spawnY);
}
