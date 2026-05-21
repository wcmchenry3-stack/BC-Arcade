import * as Matter from "matter-js";
import { PIECE_DEFS, MAX_TIER, type PieceDef } from "./pieceDefs";
import {
  WORLD_WIDTH,
  WORLD_HEIGHT,
  WALL_THICKNESS,
  FLOOR_THICKNESS,
  OVERFLOW_LINE_Y,
  OVERFLOW_TICKS_THRESHOLD,
  OVERFLOW_IGNORE_MERGE_TICKS,
  GRAVITY_Y,
  GRAVITY_SCALE,
  PIECE_RESTITUTION,
  PIECE_FRICTION,
  PIECE_FRICTION_AIR,
  PIECE_ANGULAR_DAMPING,
  MAX_ANGULAR_VELOCITY,
  FIXED_STEP_MS,
  MAX_SUBSTEPS,
  MERGE_POP_IMPULSE,
  GUARD_RAIL_HORIZONTAL_TOLERANCE,
  PIECE_SLEEP_THRESHOLD,
  PIECE_SLEEP_MIN_FRAMES,
  MAX_SPAWN_VELOCITY,
  COMBO_WINDOW_TICKS,
} from "./constants";

// Pixels above the overflow line where a newly dropped piece's centroid starts.
const DROP_SPAWN_INSET = 5;

export interface EngineConfig {
  // Reserved for future multi-board or variable-size support.
  // Currently unused — world dimensions are taken from constants.ts.
  worldWidth?: number;
  worldHeight?: number;
}

export interface PieceSnapshot {
  id: number;
  tier: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  shapeKind: "circle" | "convex";
  isSleeping: boolean;
}

export type EngineEvent =
  | { type: "merge"; tierA: number; tierB: number; result: number; x: number; y: number }
  | { type: "score"; delta: number; total: number }
  | { type: "gameOver" }
  | { type: "guardRailFired"; reason: string; bodyId: number }
  | { type: "cascadeCombo"; count: number };

export interface StepResult {
  events: EngineEvent[];
}

export interface GameState {
  pieces: PieceSnapshot[];
  score: number;
  gameOver: boolean;
}

function makeBody(def: PieceDef, x: number, y: number): Matter.Body {
  const opts = {
    restitution: PIECE_RESTITUTION,
    friction: PIECE_FRICTION,
    frictionAir: PIECE_FRICTION_AIR,
    label: "piece",
    slop: 0.05,
  };
  let body: Matter.Body;
  if (def.shape.kind === "circle") {
    body = Matter.Bodies.circle(x, y, def.shape.radius, opts);
  } else {
    const fromVerts = Matter.Bodies.fromVertices(
      x,
      y,
      [def.shape.vertices as Matter.Vector[]],
      opts
    );
    body =
      fromVerts && fromVerts.vertices?.length
        ? fromVerts
        : Matter.Bodies.circle(x, y, def.shape.boundingRadius, opts);
  }
  body.sleepThreshold = PIECE_SLEEP_MIN_FRAMES;
  return body;
}

export class CascadeEngine {
  private readonly _engine: Matter.Engine;
  private readonly _world: Matter.World;
  private readonly _pieces: Map<number, { body: Matter.Body; tier: number }> = new Map();
  private _score = 0;
  private _gameOver = false;
  private _overflowTicksCount = 0;
  // Start past the threshold so the first tick is immediately eligible to count overflow.
  // Initializing to 0 would suppress overflow counting for the first OVERFLOW_IGNORE_MERGE_TICKS
  // ticks of every game as if a merge had just fired at t = -1.
  private _ticksSinceLastMerge = OVERFLOW_IGNORE_MERGE_TICKS + 1;
  private readonly _pendingMerges = new Set<string>();
  private _accumulator = 0;
  private _comboCount = 0;
  private _comboTicksLeft = 0;
  private _comboEmitted = false;

  constructor(_config: EngineConfig = {}) {
    this._engine = Matter.Engine.create({
      gravity: { x: 0, y: GRAVITY_Y, scale: GRAVITY_SCALE },
      enableSleeping: true,
    });
    this._engine.positionIterations = 6;
    this._engine.velocityIterations = 4;
    // _motionSleepThreshold is not in the public type declarations but is a stable
    // runtime property on the Sleeping module since Matter.js v0.14.
    (Matter.Sleeping as unknown as { _motionSleepThreshold: number })._motionSleepThreshold =
      PIECE_SLEEP_THRESHOLD;
    this._world = this._engine.world;

    Matter.Composite.add(this._world, [
      Matter.Bodies.rectangle(WALL_THICKNESS / 2, WORLD_HEIGHT / 2, WALL_THICKNESS, WORLD_HEIGHT, {
        isStatic: true,
        friction: PIECE_FRICTION,
        label: "wall-left",
      }),
      Matter.Bodies.rectangle(
        WORLD_WIDTH - WALL_THICKNESS / 2,
        WORLD_HEIGHT / 2,
        WALL_THICKNESS,
        WORLD_HEIGHT,
        { isStatic: true, friction: PIECE_FRICTION, label: "wall-right" }
      ),
      Matter.Bodies.rectangle(
        WORLD_WIDTH / 2,
        WORLD_HEIGHT - FLOOR_THICKNESS / 2,
        WORLD_WIDTH,
        FLOOR_THICKNESS,
        { isStatic: true, friction: PIECE_FRICTION, label: "floor" }
      ),
    ]);

    // Only collisionStart is subscribed. collisionActive is intentionally omitted:
    // Matter.js fires collisionStart even for bodies created already overlapping
    // (no prior-frame contact), which covers the case of two same-position drops.
    Matter.Events.on(this._engine, "collisionStart", this._handleCollision);
  }

