/**
 * Cascade engine (#3693): the physics and rules of the merge game, on Matter.js.
 *
 * Headless: no React, no AsyncStorage, no rendering. The screen steps it from a RAF loop
 * (`step(deltaMs)`), calls `drop(tier, x)` for a tap, and reads `getState()` back; scoring, merges
 * and game over are decided here, from `pieceDefs.ts` and `constants.ts`.
 *
 * Determinism and RNG (docs/ARCHITECTURE.md section 3.2, #2985 / #2999):
 *   - This module holds no RNG slot and calls no `Math.random`. Time enters only as the `deltaMs`
 *     passed to `step`, consumed in fixed `FIXED_STEP_MS` substeps (at most `MAX_SUBSTEPS`), so
 *     the same drops stepped by the same deltas replay the same board. A long frame is clamped by
 *     the caller (100 ms) and by `MAX_SUBSTEPS`, so replays must feed the same deltas.
 *   - The only randomness in a game is which tier comes next. It lives in `spawnSelector.ts`
 *     (`selectNextTier(..., rng = Math.random)`) and `pieceQueue.ts`, which take the source as a
 *     parameter; the screen passes a seeded one when a test seeds the queue (`__cascade_setSeed`).
 *     Live play uses `Math.random`, so a live game is not replayable from a seed alone.
 *   - Body ids come from Matter.js's module-level counter and are not reset between games. They
 *     are not saved (`storage.ts` keeps tier and position only) and not part of any result.
 *   - A restored game (`restore(pieces, score)`) re-creates bodies from saved tier and position,
 *     at rest: velocities are not saved.
 *
 * Combo window: `COMBO_WINDOW_TICKS` (120) is counted in fixed steps like the lid, so it is 2 s
 * of simulated time at any frame rate. (Before #3694 it was counted per `step()` call, i.e. per
 * frame: 2 s at 60 Hz but only 1 s at 120 Hz.)
 *
 * Game over, "the lid" (#3694; docs/games/cascade.md#game-over-the-lid). Everything below is
 * counted in fixed physics steps, inside the substep loop, so 60 and 120 Hz play equivalently (the same rules over the same simulated time, up to
 * frame-boundary rounding):
 *   - Overflow: a SETTLED piece (`body.speed` <= `OVERFLOW_SETTLED_SPEED`, and not the piece
 *     still falling from the spawner) whose TOP edge is above `OVERFLOW_LINE_Y` counts. When one
 *     does on `OVERFLOW_TICKS_THRESHOLD` steps in a row, the game ends.
 *   - Merge grace: only a merge involving a piece in the danger band resets and pauses the count
 *     (`OVERFLOW_IGNORE_MERGE_TICKS`). Merges lower in the bin do nothing.
 *   - Hard stop: a settled piece whose top edge reaches `HARD_STOP_Y` (the canvas top) ends the
 *     game at once, so the pile is never drawn off-screen. The one exception is the last dropped
 *     piece: a large piece spawns with its top edge above the canvas, so it must stay settled
 *     up there for `HARD_STOP_SETTLE_TICKS` steps (0.5 s) first. Otherwise brushing a pile that
 *     reaches just under the lid would end the game with no countdown. If it stays, it ends.
 *   - Drop gating: `canDrop()` is false until the last dropped piece is below the lid (its top
 *     edge at or under the line). It cannot deadlock: once that piece lands on something it is an
 *     ordinary piece, so if it rests over the lid the overflow rule ends the game.
 *   - `dangerRatio` (state) = overflow count / threshold, 0..1, for the screen's countdown.
 *
 * Constants are in `constants.ts` and the tier ladder in `pieceDefs.ts`. Persistence is
 * `storage.ts`; layout is `layout.ts`. Notes for the rework: docs/games/cascade.md.
 */
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
  OVERFLOW_SETTLED_SPEED,
  HARD_STOP_Y,
  HARD_STOP_SETTLE_TICKS,
  DANGER_STACK_MARGIN,
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
  | { type: "gameOver"; reason: GameOverReason }
  | { type: "guardRailFired"; reason: string; bodyId: number }
  | { type: "cascadeCombo"; count: number };

/** Why the game ended: the pile stayed over the lid, or a piece reached the canvas top. */
export type GameOverReason = "overflow" | "hardStop";

export interface StepResult {
  events: EngineEvent[];
}

export interface GameState {
  pieces: PieceSnapshot[];
  score: number;
  gameOver: boolean;
  /** How close the lid rule is to ending the game: 0 = no count running, 1 = game over. */
  dangerRatio: number;
  /** False while the last dropped piece is still over the lid (`CascadeEngine.canDrop`). */
  canDrop: boolean;
}

