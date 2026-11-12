/**
 * Cascade physics spike (#3696): the physics surface a candidate engine is built on.
 *
 * `CandidateEngine` (`candidateEngine.ts`) holds the game rules (merges, the lid, the drop gate,
 * combos), ported from `../../engine.ts`. A backend supplies only the bodies and the solver, so
 * every candidate plays by the same rules and differs only in its physics.
 *
 * Units are the production engine's: world pixels, velocities in px per fixed step
 * (`FIXED_STEP_MS`), angles in radians and angular velocity in rad per fixed step. A backend in
 * other units (planck.js works in metres and seconds) converts at this boundary.
 *
 * Spike code: it lives under `sim/`, which knip and the app bundle exclude. Nothing in the app
 * imports it.
 */

/** What a piece touched: another piece (by backend id), the floor or a wall. */
export type ContactSide = { kind: "piece"; id: number } | { kind: "floor" } | { kind: "wall" };

export interface BodyState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** |v| in px per fixed step (Matter's `body.speed`). */
  speed: number;
  angle: number;
  angularVelocity: number;
  isSleeping: boolean;
}

export interface PhysicsBackend {
  /** Adds a circular piece; returns its id (unique for this backend's lifetime, increasing). */
  addPiece(tier: number, x: number, y: number, radius: number): number;
  removePiece(id: number): void;
  /**
   * Advances one fixed step. `onBegin` is called synchronously for every contact that started
   * during it, in the backend's order.
   */
  step(onBegin: (a: ContactSide, b: ContactSide) => void): void;
  get(id: number): BodyState;
  setVelocity(id: number, vx: number, vy: number): void;
  setAngularVelocity(id: number, w: number): void;
  setPosition(id: number, x: number, y: number): void;
  /** Changes a piece's collision radius in place (merge grow-in). Mass follows the area. */
  setRadius(id: number, radius: number): void;
  destroy(): void;
}
