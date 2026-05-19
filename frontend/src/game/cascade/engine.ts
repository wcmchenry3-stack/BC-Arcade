import Matter from "matter-js";
import * as Sentry from "@sentry/react-native";
import { FruitDefinition, FruitSet, FruitTier } from "../../theme/fruitSets.engine";
import { getVerticesForFruit } from "./fruitVertices";
import decomp from "poly-decomp";

// Re-export shared types and constants so imports from './engine' keep working on all platforms
export {
  WORLD_W,
  WORLD_H,
  WALL_THICKNESS,
  DANGER_LINE_RATIO,
  GAME_OVER_GRACE_MS,
  GAME_OVER_CONSECUTIVE_TICKS,
  GAME_OVER_MERGE_COOLDOWN_TICKS,
  GAME_OVER_VELOCITY_THRESHOLD,
  FRUIT_DENSITY_BY_TIER,
  FRUIT_RESTITUTION_BY_TIER,
  FRUIT_FRICTION,
  FRUIT_ANGULAR_DAMPING,
  FRUIT_FRICTION_AIR,
  WALL_FRICTION,
  POP_IMPULSE_SCALE,
  RESTITUTION_THRESHOLD,
  MATTER_GRAVITY_Y,
  FIXED_STEP_MS,
  MATTER_POSITION_ITERATIONS,
  MATTER_POSITION_ITERATIONS_MERGE,
  MATTER_VELOCITY_ITERATIONS,
  MATTER_SLEEP_THRESHOLD,
  MAX_FRUIT_SPEED_PX_S,
  SPAWN_GRACE_TICKS,
  SPAWN_GRACE_MS,
  WARM_SPAWN_FRAMES,
  WARM_SPAWN_START_SCALE,
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
  GAME_OVER_VELOCITY_THRESHOLD,
  FRUIT_DENSITY_BY_TIER,
  FRUIT_RESTITUTION_BY_TIER,
  FRUIT_FRICTION,
  FRUIT_ANGULAR_DAMPING,
  FRUIT_FRICTION_AIR,
  WALL_FRICTION,
  POP_IMPULSE_SCALE,
  RESTITUTION_THRESHOLD,
  MATTER_GRAVITY_Y,
  FIXED_STEP_MS,
  MATTER_POSITION_ITERATIONS,
  MATTER_POSITION_ITERATIONS_MERGE,
  MATTER_VELOCITY_ITERATIONS,
  MATTER_SLEEP_THRESHOLD,
  MAX_FRUIT_SPEED_PX_S,
  SPAWN_GRACE_MS,
  WARM_SPAWN_FRAMES,
  WARM_SPAWN_START_SCALE,
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
  nowProvider: () => number = () => Date.now(),
  random: () => number = Math.random,
  sampleRate: number = 0.1
): Promise<EngineHandle> {
  // Dedupe Sets — prevent per-frame Sentry spam; each key fires at most once per session.
  // All reset on cleanup() so a new session can observe the same anomaly again.
  const nanPositionDeduped = new Set<string>();
  const boundaryEscapeDeduped = new Set<string>();
  const explosiveEjectionDeduped = new Set<string>();
  // Dedup set for NaN/Inf merge-position Sentry warnings — one per tier per engine lifetime
  const nanSpawnDeduped = new Set<string>();
  // Dedup set for polygon decomp-failure Sentry warnings — one per (setId, nameKey) per engine lifetime
  const decompFailureDeduped = new Set<string>();

  // Guard (a): validate world dimensions at init — fires at most once since it's in init code.
  if (!isFinite(W) || !isFinite(H) || W <= 0 || H <= 0) {
    console.warn(`[Engine] invalid world dimensions W=${W} H=${H}`);
    if (random() < sampleRate) {
      Sentry.captureMessage(`cascade.engine: invalid world dimensions W=${W} H=${H}`, {
        level: "warning",
        tags: { subsystem: "cascade.engine", op: "engine.init" },
        extra: { W, H },
      });
    }
  }

  // setDecomp sets a global reference on Matter.Common — idempotent, safe to call per-instance
  Matter.Common.setDecomp(decomp);

  const engine = Matter.Engine.create({
    gravity: { x: 0, y: MATTER_GRAVITY_Y },
    enableSleeping: true,
  });
  // Matter defaults: positionIterations=6, velocityIterations=4.
  // Higher counts resolve penetration in 15-deep stacks cleanly.
  engine.positionIterations = MATTER_POSITION_ITERATIONS;
  engine.velocityIterations = MATTER_VELOCITY_ITERATIONS;
  // _restingThresh is a global singleton on Matter.Resolver (not per-engine).
  // Setting it here is intentionally process-wide — every createEngine call writes
  // the same constant, so there is no cross-instance divergence risk.
  (Matter.Resolver as unknown as Record<string, number>)._restingThresh = RESTITUTION_THRESHOLD;

  const world = engine.world;

  // body.id → FruitBody metadata
  const fruitMap = new Map<number, FruitBody>();

  // body.id → warm-spawn state: grows from 50% to 100% radius over WARM_SPAWN_FRAMES ticks
  const warmBodies = new Map<
    number,
    { framesLeft: number; targetRadius: number; currentRadius: number }
  >();

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
  // Counts sub-steps remaining that should use elevated position iterations after a merge.
  let mergePostFrames = 0;

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
    graceTicks = 0,
    radiusScale = 1.0
  ): { fb: FruitBody; body: Matter.Body } {
    const nameKey = (def as { nameKey?: string }).nameKey ?? def.name.toLowerCase();
    const verts = getVerticesForFruit(setId, nameKey);

    let body: Matter.Body;
    const bodyOpts = {
      restitution: FRUIT_RESTITUTION_BY_TIER[def.tier],
      friction: FRUIT_FRICTION,
      frictionAir: FRUIT_FRICTION_AIR,
      density: FRUIT_DENSITY_BY_TIER[def.tier],
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
        const decompKey = `decomp-${setId}-${nameKey}`;
        if (!decompFailureDeduped.has(decompKey)) {
          decompFailureDeduped.add(decompKey);
          if (random() < sampleRate) {
            Sentry.captureMessage(`cascade.engine: polygon decomp failed`, {
              level: "warning",
              tags: { subsystem: "cascade.engine", op: "spawn.decomp" },
              extra: { setId, nameKey, tier: def.tier },
            });
          }
        }
        body = Matter.Bodies.circle(x, y, def.radius, bodyOpts);
      }
    } else {
      body = Matter.Bodies.circle(x, y, def.radius, bodyOpts);
    }

    if (graceTicks > 0) {
      Matter.Body.setVelocity(body, { x: 0, y: 0 });
    }

    // Warm spawn: scale physics body down before entering the world to reduce ejection.
    // fruitRadius always stores the TARGET (full) radius for game-over / escape checks.
    if (radiusScale !== 1.0) {
      Matter.Body.scale(body, radiusScale, radiusScale);
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
    // warmBodies entry for this id (if any) is cleaned up one step later when the
    // warm-advancement loop detects bodyById.get(bodyId) === undefined. Harmless lag.
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

      // Read mass-weighted velocity BEFORE removing bodies.
      const mA = bodyA.mass;
      const mB = bodyB.mass;
      const totalMass = mA + mB;
      const mergedVx = (mA * bodyA.velocity.x + mB * bodyB.velocity.x) / totalMass;
      const mergedVy = (mA * bodyA.velocity.y + mB * bodyB.velocity.y) / totalMass;

      bodyById.delete(idA);
      bodyById.delete(idB);
      removeBody(idA, bodyA);
      removeBody(idB, bodyB);
      // fruitMerge fires at warm-spawn start (not at completion).
      events.push({ type: "fruitMerge", tier, x: midX, y: midY });
      mergePostFrames = 3;

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

          // Sentry guard: NaN/Inf position means the merge centroid was corrupted.
          // Fire once per tier per engine lifetime (dedup prevents per-frame spam).
          const nanKey = `nan-spawn-${tier}`;
          if ((!isFinite(spawnX) || !isFinite(spawnY)) && !nanSpawnDeduped.has(nanKey)) {
            nanSpawnDeduped.add(nanKey);
            Sentry.captureMessage(`cascade.engine: NaN/Inf merged-position tier=${tier}`, {
              level: "warning",
              tags: { subsystem: "cascade.engine", op: "merge.spawn" },
              extra: { tier, spawnX, spawnY, midX, midY },
            });
          }
          if (!isFinite(spawnX) || !isFinite(spawnY)) continue;

          // Express grace as wall-clock ms → ticks at actual step rate so 120 Hz ProMotion
          // devices get the same wall-clock protection as 60 Hz.
          //   60 Hz: ceil(50 / 16.67) = 3 ticks × 16.67 ms = 50 ms
          //   120 Hz: ceil(50 / 8.33)  = 6 ticks × 8.33 ms  = 50 ms
          const graceTicks = Math.ceil(SPAWN_GRACE_MS / stepMs);
          // Warm spawn at 50% radius — grows to 100% over WARM_SPAWN_FRAMES ticks,
          // preventing the explosive ejection that occurs when a full-radius body
          // suddenly overlaps with settled neighbors.
          const { fb: newFb, body: newBody } = spawnAt(
            nextDef,
            fruitSet.id,
            spawnX,
            spawnY,
            graceTicks,
            WARM_SPAWN_START_SCALE
          );

          // Apply mass-weighted velocity: (mA·vA + mB·vB) / (mA + mB)
          Matter.Body.setVelocity(newBody, { x: mergedVx, y: mergedVy });

          // Register for radius interpolation in step()
          warmBodies.set(newFb.handle, {
            framesLeft: WARM_SPAWN_FRAMES,
            targetRadius: nextDef.radius,
            currentRadius: nextDef.radius * WARM_SPAWN_START_SCALE,
          });

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
        engine.positionIterations =
          mergePostFrames > 0 ? MATTER_POSITION_ITERATIONS_MERGE : MATTER_POSITION_ITERATIONS;
        if (mergePostFrames > 0) mergePostFrames--;
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

      // Advance warm bodies: each tick the body scales from 50% toward 100% target radius.
      // Each frame adds (0.5 * targetRadius / WARM_SPAWN_FRAMES) to the current radius,
      // applied as an incremental Body.scale so mass/inertia stay consistent with geometry.
      warmBodies.forEach((state, bodyId) => {
        const body = bodyById.get(bodyId);
        if (!body) {
          warmBodies.delete(bodyId);
          return;
        }
        const radiusStep = (state.targetRadius * (1 - WARM_SPAWN_START_SCALE)) / WARM_SPAWN_FRAMES;
        const newRadius = state.currentRadius + radiusStep;
        const scaleFactor = newRadius / state.currentRadius;
        Matter.Body.scale(body, scaleFactor, scaleFactor);
        state.currentRadius = newRadius;
        state.framesLeft--;
        if (state.framesLeft === 0) {
          warmBodies.delete(bodyId);
        }
      });

      // Cascade combo and merge-cooldown tracking.
      // comboMergeCount only resets when the player drops a new fruit (see drop()).
      // Empty steps during grace periods must not clear the running total so that
      // multi-stage chains (where each spawned body has a 3-tick grace period)
      // can accumulate ≥ 3 merges and fire the cascadeCombo event.
      if (mergesThisStep > 0) {
        comboMergeCount += mergesThisStep;
        if (!comboFired && comboMergeCount >= COMBO_THRESHOLD) {
          events.push({ type: "cascadeCombo", count: comboMergeCount });
          comboFired = true;
        }
        ticksSinceLastMerge = 0;
      } else {
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
        // Guard (d): explosive ejection — speed > 4× NOMINAL cap signals a corrupted body; remove it.
        // Use FIXED_STEP_MS (nominal 60 Hz) so the threshold stays stable across variable
        // frame rates — lastStepMs can be tiny on catch-up frames, which would otherwise
        // spuriously eject legitimately-clamped bodies.
        const nominalVelPerStep = (MAX_FRUIT_SPEED_PX_S * FIXED_STEP_MS) / 1000; // 15 px/step at 60 Hz
        const explosionVelSq = (nominalVelPerStep * 4) ** 2; // 3600 (px/step)²
        fruitMap.forEach((fb, bodyId) => {
          const body = bodyById.get(bodyId);
          if (!body) return;
          const { x: vx, y: vy } = body.velocity;
          const speedSq = vx * vx + vy * vy;
          if (speedSq > explosionVelSq) {
            const speed = Math.sqrt(speedSq);
            const ejKey = `ejection-${fb.fruitTier}`;
            if (!explosiveEjectionDeduped.has(ejKey)) {
              explosiveEjectionDeduped.add(ejKey);
              if (random() < sampleRate) {
                Sentry.captureMessage(`cascade.engine: explosive ejection tier=${fb.fruitTier}`, {
                  level: "warning",
                  tags: { subsystem: "cascade.engine", op: "body.explosive-ejection" },
                  extra: { tier: fb.fruitTier, speed },
                });
              }
            }
            console.warn(
              `[Engine] explosive ejection tier=${fb.fruitTier} speed=${speed.toFixed(1)}`
            );
            removeBody(bodyId, body);
            bodyById.delete(bodyId);
            return;
          }
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
          const { x: vx, y: vy } = body.velocity;
          if (vx * vx + vy * vy > GAME_OVER_VELOCITY_THRESHOLD * GAME_OVER_VELOCITY_THRESHOLD)
            return;
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

        // Guard (b): NaN/Inf position post-step — remove corrupted body before snapshot
        if (!isFinite(px) || !isFinite(py)) {
          escapedIds.push(bodyId);
          const nanPosKey = `nan-pos-${fb.fruitTier}`;
          if (!nanPositionDeduped.has(nanPosKey)) {
            nanPositionDeduped.add(nanPosKey);
            if (random() < sampleRate) {
              Sentry.captureMessage(`cascade.engine: NaN/Inf position tier=${fb.fruitTier}`, {
                level: "warning",
                tags: { subsystem: "cascade.engine", op: "body.nan-position" },
                extra: { tier: fb.fruitTier, x: px, y: py },
              });
            }
          }
          console.warn(`[Engine] NaN/Inf position tier=${fb.fruitTier} x=${px} y=${py}`);
          return;
        }

        // Guard (c): boundary escape
        const margin = fb.fruitRadius * 2;
        if (px < -margin || px > W + margin || py > H + margin) {
          escapedIds.push(bodyId);
          const escKey = `escape-${fb.fruitTier}`;
          if (!boundaryEscapeDeduped.has(escKey)) {
            boundaryEscapeDeduped.add(escKey);
            if (random() < sampleRate) {
              Sentry.captureMessage(`cascade.engine: boundary escape tier=${fb.fruitTier}`, {
                level: "warning",
                tags: { subsystem: "cascade.engine", op: "body.boundary-escape" },
                extra: { tier: fb.fruitTier, x: px, y: py, W, H },
              });
            }
          }
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
      // Each player drop starts a fresh cascade window — reset so only merges
      // caused by THIS drop accumulate toward the cascadeCombo threshold.
      comboMergeCount = 0;
      comboFired = false;
      spawnAt(def, fruitSetId, x, y);
    },

    spawnRaw(def: FruitDefinition, fruitSetId: string, x: number, y: number): void {
      spawnAt(def, fruitSetId, x, y);
    },

    cleanup(): void {
      Matter.Events.off(engine, "collisionStart");
      Matter.World.clear(world, false);
      Matter.Engine.clear(engine);
      fruitMap.clear();
      warmBodies.clear();
      nanPositionDeduped.clear();
      boundaryEscapeDeduped.clear();
      explosiveEjectionDeduped.clear();
      nanSpawnDeduped.clear();
      decompFailureDeduped.clear();
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
