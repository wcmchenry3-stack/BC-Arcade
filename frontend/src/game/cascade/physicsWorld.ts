/**
 * Cascade physics world (#3697): planck.js (Box2D), pinned at 1.4.2, in the engine's units.
 *
 * `engine.ts` owns the rules (merges, the lid, the drop gate, combos, the win); this module owns
 * the planck `World`, the bin, and the conversions. Box2D works in metres, seconds and kilograms
 * and is tuned for bodies of 0.1-10 m, so the world is scaled at `PX_PER_M` (50): radii 18-63 px
 * are 0.36-1.26 m and the bin is 7.2 x 11.2 m. The engine keeps the units it always had: world
 * pixels, velocities in px per fixed step (`FIXED_STEP_MS`), angles in radians, angular velocity
 * in rad per fixed step.
 *
 * Circles are true circles (no polygon facets). planck 1.4.2's `PolygonShape.computeMass` has a
 * typo (the centre of mass of a dynamic polygon is wrong; fixed in 1.5): Cascade only has dynamic
 * circles and static boxes, so it does not apply. A convex dynamic piece would need 1.5.
 *
 * Determinism: planck's solver uses no randomness and no clock (its only `Math.random` is the
 * public `math.random` helper, never called here), so the same calls give the same world.
 */
import { Box, Circle, Vec2, World, type Body, type Contact, type Fixture } from "planck";
import {
  BOUNDARY_THICKNESS,
  FIXED_STEP_MS,
  FLOOR_THICKNESS,
  GRAVITY_PX_S2,
  PIECE_FRICTION,
  PIECE_FRICTION_AIR,
  PIECE_RESTITUTION,
  POSITION_ITERATIONS,
  PX_PER_M,
  VELOCITY_ITERATIONS,
  WALLS_ABOVE_PX,
  WALL_THICKNESS,
  WORLD_HEIGHT,
  WORLD_WIDTH,
} from "./constants";

/** One fixed step, in seconds. */
export const STEP_S = FIXED_STEP_MS / 1000;
/** px per fixed step -> m/s. */
const PX_STEP_TO_M_S = 1 / PX_PER_M / STEP_S;
/** m/s -> px per fixed step. */
export const M_S_TO_PX_STEP = PX_PER_M * STEP_S;

/**
 * Air friction as Box2D linear damping. Matter's frictionAir multiplied velocity by (1 - 0.01) per
 * step; Box2D damps by 1 / (1 + h * c) per step, so c = (1 / (1 - 0.01) - 1) / h.
 */
const LINEAR_DAMPING = (1 / (1 - PIECE_FRICTION_AIR) - 1) / STEP_S;

/** What a fixture is: the engine's piece record (anything with a numeric `id`), or the bin. */
export type BinSide = "wall" | "floor";
export type FixtureTag<P> = P | BinSide;

const m = (px: number): number => px / PX_PER_M;

export interface PhysicsWorld<P> {
  readonly world: World;
  /** Adds a dynamic circle for `piece`, tagged with it; position and radius in px. */
  addPiece(piece: P, x: number, y: number, radiusPx: number, density: number): Body;
  removePiece(body: Body): void;
  /** One fixed step; `onBegin` sees every contact that starts during it. */
  step(): void;
  destroy(): void;
}

/**
 * Builds the bin: walls and floor `BOUNDARY_THICKNESS` thick, grown outward from the inner faces
 * (which stay where the renderer draws them), the walls reaching `WALLS_ABOVE_PX` above the
 * canvas. Thick boundaries are what keep a fast piece from tunnelling, so no guard rail has to
 * teleport anything back in.
 */
export function createPhysicsWorld<P>(
  onBegin: (a: FixtureTag<P>, b: FixtureTag<P>) => void
): PhysicsWorld<P> {
  const world = new World({ gravity: Vec2(0, m(GRAVITY_PX_S2)), allowSleep: true });
  const T = BOUNDARY_THICKNESS;
  const top = -WALLS_ABOVE_PX;
  const bottom = WORLD_HEIGHT - FLOOR_THICKNESS + T;
  const ground = world.createBody({ type: "static" });
  const box = (cx: number, cy: number, w: number, h: number) =>
    new Box(m(w / 2), m(h / 2), Vec2(m(cx), m(cy)), 0);
  const wall = (cx: number) =>
    ground
      .createFixture({
        shape: box(cx, (top + bottom) / 2, T, bottom - top),
        friction: PIECE_FRICTION,
      })
      .setUserData("wall" satisfies BinSide);
  wall(WALL_THICKNESS - T / 2);
  wall(WORLD_WIDTH - WALL_THICKNESS + T / 2);
  ground
    .createFixture({
      shape: box(WORLD_WIDTH / 2, WORLD_HEIGHT - FLOOR_THICKNESS + T / 2, WORLD_WIDTH + 2 * T, T),
      friction: PIECE_FRICTION,
    })
    .setUserData("floor" satisfies BinSide);

  const beginContact = (c: Contact): void => {
    onBegin(
      c.getFixtureA().getUserData() as FixtureTag<P>,
      c.getFixtureB().getUserData() as FixtureTag<P>
    );
  };
  world.on("begin-contact", beginContact);

  return {
    world,
    addPiece(piece, x, y, radiusPx, density) {
      const body = world.createBody({
        type: "dynamic",
        position: Vec2(m(x), m(y)),
        linearDamping: LINEAR_DAMPING,
        angularDamping: 0,
        allowSleep: true,
      });
      body
        .createFixture({
          shape: new Circle(m(radiusPx)),
          density,
          friction: PIECE_FRICTION,
          restitution: PIECE_RESTITUTION,
        })
        .setUserData(piece);
      return body;
    },
    removePiece(body) {
      world.destroyBody(body);
    },
    step() {
      world.step(STEP_S, VELOCITY_ITERATIONS, POSITION_ITERATIONS);
    },
    destroy() {
      world.off("begin-contact", beginContact);
      for (let b = world.getBodyList(); b;) {
        const next = b.getNext();
        world.destroyBody(b);
        b = next;
      }
    },
  };
}

/** Sets a body's linear velocity in px per fixed step. */
export function setVelocityPx(body: Body, vx: number, vy: number): void {
  body.setLinearVelocity(Vec2(vx * PX_STEP_TO_M_S, vy * PX_STEP_TO_M_S));
}

/** Moves a body to (x, y) px and wakes it. */
export function setPositionPx(body: Body, x: number, y: number): void {
  body.setPosition(Vec2(m(x), m(y)));
  body.setAwake(true);
}

/** Changes a piece's collider radius in place (merge grow-in); its mass follows the area. */
export function setRadiusPx(body: Body, fixture: Fixture, radiusPx: number): void {
  (fixture.getShape() as Circle).m_radius = m(radiusPx);
  body.resetMassData();
  body.setAwake(true);
}
