import * as Matter from 'matter-js';
import { PIECE_DEFS, MAX_TIER } from './pieceDefs';
import type { PieceDef } from './pieceDefs';
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
} from './constants';

export interface EngineConfig {
  worldWidth?: number;
  worldHeight?: number;
}

export interface PieceSnapshot {
  id: number;
  tier: number;
  x: number;
  y: number;
  angle: number;
  shapeKind: 'circle' | 'convex';
}

export type EngineEvent =
  | { type: 'merge'; tierA: number; tierB: number; result: number; x: number; y: number }
  | { type: 'score'; delta: number; total: number }
  | { type: 'gameOver' }
  | { type: 'guardRailFired'; reason: string; bodyId: number };

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
    label: 'piece',
  };
  if (def.shape.kind === 'circle') {
    return Matter.Bodies.circle(x, y, def.shape.radius, opts);
  }
  const body = Matter.Bodies.fromVertices(x, y, [def.shape.vertices as Matter.Vector[]], opts);
  if (!body || !body.vertices?.length) {
    return Matter.Bodies.circle(x, y, def.shape.boundingRadius, opts);
  }
  return body;
}

export class CascadeEngine {
  private readonly _engine: Matter.Engine;
  private readonly _world: Matter.World;
  private readonly _pieces: Map<number, { body: Matter.Body; tier: number }> = new Map();
  private _score = 0;
  private _gameOver = false;
  private _overflowTicksCount = 0;
  private _ticksSinceLastMerge = 0;
  private readonly _pendingMerges = new Set<string>();
  private _accumulator = 0;

  constructor(_config: EngineConfig = {}) {
    this._engine = Matter.Engine.create({
      gravity: { x: 0, y: GRAVITY_Y, scale: GRAVITY_SCALE },
    });
    this._world = this._engine.world;

    Matter.Composite.add(this._world, [
      Matter.Bodies.rectangle(
        WALL_THICKNESS / 2, WORLD_HEIGHT / 2,
        WALL_THICKNESS, WORLD_HEIGHT,
        { isStatic: true, friction: PIECE_FRICTION, label: 'wall-left' },
      ),
      Matter.Bodies.rectangle(
        WORLD_WIDTH - WALL_THICKNESS / 2, WORLD_HEIGHT / 2,
        WALL_THICKNESS, WORLD_HEIGHT,
        { isStatic: true, friction: PIECE_FRICTION, label: 'wall-right' },
      ),
      Matter.Bodies.rectangle(
        WORLD_WIDTH / 2, WORLD_HEIGHT - FLOOR_THICKNESS / 2,
        WORLD_WIDTH, FLOOR_THICKNESS,
        { isStatic: true, friction: PIECE_FRICTION, label: 'floor' },
      ),
    ]);

    Matter.Events.on(this._engine, 'collisionStart', this._handleCollision);
  }

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
        Math.abs(damped) > MAX_ANGULAR_VELOCITY
          ? Math.sign(damped) * MAX_ANGULAR_VELOCITY
          : damped;
      Matter.Body.setAngularVelocity(body, clamped);

      const def = PIECE_DEFS[tier]!;
      const r = def.shape.kind === 'circle' ? def.shape.radius : def.shape.boundingRadius;
      const minX = WALL_THICKNESS + r;
      const maxX = WORLD_WIDTH - WALL_THICKNESS - r;
      const maxY = WORLD_HEIGHT - FLOOR_THICKNESS - r;
      const bx = body.position.x;
      const by = body.position.y;

      if (!isFinite(bx) || !isFinite(by) || bx < minX || bx > maxX || by > maxY) {
        Matter.Body.setPosition(body, {
          x: Math.max(minX, Math.min(maxX, isFinite(bx) ? bx : WORLD_WIDTH / 2)),
          y: Math.min(maxY, isFinite(by) ? by : WORLD_HEIGHT / 2),
        });
        Matter.Body.setVelocity(body, { x: 0, y: 0 });
        events.push({ type: 'guardRailFired', reason: 'outOfBounds', bodyId: body.id });
      }
    }

    // Process pending merges
    const merged = new Set<number>();
    for (const key of this._pendingMerges) {
      const colon = key.indexOf(':');
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

      if (newTier <= MAX_TIER) {
        const newDef = PIECE_DEFS[newTier]!;
        const newBody = makeBody(newDef, mx, my);
        Matter.Body.setVelocity(newBody, { x: 0, y: -MERGE_POP_IMPULSE });
        Matter.Composite.add(this._world, newBody);
        this._pieces.set(newBody.id, { body: newBody, tier: newTier });
      }

      const scoreValue = PIECE_DEFS[newTier <= MAX_TIER ? newTier : MAX_TIER]!.scoreValue;
      this._score += scoreValue;
      events.push({ type: 'merge', tierA: tier, tierB: tier, result: Math.min(newTier, MAX_TIER), x: mx, y: my });
      events.push({ type: 'score', delta: scoreValue, total: this._score });
      this._ticksSinceLastMerge = 0;
    }
    this._pendingMerges.clear();

    // Overflow detection
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
      events.push({ type: 'gameOver' });
    }

    return { events };
  }

  destroy(): void {
    Matter.Events.off(this._engine, 'collisionStart', this._handleCollision);
    Matter.Engine.clear(this._engine);
    this._pieces.clear();
  }

  drop(tier: number, x: number): void {
    if (this._gameOver) return;
    const def = PIECE_DEFS[tier];
    if (!def) return;
    const r = def.shape.kind === 'circle' ? def.shape.radius : def.shape.boundingRadius;
    const y = OVERFLOW_LINE_Y - r - 5;
    const body = makeBody(def, x, y);
    Matter.Composite.add(this._world, body);
    this._pieces.set(body.id, { body, tier });
  }

  getState(): GameState {
    const pieces: PieceSnapshot[] = Array.from(this._pieces.values()).map(({ body, tier }) => ({
      id: body.id,
      tier,
      x: body.position.x,
      y: body.position.y,
      angle: body.angle,
      shapeKind: PIECE_DEFS[tier]!.shape.kind,
    }));
    return { pieces, score: this._score, gameOver: this._gameOver };
  }
}
