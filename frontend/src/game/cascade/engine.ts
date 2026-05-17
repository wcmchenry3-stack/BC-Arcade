import Matter from "matter-js";
import { FruitDefinition, FruitSet, FruitTier } from "../../theme/fruitSets.engine";
import { getVerticesForFruit } from "./fruitVertices";

// Re-export shared types and constants so imports from './engine' keep working on all platforms
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
  FRUIT_ANGULAR_DAMPING,
  FRUIT_FRICTION_AIR,
  WALL_FRICTION,
  POP_IMPULSE_SCALE,
  FRUIT_DENSITY,
  MATTER_GRAVITY_Y,
  FIXED_STEP_MS,
  MATTER_POSITION_ITERATIONS,
  MATTER_VELOCITY_ITERATIONS,
  MATTER_SLEEP_THRESHOLD,
  MAX_FRUIT_SPEED_PX_S,
  SPAWN_GRACE_TICKS,
  SPAWN_GRACE_MS,
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
export type { GameEvent } from "./types";

import {
  WALL_THICKNESS,
  DANGER_LINE_RATIO,
  GAME_OVER_GRACE_MS,
  GAME_OVER_CONSECUTIVE_TICKS,
  GAME_OVER_MERGE_COOLDOWN_TICKS,
  FRUIT_RESTITUTION,
  FRUIT_FRICTION,
  FRUIT_ANGULAR_DAMPING,
  FRUIT_FRICTION_AIR,
  WALL_FRICTION,
  POP_IMPULSE_SCALE,
  MATTER_GRAVITY_Y,
  FIXED_STEP_MS,
  MATTER_POSITION_ITERATIONS,
  MATTER_VELOCITY_ITERATIONS,
  MATTER_SLEEP_THRESHOLD,
  MAX_FRUIT_SPEED_PX_S,
  SPAWN_GRACE_MS,
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

export async function createEngine(
  W: number,
  H: number,
  fruitSet: FruitSet,
  nowProvider: () => number = () => Date.now()
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
    friction: WALL_FRICTION,
  });
  const leftWall = Matter.Bodies.rectangle(WALL_THICKNESS / 2, H / 2, WALL_THICKNESS, H, {
    isStatic: true,
    friction: WALL_FRICTION,
  });
  const rightWall = Matter.Bodies.rectangle(W - WALL_THICKNESS / 2, H / 2, WALL_THICKNESS, H, {
    isStatic: true,
    friction: WALL_FRICTION,
  });
  Matter.Composite.add(world, [floor, leftWall, rightWall]);

  const dangerY = H * DANGER_LINE_RATIO;
  let gameOverFired = false;
  let dangerTicksAbove = 0;
  let ticksSinceLastMerge = GAME_OVER_MERGE_COOLDOWN_TICKS;

  // mergeQueue carries [idA, idB, snapshotTier] — tier is snapshotted at enqueue time
  // so processMerges can re-verify it (guards against body ID reuse after removal).
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
  ): { fb: FruitBody; body: Matter.Body } {
    const nameKey = (def as { nameKey?: string }).nameKey ?? def.name.toLowerCase();
    const verts = getVerticesForFruit(setId, nameKey);

    let body: Matter.Body;
    const bodyOpts = {
      restitution: FRUIT_RESTITUTION,
      friction: FRUIT_FRICTION,
      frictionAir: FRUIT_FRICTION_AIR,
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
      createdAt: nowProvider(),
      fruitRadius: def.radius,
      collisionVerts: verts,
      graceTicksRemaining: graceTicks,
    };
    fruitMap.set(body.id, fb);
    return { fb, body };
  }

  function removeBody(bodyId: number, bodyRef?: Matter.Body): void {
    const body = bodyRef ?? Matter.Composite.allBodies(world).find((b) => b.id === bodyId);
    if (body) {
      Matter.Composite.remove(world, body);
    }
    fruitMap.delete(bodyId);
  }

  // processMerges receives the per-step bodyById map (built once in step()) so it
  // never calls allBodies() itself.  It keeps the map in sync as it removes merged
  // bodies and inserts the newly spawned result body.
  function processMerges(
    events: GameEvent[],
    bodyById: Map<number, Matter.Body>,
    stepMs: number
  ): void {
    for (const [idA, idB, enqueuedTier] of mergeQueue) {
      const fa = fruitMap.get(idA);
      const fb = fruitMap.get(idB);
      // isMerging is guaranteed true for all queued entries (set atomically at enqueue).
      // The !fa/!fb guard catches the edge case where a body was already removed.
      if (!fa || !fb) continue;
      // Re-verify tiers against the snapshot taken at enqueue time.
      // Body IDs can be reused after removal; without this check a newly spawned body
      // with the same ID could trigger a phantom cross-tier merge.
      if (fa.fruitTier !== enqueuedTier || fb.fruitTier !== enqueuedTier) continue;

      const tier = enqueuedTier;
      const bodyA = bodyById.get(idA);
      const bodyB = bodyById.get(idB);
      if (!bodyA || !bodyB) continue;

      const midX = (bodyA.position.x + bodyB.position.x) / 2;
      const midY = (bodyA.position.y + bodyB.position.y) / 2;

      bodyById.delete(idA);
      bodyById.delete(idB);
      removeBody(idA, bodyA);
      removeBody(idB, bodyB);
      events.push({ type: "fruitMerge", tier, x: midX, y: midY });

      if (tier < 10) {
        const nextDef = fruitSet.fruits[(tier + 1) as FruitTier];
        if (nextDef !== undefined) {
          // Clamp spawn to valid physics bounds so the merged body never starts inside a wall.
          // MAX_FRUIT_SPEED_PX_S=900 px/s → max travel per 1/60 sub-step = 15 px < WALL_THICKNESS (16 px),
          // so sub-stepping alone is geometrically sufficient against tunneling.
          const innerLeft = WALL_THICKNESS + nextDef.radius;
          const innerRight = W - WALL_THICKNESS - nextDef.radius;
          const spawnX = Math.max(innerLeft, Math.min(innerRight, midX));
          const spawnY = Math.max(
            nextDef.radius,
            Math.min(H - WALL_THICKNESS - nextDef.radius, midY)
          );
          // Express grace as wall-clock ms → ticks at actual step rate so 120 Hz ProMotion
          // devices get the same wall-clock protection as 60 Hz.
          //   60 Hz: ceil(50 / 16.67) = 3 ticks × 16.67 ms = 50 ms
          //   120 Hz: ceil(50 / 8.33)  = 6 ticks × 8.33 ms  = 50 ms
          const graceTicks = Math.ceil(SPAWN_GRACE_MS / stepMs);
          const { fb: newFb, body: newBody } = spawnAt(
            nextDef,
            fruitSet.id,
            spawnX,
            spawnY,
            graceTicks
          );
          bodyById.set(newFb.handle, newBody);

          // Wake neighbors within 2× spawn radius and apply radial pop impulse to push
          // them out of the merge zone, preventing stuck overlaps after spawn.
          const wakeRadiusSq = (nextDef.radius * 2) ** 2;
          const mag = nextDef.radius * POP_IMPULSE_SCALE;
          fruitMap.forEach((_fb2, neighborId) => {
            if (neighborId === newFb.handle) return;
            const b = bodyById.get(neighborId);
            if (!b) return;
            const dx = b.position.x - midX;
            const dy = b.position.y - midY;
            const distSq = dx * dx + dy * dy;
            if (distSq < wakeRadiusSq) {
              const dist = Math.sqrt(distSq);
              if (dist > 0) {
                Matter.Body.applyForce(b, b.position, {
                  x: (dx / dist) * mag,
                  y: (dy / dist) * mag,
                });
              }
              Matter.Sleeping.set(b, false);
            }
          });
        }
      }
    }
    mergeQueue.length = 0;
  }

  return {
    step(dt?: number): { snapshots: BodySnapshot[]; events: GameEvent[] } {
      // Matter recommends physics steps ≤ 16.67ms; larger steps let
      // fast bodies tunnel through thin static walls. Break a large frame into
      // fixed sub-steps. Clamp total elapsed to 1/6 s so a backgrounded tab
      // can't schedule a hundred catch-up steps.
      const rawElapsed = dt ?? 1 / 60;
      let remainingMs = Math.min(rawElapsed, 1 / 6) * 1000;
      // Track the actual last sub-step duration so the velocity clamp threshold
      // is correct on 120 Hz ProMotion devices (8.33 ms/step) rather than always
      // using the nominal FIXED_STEP_MS (16.67 ms).
      let lastStepMs = FIXED_STEP_MS;
      while (remainingMs > 0.01) {
        lastStepMs = Math.min(remainingMs, FIXED_STEP_MS);
        Matter.Engine.update(engine, lastStepMs);
        remainingMs -= lastStepMs;
      }

      const events: GameEvent[] = [];
      const mergesThisStep = mergeQueue.length;

      // Build body map once per step for O(1) lookups. processMerges keeps the map
      // in sync as it removes and adds bodies, so grace-tick, velocity clamp,
      // game-over, and snapshot sections all reuse it without a second allBodies() call.
      const bodyById = new Map(Matter.Composite.allBodies(world).map((b) => [b.id, b]));
      processMerges(events, bodyById, lastStepMs);

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

      // Grace-tick decrement: restore normal collision filter when grace period expires.
      // bodyById reflects the post-merge body list (updated by processMerges).
      fruitMap.forEach((fb, bodyId) => {
        if (fb.graceTicksRemaining <= 0) return;
        fb.graceTicksRemaining--;
        if (fb.graceTicksRemaining === 0) {
          const body = bodyById.get(bodyId);
          if (body) {
            body.collisionFilter.mask = COLLISION_GROUP_WALL | COLLISION_GROUP_DYNAMIC;
          }
        }
      });

      // Angular damping: Matter.js applies frictionAir to angular velocity, but at only
      // 1%/step that alone is insufficient for snappy spin-decay. This post-step pass
      // applies an additional FRUIT_ANGULAR_DAMPING fraction per tick so fruits stop
      // rotating naturally without tuning frictionAir to an unrealistic value.
      fruitMap.forEach((_fb, bodyId) => {
        const body = bodyById.get(bodyId);
        if (!body || body.isSleeping || body.angularVelocity === 0) return;
        Matter.Body.setAngularVelocity(body, body.angularVelocity * (1 - FRUIT_ANGULAR_DAMPING));
      });

      // Velocity clamp: cap per-step speed so no body can tunnel through a 16px wall.
      // body.velocity in Matter.js is position change per step (px/step), so the threshold
      // must use the actual step duration (lastStepMs), not FIXED_STEP_MS. On 120 Hz
      // ProMotion devices lastStepMs = 8.33 ms; using FIXED_STEP_MS would double the limit.
      {
        const maxVelPerStep = (MAX_FRUIT_SPEED_PX_S * lastStepMs) / 1000;
        const maxVelSq = maxVelPerStep * maxVelPerStep;
        fruitMap.forEach((_fb, bodyId) => {
          const body = bodyById.get(bodyId);
          if (!body) return;
          const { x: vx, y: vy } = body.velocity;
          const speedSq = vx * vx + vy * vy;
          if (speedSq > maxVelSq) {
            const factor = maxVelPerStep / Math.sqrt(speedSq);
            Matter.Body.setVelocity(body, { x: vx * factor, y: vy * factor });
          }
        });
      }

      // Game-over: requires GAME_OVER_CONSECUTIVE_TICKS consecutive ticks above the danger line
      // AND no merge in the last GAME_OVER_MERGE_COOLDOWN_TICKS ticks.
      if (!gameOverFired) {
        const now = nowProvider();
        let anyAbove = false;
        fruitMap.forEach((fb, bodyId) => {
          if (anyAbove || fb.isMerging) return;
          if (now - fb.createdAt < GAME_OVER_GRACE_MS) return;
          const body = bodyById.get(bodyId);
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

      // Collect snapshots and detect boundary escapes (reuse bodyById — no second allBodies call).
      const snapshots: BodySnapshot[] = [];
      const escapedIds: number[] = [];
      fruitMap.forEach((fb, bodyId) => {
        const body = bodyById.get(bodyId);
        if (!body) return;
        const px = body.position.x;
        const py = body.position.y;

        const margin = fb.fruitRadius * 2;
        if (px < -margin || px > W + margin || py > H + margin) {
          escapedIds.push(bodyId);
          console.warn(`[Engine] boundary escape tier=${fb.fruitTier} x=${px} y=${py}`);
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
      for (const id of escapedIds) {
        removeBody(id, bodyById.get(id));
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

/**
 * Convenience wrapper kept for backward compatibility with canvas components.
 * Prefer calling engineHandle.drop() directly.
 */
export function dropFruit(
  engineHandle: EngineHandle,
  def: FruitDefinition,
  fruitSetId: string,
  x: number,
  spawnY: number
): void {
  engineHandle.drop(def, fruitSetId, x, spawnY);
}
