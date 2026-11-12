/**
 * Cascade physics spike (#3696): a Matter.js backend for `CandidateEngine`.
 *
 * `CURRENT_MATTER` is the production engine's physics, number for number (`../../engine.ts`):
 * iterations 6 / 4, slop 0.05, restitution 0.2, density 1x for every tier, 20 px walls and
 * floor. `TUNED_MATTER` is candidate A. Matter's sleep threshold is a module global
 * (`Sleeping._motionSleepThreshold`); every backend sets the production value, so running a
 * candidate never changes the production engine's physics in the same process.
 */
import * as Matter from "matter-js";
import {
  WORLD_WIDTH,
  WORLD_HEIGHT,
  WALL_THICKNESS,
  FLOOR_THICKNESS,
  GRAVITY_Y,
  GRAVITY_SCALE,
  PIECE_RESTITUTION,
  PIECE_FRICTION,
  PIECE_FRICTION_AIR,
  FIXED_STEP_MS,
  PIECE_SLEEP_THRESHOLD,
  PIECE_SLEEP_MIN_FRAMES,
} from "../../constants";
import { TIERS } from "../../tiers";
import type { BodyState, ContactSide, PhysicsBackend } from "./backend";

const MATTER_DEFAULT_DENSITY = 0.001;

export interface MatterTuning {
  positionIterations: number;
  velocityIterations: number;
  slop: number;
  restitution: number;
  /** Multiplier on Matter's default density, per tier. */
  density: (tier: number) => number;
  /**
   * Thickness of the walls and floor, grown outward: the inner faces stay where they are. Thick
   * static bodies stop a fast piece from tunnelling through without a guard rail.
   */
  boundaryThickness: number;
  /** Walls reach this far above the canvas top (0 = they start at y = 0, as today). */
  wallsAbove: number;
  /** Polygon sides per circle (Matter's default caps a circle at 25). */
  maxSides?: number;
}

export const CURRENT_MATTER: MatterTuning = {
  positionIterations: 6,
  velocityIterations: 4,
  slop: 0.05,
  restitution: PIECE_RESTITUTION,
  density: (tier) => TIERS[tier]!.density,
  boundaryThickness: WALL_THICKNESS,
  wallsAbove: 0,
};

export function createMatterBackend(tuning: MatterTuning): PhysicsBackend {
  const engine = Matter.Engine.create({
    gravity: { x: 0, y: GRAVITY_Y, scale: GRAVITY_SCALE },
    enableSleeping: true,
  });
  engine.positionIterations = tuning.positionIterations;
  engine.velocityIterations = tuning.velocityIterations;
  (Matter.Sleeping as unknown as { _motionSleepThreshold: number })._motionSleepThreshold =
    PIECE_SLEEP_THRESHOLD;
  const world = engine.world;
  const T = tuning.boundaryThickness;
  const top = -tuning.wallsAbove;
  const bottom = tuning.wallsAbove > 0 ? WORLD_HEIGHT - FLOOR_THICKNESS + T : WORLD_HEIGHT;
  const wallH = bottom - top;
  const floorW = tuning.wallsAbove > 0 ? WORLD_WIDTH + 2 * T : WORLD_WIDTH;
  Matter.Composite.add(world, [
    Matter.Bodies.rectangle(WALL_THICKNESS - T / 2, top + wallH / 2, T, wallH, {
      isStatic: true,
      friction: PIECE_FRICTION,
      label: "wall-left",
    }),
    Matter.Bodies.rectangle(WORLD_WIDTH - WALL_THICKNESS + T / 2, top + wallH / 2, T, wallH, {
      isStatic: true,
      friction: PIECE_FRICTION,
      label: "wall-right",
    }),
    Matter.Bodies.rectangle(WORLD_WIDTH / 2, WORLD_HEIGHT - FLOOR_THICKNESS + T / 2, floorW, T, {
      isStatic: true,
      friction: PIECE_FRICTION,
      label: "floor",
    }),
  ]);

  const bodies = new Map<number, Matter.Body>();
  const side = (b: Matter.Body): ContactSide =>
    b.label === "piece"
      ? { kind: "piece", id: b.id }
      : b.label === "floor"
        ? { kind: "floor" }
        : { kind: "wall" };
  let onBegin: ((a: ContactSide, b: ContactSide) => void) | null = null;
  const handler = (event: Matter.IEventCollision<Matter.Engine>): void => {
    for (const pair of event.pairs) onBegin?.(side(pair.bodyA), side(pair.bodyB));
  };
  Matter.Events.on(engine, "collisionStart", handler);
  const body = (id: number): Matter.Body => bodies.get(id)!;

  return {
    addPiece(tier, x, y, radius) {
      const b = Matter.Bodies.circle(
        x,
        y,
        radius,
        {
          restitution: tuning.restitution,
          density: MATTER_DEFAULT_DENSITY * tuning.density(tier),
          friction: PIECE_FRICTION,
          frictionAir: PIECE_FRICTION_AIR,
          label: "piece",
          slop: tuning.slop,
        },
        tuning.maxSides
      );
      b.sleepThreshold = PIECE_SLEEP_MIN_FRAMES;
      Matter.Composite.add(world, b);
      bodies.set(b.id, b);
      return b.id;
    },
    removePiece(id) {
      const b = bodies.get(id);
      if (!b) return;
      Matter.Composite.remove(world, b);
      bodies.delete(id);
    },
    step(cb) {
      onBegin = cb;
      Matter.Engine.update(engine, FIXED_STEP_MS);
      onBegin = null;
    },
    get(id): BodyState {
      const b = body(id);
      return {
        x: b.position.x,
        y: b.position.y,
        vx: b.velocity.x,
        vy: b.velocity.y,
        speed: b.speed,
        angle: b.angle,
        angularVelocity: b.angularVelocity,
        isSleeping: b.isSleeping,
      };
    },
    setVelocity(id, vx, vy) {
      Matter.Body.setVelocity(body(id), { x: vx, y: vy });
    },
    setAngularVelocity(id, w) {
      Matter.Body.setAngularVelocity(body(id), w);
    },
    setPosition(id, x, y) {
      Matter.Body.setPosition(body(id), { x, y });
    },
    setRadius(id, radius) {
      const b = body(id);
      const current = b.circleRadius ?? radius;
      if (current > 0 && current !== radius) {
        const k = radius / current;
        Matter.Body.scale(b, k, k);
        b.circleRadius = radius;
      }
      Matter.Sleeping.set(b, false);
    },
    destroy() {
      Matter.Events.off(engine, "collisionStart", handler);
      Matter.Engine.clear(engine);
      bodies.clear();
    },
  };
}
