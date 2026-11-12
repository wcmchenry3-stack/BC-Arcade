/**
 * Cascade physics spike (#3696): candidate B, a planck.js (Box2D) backend for `CandidateEngine`.
 *
 * Box2D works in metres, seconds and kilograms and is tuned for bodies of 0.1-10 m, so the world
 * is scaled at `PX_PER_M` (50): radii 22-101 px are 0.44-2.02 m and the bin is 7.2 x 11.2 m.
 * Everything crossing the backend boundary is converted back to the production engine's units
 * (px, px per fixed step, rad per fixed step).
 *
 * Matched to the production engine: gravity 2500 px/s^2 (Matter's 2.5 x 0.001 x 16.67^2 px per
 * step per step), air friction 0.01 per step as linear damping, friction 0.5, the same fixed
 * step. Circles are true circles (no polygon facets). planck's global `Settings` stay at their
 * defaults (linear slop 0.005 m = 0.25 px).
 */
import { Box, Circle, Vec2, World, type Body, type Contact } from "planck";
import {
  WORLD_WIDTH,
  WORLD_HEIGHT,
  WALL_THICKNESS,
  FLOOR_THICKNESS,
  GRAVITY_Y,
  GRAVITY_SCALE,
  PIECE_FRICTION,
  PIECE_FRICTION_AIR,
  FIXED_STEP_MS,
} from "../../constants";
import type { BodyState, ContactSide, PhysicsBackend } from "./backend";

export const PX_PER_M = 50;
const STEP_S = FIXED_STEP_MS / 1000;
/** px per fixed step <-> m/s. */
const PX_STEP_TO_MS = 1 / PX_PER_M / STEP_S;
/** Matter's gravity in px/s^2: a velocity gain of GRAVITY_Y * GRAVITY_SCALE * dt^2 px/step per step. */
const GRAVITY_PX_S2 =
  (GRAVITY_Y * GRAVITY_SCALE * FIXED_STEP_MS * FIXED_STEP_MS) / (STEP_S * STEP_S);

export interface PlanckTuning {
  velocityIterations: number;
  positionIterations: number;
  restitution: number;
  /** Density per tier (only ratios matter in Box2D). */
  density: (tier: number) => number;
  /** Thickness of the walls and floor, grown outward (inner faces fixed). */
  boundaryThickness: number;
  /** Walls reach this far above the canvas top. */
  wallsAbove: number;
  /**
   * Collider radius = tier radius minus this (px), the drawn radius unchanged: pieces then
   * overlap visibly by up to twice this. 0 by default; a probe for #3697 (game length).
   */
  radiusInsetPx?: number;
  /** Friction coefficient for pieces and walls (default: the production 0.5). */
  friction?: number;
}

type UserData = ContactSide;

export function createPlanckBackend(tuning: PlanckTuning): PhysicsBackend {
  const m = (px: number): number => px / PX_PER_M;
  const friction = tuning.friction ?? PIECE_FRICTION;
  const collider = (r: number): number => m(Math.max(1, r - (tuning.radiusInsetPx ?? 0)));
  const world = new World({ gravity: Vec2(0, m(GRAVITY_PX_S2)), allowSleep: true });
  const T = tuning.boundaryThickness;
  const top = -tuning.wallsAbove;
  const bottom = WORLD_HEIGHT - FLOOR_THICKNESS + T;
  const ground = world.createBody({ type: "static" });
  const wallData: UserData = { kind: "wall" };
  const floorData: UserData = { kind: "floor" };
  const box = (cx: number, cy: number, w: number, h: number) =>
    new Box(m(w / 2), m(h / 2), Vec2(m(cx), m(cy)), 0);
  ground
    .createFixture({
      shape: box(WALL_THICKNESS - T / 2, (top + bottom) / 2, T, bottom - top),
      friction,
    })
    .setUserData(wallData);
  ground
    .createFixture({
      shape: box(WORLD_WIDTH - WALL_THICKNESS + T / 2, (top + bottom) / 2, T, bottom - top),
      friction,
    })
    .setUserData(wallData);
  ground
    .createFixture({
      shape: box(WORLD_WIDTH / 2, WORLD_HEIGHT - FLOOR_THICKNESS + T / 2, WORLD_WIDTH + 2 * T, T),
      friction,
    })
    .setUserData(floorData);

  // Matter's frictionAir multiplies velocity by (1 - 0.01) per step; Box2D damps by
  // 1 / (1 + h * c) per step, so c = (1 / (1 - 0.01) - 1) / h.
  const linearDamping = (1 / (1 - PIECE_FRICTION_AIR) - 1) / STEP_S;
  const bodies = new Map<number, Body>();
  let nextId = 1;
  let onBegin: ((a: ContactSide, b: ContactSide) => void) | null = null;
  world.on("begin-contact", (c: Contact) => {
    const a = c.getFixtureA().getUserData() as UserData;
    const b = c.getFixtureB().getUserData() as UserData;
    onBegin?.(a, b);
  });
  const body = (id: number): Body => bodies.get(id)!;

  return {
    addPiece(tier, x, y, radius) {
      const id = nextId++;
      const b = world.createBody({
        type: "dynamic",
        position: Vec2(m(x), m(y)),
        linearDamping,
        allowSleep: true,
      });
      b.createFixture({
        shape: new Circle(collider(radius)),
        density: tuning.density(tier),
        friction,
        restitution: tuning.restitution,
      }).setUserData({ kind: "piece", id } satisfies UserData);
      bodies.set(id, b);
      return id;
    },
    removePiece(id) {
      const b = bodies.get(id);
      if (!b) return;
      world.destroyBody(b);
      bodies.delete(id);
    },
    step(cb) {
      onBegin = cb;
      world.step(STEP_S, tuning.velocityIterations, tuning.positionIterations);
      onBegin = null;
    },
    get(id): BodyState {
      const b = body(id);
      const p = b.getPosition();
      const v = b.getLinearVelocity();
      const vx = v.x / PX_STEP_TO_MS;
      const vy = v.y / PX_STEP_TO_MS;
      return {
        x: p.x * PX_PER_M,
        y: p.y * PX_PER_M,
        vx,
        vy,
        speed: Math.hypot(vx, vy),
        angle: b.getAngle(),
        angularVelocity: b.getAngularVelocity() * STEP_S,
        isSleeping: !b.isAwake(),
      };
    },
    setVelocity(id, vx, vy) {
      body(id).setLinearVelocity(Vec2(vx * PX_STEP_TO_MS, vy * PX_STEP_TO_MS));
    },
    setAngularVelocity(id, w) {
      const b = body(id);
      // Setting a sleeping body's velocity wakes it in Box2D; leave a resting body asleep.
      if (!b.isAwake()) return;
      b.setAngularVelocity(w / STEP_S);
    },
    setPosition(id, x, y) {
      const b = body(id);
      b.setPosition(Vec2(m(x), m(y)));
      b.setAwake(true);
    },
    setRadius(id, radius) {
      const b = body(id);
      const f = b.getFixtureList();
      if (!f) return;
      (f.getShape() as Circle).m_radius = collider(radius);
      b.resetMassData();
      b.setAwake(true);
    },
    destroy() {
      for (const b of bodies.values()) world.destroyBody(b);
      world.destroyBody(ground);
      bodies.clear();
    },
  };
}