  // _handleCollision guards pA.tier >= MAX_TIER, so every pair entering
  // _pendingMerges is guaranteed to have tier < MAX_TIER and newTier <= MAX_TIER.
  private readonly _handleCollision = (event: Matter.IEventCollision<Matter.Engine>): void => {
    for (const pair of event.pairs) {
      const pA = this._pieces.get(pair.bodyA.id);
      const pB = this._pieces.get(pair.bodyB.id);
      if (!pA || !pB || pA.tier !== pB.tier || pA.tier >= MAX_TIER) continue;
      const lo = pair.bodyA.id < pair.bodyB.id ? pair.bodyA.id : pair.bodyB.id;
      const hi = pair.bodyA.id < pair.bodyB.id ? pair.bodyB.id : pair.bodyA.id;
      this._pendingMerges.add(`${lo}:${hi}`);
    }
  };

  // Lifecycle hook — engine is ready immediately after construction; start() is a
  // no-op placeholder for callers that follow a create/start/destroy lifecycle.
  start(): void {}

  step(deltaMs: number): StepResult {
    if (this._gameOver) return { events: [] };

    const events: EngineEvent[] = [];

    this._accumulator += deltaMs;
    let substeps = 0;
    while (this._accumulator >= FIXED_STEP_MS && substeps < MAX_SUBSTEPS) {
      Matter.Engine.update(this._engine, FIXED_STEP_MS);
      this._accumulator -= FIXED_STEP_MS;
      substeps++;
    }

    // Angular damping + guard rails (applied post-physics)
    for (const { body, tier } of this._pieces.values()) {
      const damped = body.angularVelocity * (1 - PIECE_ANGULAR_DAMPING);
      const clamped =
        Math.abs(damped) > MAX_ANGULAR_VELOCITY ? Math.sign(damped) * MAX_ANGULAR_VELOCITY : damped;
      Matter.Body.setAngularVelocity(body, clamped);

      const def = PIECE_DEFS[tier]!;
      const r = def.shape.kind === "circle" ? def.shape.radius : def.shape.boundingRadius;
      const minX = WALL_THICKNESS + r;
      const maxX = WORLD_WIDTH - WALL_THICKNESS - r;
      const maxY = WORLD_HEIGHT - FLOOR_THICKNESS - r;
      const bx = body.position.x;
      const by = body.position.y;

      if (
        !isFinite(bx) ||
        !isFinite(by) ||
        bx < minX - GUARD_RAIL_HORIZONTAL_TOLERANCE ||
        bx > maxX + GUARD_RAIL_HORIZONTAL_TOLERANCE ||
        by > maxY
      ) {
        Matter.Body.setPosition(body, {
          x: Math.max(minX, Math.min(maxX, isFinite(bx) ? bx : WORLD_WIDTH / 2)),
          y: Math.min(maxY, isFinite(by) ? by : WORLD_HEIGHT / 2),
        });
        Matter.Body.setVelocity(body, { x: 0, y: 0 });
        events.push({ type: "guardRailFired", reason: "outOfBounds", bodyId: body.id });
      }
    }

    // Process pending merges. _handleCollision guarantees tier < MAX_TIER for all
    // pairs in _pendingMerges, so newTier is always a valid PIECE_DEFS index.
    const merged = new Set<number>();
    for (const key of this._pendingMerges) {
      const colon = key.indexOf(":");
      const idA = Number(key.slice(0, colon));
      const idB = Number(key.slice(colon + 1));
      if (merged.has(idA) || merged.has(idB)) continue;

      const pA = this._pieces.get(idA);
      const pB = this._pieces.get(idB);
      if (!pA || !pB || pA.tier !== pB.tier) continue;

      const tier = pA.tier;
      const newTier = tier + 1;
      const mx = (pA.body.position.x + pB.body.position.x) / 2;
      const my = (pA.body.position.y + pB.body.position.y) / 2;

      Matter.Composite.remove(this._world, pA.body);
      Matter.Composite.remove(this._world, pB.body);
      this._pieces.delete(idA);
      this._pieces.delete(idB);
      merged.add(idA);
      merged.add(idB);

      const mergedVx = (pA.body.velocity.x + pB.body.velocity.x) / 2;
      const mergedVy = (pA.body.velocity.y + pB.body.velocity.y) / 2 - MERGE_POP_IMPULSE;
      const newDef = PIECE_DEFS[newTier]!;
      const newBody = makeBody(newDef, mx, my);
      Matter.Body.setVelocity(newBody, {
        x: Math.max(-MAX_SPAWN_VELOCITY, Math.min(MAX_SPAWN_VELOCITY, mergedVx)),
        y: Math.max(-MAX_SPAWN_VELOCITY, Math.min(MAX_SPAWN_VELOCITY, mergedVy)),
      });
      Matter.Composite.add(this._world, newBody);
      this._pieces.set(newBody.id, { body: newBody, tier: newTier });

      const scoreValue = PIECE_DEFS[newTier]!.scoreValue;
      this._score += scoreValue;
      events.push({ type: "merge", tierA: tier, tierB: tier, result: newTier, x: mx, y: my });
      events.push({ type: "score", delta: scoreValue, total: this._score });
      this._ticksSinceLastMerge = 0;
      if (this._comboTicksLeft > 0) this._comboCount++;
    }
    this._pendingMerges.clear();

    // Overflow detection. Any merge — even far below the overflow line — resets the
    // counter via OVERFLOW_IGNORE_MERGE_TICKS; this intentionally gives merges time
    // to settle before re-evaluating whether the stack is still overflowing.
    this._ticksSinceLastMerge++;
    let anyOverflow = false;
    for (const { body } of this._pieces.values()) {
      if (body.position.y < OVERFLOW_LINE_Y) {
        anyOverflow = true;
        break;
      }
    }

    if (anyOverflow && this._ticksSinceLastMerge > OVERFLOW_IGNORE_MERGE_TICKS) {
      this._overflowTicksCount++;
    } else {
      this._overflowTicksCount = 0;
    }

    if (this._overflowTicksCount >= OVERFLOW_TICKS_THRESHOLD) {
      this._gameOver = true;
      events.push({ type: "gameOver" });
    }

    // Emit as soon as the threshold is reached (after all merges in this step are counted)
    // so the screen can react immediately. Suppressed if gameOver fired in the same step.
    if (
      this._comboTicksLeft > 0 &&
      this._comboCount >= 2 &&
      !this._comboEmitted &&
      !this._gameOver
    ) {
      events.push({ type: "cascadeCombo", count: this._comboCount });
      this._comboEmitted = true;
    }
    if (this._comboTicksLeft > 0) this._comboTicksLeft--;

    return { events };
  }