/** A piece's radius for the lid rule (bounding radius for convex shapes). */
function pieceRadius(def: PieceDef): number {
  return def.shape.kind === "circle" ? def.shape.radius : def.shape.boundingRadius;
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
  // Fixed steps since the last merge in the danger band. Starts past the grace so a new game
  // counts overflow from its first step.
  private _ticksSinceNearLidMerge = OVERFLOW_IGNORE_MERGE_TICKS + 1;
  // The last dropped piece, until its top edge is below the lid (drop gating).
  private _dropId: number | null = null;
  // Dropped pieces still falling from the spawner: they have not yet touched another piece or the
  // floor. The lid rule ignores them; once they land they count like any other piece.
  private readonly _falling = new Set<number>();
  private readonly _pendingMerges = new Set<string>();
  private _accumulator = 0;
  // Consecutive fixed steps the last dropped piece has been settled with its top edge at or
  // above HARD_STOP_Y (the hard stop waits for HARD_STOP_SETTLE_TICKS of them for that piece).
  private _dropHardStopRun = 0;
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
      if (this._falling.size > 0) {
        const landsOn = (other: Matter.Body) => other.label === "piece" || other.label === "floor";
        if (landsOn(pair.bodyB)) this._falling.delete(pair.bodyA.id);
        if (landsOn(pair.bodyA)) this._falling.delete(pair.bodyB.id);
      }
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

    // Everything, rules included, runs once per fixed physics step (#3694): at 120 Hz (8.33 ms
    // frames) a step runs about every other frame, at 60 Hz one per frame, so every count below
    // means the same time at any frame rate.
    this._accumulator += deltaMs;
    let substeps = 0;
    while (this._accumulator >= FIXED_STEP_MS && substeps < MAX_SUBSTEPS && !this._gameOver) {
      Matter.Engine.update(this._engine, FIXED_STEP_MS);
      this._accumulator -= FIXED_STEP_MS;
      substeps++;
      this._fixedStep(events);
    }
    // Below 1000 / (MAX_SUBSTEPS * FIXED_STEP_MS) = 20 fps the loop cannot keep up: drop the
    // backlog instead of letting it grow (game time then runs slower than the wall clock).
    this._accumulator = Math.min(this._accumulator, MAX_SUBSTEPS * FIXED_STEP_MS);

    return { events };
  }

  /** The post-physics work of one fixed step: damping, guard rails, merges, the lid, combos. */
  private _fixedStep(events: EngineEvent[]): void {
    // Angular damping + guard rails (applied post-physics)
    for (const { body, tier } of this._pieces.values()) {
      const damped = body.angularVelocity * (1 - PIECE_ANGULAR_DAMPING);
      const clamped =
        Math.abs(damped) > MAX_ANGULAR_VELOCITY ? Math.sign(damped) * MAX_ANGULAR_VELOCITY : damped;
      Matter.Body.setAngularVelocity(body, clamped);

      const r = pieceRadius(PIECE_DEFS[tier]!);
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

    this._processMerges(events);
    this._applyLid(events);

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
  }

  /**
   * Process pending merges. _handleCollision guarantees tier < MAX_TIER for all
   * pairs in _pendingMerges, so newTier is always a valid PIECE_DEFS index.
   */
  private _processMerges(events: EngineEvent[]): void {
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
      // Merge grace (#3694): only a merge with a piece in the danger band counts.
      const highestTop =
        Math.min(pA.body.position.y, pB.body.position.y) - pieceRadius(PIECE_DEFS[tier]!);
      const nearLid = highestTop <= OVERFLOW_LINE_Y + DANGER_STACK_MARGIN;

      Matter.Composite.remove(this._world, pA.body);
      Matter.Composite.remove(this._world, pB.body);
      this._pieces.delete(idA);
      this._pieces.delete(idB);
      merged.add(idA);
      merged.add(idB);
      this._falling.delete(idA);
      this._falling.delete(idB);

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
      // The dropped piece merged: the gate follows the piece it became, which has landed.
      if (this._dropId === idA || this._dropId === idB) {
        this._dropId = newBody.id;
        this._dropHardStopRun = 0;
      }

      const scoreValue = PIECE_DEFS[newTier]!.scoreValue;
      this._score += scoreValue;
      events.push({ type: "merge", tierA: tier, tierB: tier, result: newTier, x: mx, y: my });
      events.push({ type: "score", delta: scoreValue, total: this._score });
      if (nearLid) this._ticksSinceNearLidMerge = 0;
      if (this._comboTicksLeft > 0) this._comboCount++;
    }
    this._pendingMerges.clear();
  }

  /** The lid (#3694): drop gate, hard stop and overflow count, once per fixed step. */
  private _applyLid(events: EngineEvent[]): void {
    // Drop gate: the last dropped piece has cleared once its top edge is at or below the lid
    // (or it is gone).
    if (this._dropId !== null) {
      const drop = this._pieces.get(this._dropId);
      if (!drop || drop.body.position.y - pieceRadius(PIECE_DEFS[drop.tier]!) >= OVERFLOW_LINE_Y) {
        this._dropId = null;
      }
    }

    this._ticksSinceNearLidMerge++;
    let overLid = false;
    let hardStop = false;
    let dropAtTop = false;
    for (const { body, tier } of this._pieces.values()) {
      // Still falling from the spawner: not part of the pile yet.
      if (this._falling.has(body.id)) continue;
      // In flight (bounced, popped, falling): not settled.
      if (body.speed > OVERFLOW_SETTLED_SPEED) continue;
      const top = body.position.y - pieceRadius(PIECE_DEFS[tier]!);
      if (top <= HARD_STOP_Y) {
        // A large piece spawns with its top edge above the canvas, so touching a pile that
        // reaches just under the lid can hand it to the pile while still near spawn height. The
        // last dropped piece must stay settled up there for HARD_STOP_SETTLE_TICKS to count.
        if (body.id === this._dropId) {
          dropAtTop = true;
          overLid = true;
          continue;
        }
        hardStop = true;
        break;
      }
      if (top < OVERFLOW_LINE_Y) overLid = true;
    }
    this._dropHardStopRun = dropAtTop ? this._dropHardStopRun + 1 : 0;
    if (this._dropHardStopRun >= HARD_STOP_SETTLE_TICKS) hardStop = true;

    if (hardStop) {
      this._overflowTicksCount = OVERFLOW_TICKS_THRESHOLD;
      this._endGame(events, "hardStop");
      return;
    }

    if (overLid && this._ticksSinceNearLidMerge > OVERFLOW_IGNORE_MERGE_TICKS) {
      this._overflowTicksCount++;
    } else {
      this._overflowTicksCount = 0;
    }

    if (this._overflowTicksCount >= OVERFLOW_TICKS_THRESHOLD) {
      this._endGame(events, "overflow");
    }
  }

  private _endGame(events: EngineEvent[], reason: GameOverReason): void {
    this._gameOver = true;
    this._dropId = null;
    events.push({ type: "gameOver", reason });
  }

  /**
   * Whether a new drop is allowed (#3694): not after game over, and not while the last dropped
   * piece is still over the lid. The screen gates taps on it; `drop()` itself does not, so the
   * dev panel and the test seams can still place pieces.
   */
  canDrop(): boolean {
    return !this._gameOver && this._dropId === null;
  }

  destroy(): void {
    Matter.Events.off(this._engine, "collisionStart", this._handleCollision);
    Matter.Engine.clear(this._engine);
    this._pieces.clear();
    this._falling.clear();
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
    // Treat restore like a near-lid merge just fired, once, so OVERFLOW_IGNORE_MERGE_TICKS of
    // grace applies while pieces settle into their saved positions. It is one grace per restore, the hard stop still applies, and the count starts when it ends.
    this._ticksSinceNearLidMerge = 0;
    this._dropId = null;
    this._dropHardStopRun = 0;
    this._falling.clear();
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
    // A saved piece whose top edge is over the lid and that touches no other piece was most
    // likely still in the air (saved right after a drop; velocities are not saved). Treat it as
    // falling again: it joins the pile on first contact, like any dropped piece, and is not
    // hard-stopped before that. One that touches the pile is part of it and counts at once.
    const placed = Array.from(this._pieces.values());
    const airborne = placed.filter(({ body, tier }) => {
      const r = pieceRadius(PIECE_DEFS[tier]!);
      if (body.position.y - r >= OVERFLOW_LINE_Y) return false;
      return !placed.some(
        (o) =>
          o.body !== body &&
          Math.hypot(o.body.position.x - body.position.x, o.body.position.y - body.position.y) <=
            r + pieceRadius(PIECE_DEFS[o.tier]!) + 2
      );
    });
    for (const { body } of airborne) this._falling.add(body.id);
    // Exactly one such piece is the last drop: the gate and the hard-stop settle run apply to it.
    if (airborne.length === 1) this._dropId = airborne[0]!.body.id;
  }

  drop(tier: number, x: number): void {
    if (this._gameOver) return;
    const def = PIECE_DEFS[tier];
    if (!def) return;
    const y = OVERFLOW_LINE_Y - pieceRadius(def) - DROP_SPAWN_INSET;
    const body = makeBody(def, x, y);
    Matter.Composite.add(this._world, body);
    this._pieces.set(body.id, { body, tier });
    // It spawns over the lid: the gate holds until it falls below, and the lid rule ignores it
    // until it lands (#3694).
    this._dropId = body.id;
    this._dropHardStopRun = 0;
    this._falling.add(body.id);
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
    return {
      pieces,
      score: this._score,
      gameOver: this._gameOver,
      dangerRatio: Math.min(1, this._overflowTicksCount / OVERFLOW_TICKS_THRESHOLD),
      canDrop: this.canDrop(),
    };
  }
}