  destroy(): void {
    Matter.Events.off(this._engine, "collisionStart", this._handleCollision);
    Matter.Engine.clear(this._engine);
    this._pieces.clear();
  }

  restore(pieces: ReadonlyArray<{ tier: number; x: number; y: number }>, score: number): void {
    for (const { body } of this._pieces.values()) {
      Matter.Composite.remove(this._world, body);
    }
    this._pieces.clear();
    this._pendingMerges.clear();
    this._score = score;
    this._gameOver = false;
    this._overflowTicksCount = 0;
    // Treat restore like a merge just fired so OVERFLOW_IGNORE_MERGE_TICKS of
    // grace applies while pieces settle into their saved positions.
    this._ticksSinceLastMerge = 0;
    this._accumulator = 0;
    this._comboCount = 0;
    this._comboTicksLeft = 0;
    this._comboEmitted = false;
    for (const { tier, x, y } of pieces) {
      const def = PIECE_DEFS[tier];
      if (!def) continue;
      const body = makeBody(def, x, y);
      Matter.Composite.add(this._world, body);
      this._pieces.set(body.id, { body, tier });
    }
  }

  drop(tier: number, x: number): void {
    if (this._gameOver) return;
    const def = PIECE_DEFS[tier];
    if (!def) return;
    const r = def.shape.kind === "circle" ? def.shape.radius : def.shape.boundingRadius;
    const y = OVERFLOW_LINE_Y - r - DROP_SPAWN_INSET;
    const body = makeBody(def, x, y);
    Matter.Composite.add(this._world, body);
    this._pieces.set(body.id, { body, tier });
    this._comboCount = 0;
    this._comboTicksLeft = COMBO_WINDOW_TICKS;
    this._comboEmitted = false;
  }

  getState(): GameState {
    const pieces: PieceSnapshot[] = Array.from(this._pieces.values()).map(({ body, tier }) => ({
      id: body.id,
      tier,
      x: body.position.x,
      y: body.position.y,
      vx: body.velocity.x,
      vy: body.velocity.y,
      angle: body.angle,
      shapeKind: PIECE_DEFS[tier]!.shape.kind,
      isSleeping: body.isSleeping,
    }));
    return { pieces, score: this._score, gameOver: this._gameOver };
  }
}
