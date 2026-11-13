/**
 * Cascade physics spike (#3696): the game rules on a pluggable physics backend.
 *
 * A line-for-line port of `CascadeEngine` (`../../engine.ts`): the fixed-step accumulator, the
 * merge rule, the lid (overflow count, merge grace, hard stop and its settle run), the drop gate,
 * `dangerRatio`, combos and restore. Only the physics calls go through `PhysicsBackend`. With the
 * `currentMatterBackend` and `CURRENT_TUNING` it reproduces the production engine bit for bit
 * (`__tests__/candidates.test.ts` checks a whole sim game), so a difference between candidates
 * is the physics, never a rules drift.
 *
 * Two physics-side switches the production engine does not have:
 *   - `growInSteps`: a merged piece is created at its parents' radius and grows to its own
 *     over this many fixed steps (0 = full size at once, as today). The lid rule always uses the
 *     tier's full radius, as in production.
 *   - `guardRail`: "teleport" is today's rail (clamp into the bin, zero the velocity, emit
 *     `guardRailFired`). "observe" never moves a piece for a rail: it emits `guardRailFired` only
 *     when a piece's centre is more than `GUARD_RAIL_HORIZONTAL_TOLERANCE` (1 px) past today's
 *     rail on any side (a real penetration, not resting contact), and catches only a piece that
 *     has escaped the bin outright (counted in `stats.escapes`).
 * `stats` also counts, for every candidate, how often today's rail predicate held (strict).
 *
 * Bench switches (`bench`): `noMerges` / `noLid` keep a full board for the step-cost bench.
 */
import { PIECE_DEFS, MAX_TIER, type PieceDef } from "../../pieceDefs";
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
  PIECE_ANGULAR_DAMPING,
  MAX_ANGULAR_VELOCITY,
  FIXED_STEP_MS,
  MAX_SUBSTEPS,
  MERGE_POP_IMPULSE,
  GUARD_RAIL_HORIZONTAL_TOLERANCE,
  MAX_SPAWN_VELOCITY,
  COMBO_WINDOW_TICKS,
} from "../../constants";
import type {
  EngineEvent,
  GameOverReason,
  GameState,
  PieceSnapshot,
  StepResult,
} from "../../engine";
import type { ContactSide, PhysicsBackend } from "./backend";

const DROP_SPAWN_INSET = 5;

export interface CandidateTuning {
  growInSteps: number;
  guardRail: "teleport" | "observe";
  /**
   * Also merge two same-tier pieces whose circles are within this many px of touching, checked
   * once per fixed step (undefined: merge on a physics contact only, as today). A precise solver
   * can rest two same-tier pieces a fraction of a pixel apart, which looks like touching.
   */
  mergeGapPx?: number;
  /** Count same-tier near misses (an O(n^2) scan per step); the spike CLI turns it on. */
  measureNearMiss?: boolean;
  // ---- #3697 feel proposals (all optional; unset = the spike's behaviour) ----
  /** Radius per tier (default: the ladder via `PIECE_DEFS`). The lid, spawn and merges use it. */
  radius?: (tier: number) => number;
  /** Angular damping applied per fixed step on top of the backend (default 0.3, production). */
  angularDamping?: number;
  /** Upward kick of a merged piece, px per fixed step (default `MERGE_POP_IMPULSE`, 0.4). */
  mergePopImpulse?: number;
  /**
   * Create a merged piece where its FULL radius is inside the walls and above the floor (the
   * parents' midpoint, clamped), so growing in never pushes it into a wall.
   */
  growInClamp?: boolean;
  /**
   * Chain reach: a piece still growing in also merges with a same-tier piece that its full
   * radius would touch (gap at full size <= this many px), without waiting to grow into it.
   */
  chainReachPx?: number;
  /** Emit `{ type: "win" }` when a merge makes the capstone (#3699 is the real rule). */
  emitWin?: boolean;
  /**
   * Settle assist: a piece that is not falling from the spawner and moves slower than
   * `belowPxPerStep` loses `factor` of its velocity each fixed step. Gravity adds 0.69 px/step
   * per step, more than this takes from a slow piece, so nothing hovers: it only takes the
   * slow creep out of a resting pile, which is what keeps a board from calming after a chain.
   */
  restDamping?: { belowPxPerStep: number; factor: number };
}

export interface CandidateStats {
  fixedSteps: number;
  /** Steps x pieces where today's rail predicate held (it fires on any floor penetration). */
  railStrict: number;
  /** ...where a piece's centre was more than 1 px past today's rail on any side. */
  railBeyondTolerance: number;
  /** ...more than 3 px past it (a penetration a player can see). */
  railBeyond3Px: number;
  /** Deepest penetration past today's rail (px). */
  railMaxDepthPx: number;
  /** Pieces that left the bin (centre past a wall's or the floor's outer face): tunnelled. */
  escapes: number;
  maxPieces: number;
  /**
   * Steps x same-tier pairs (below the capstone) resting 0-2 px apart without touching: they
   * look like they touch, and on a contact-only merge rule they never merge.
   */
  nearMissPairSteps: number;
  /**
   * Chain merge latency: for a merged piece that, at full size, touches a same-tier piece when
   * it is made (gap <= 1 px), the fixed steps until it merges again. `chainMisses` counts those
   * that had not merged 60 steps (1 s) later.
   */
  chainLatencySteps: number[];
  chainMisses: number;
}

/** A merge product watched for a prompt chain merge is a miss after this many fixed steps. */
const CHAIN_WATCH_STEPS = 60;
/** A merge product "touches" a same-tier piece when the gap at full size is at most this (px). */
const CHAIN_TOUCH_PX = 1;

export interface BenchOptions {
  noMerges?: boolean;
  noLid?: boolean;
}

function pieceRadius(def: PieceDef): number {
  return def.shape.kind === "circle" ? def.shape.radius : def.shape.boundingRadius;
}

export class CandidateEngine {
  readonly stats: CandidateStats = {
    fixedSteps: 0,
    railStrict: 0,
    railBeyondTolerance: 0,
    railBeyond3Px: 0,
    railMaxDepthPx: 0,
    escapes: 0,
    maxPieces: 0,
    nearMissPairSteps: 0,
    chainLatencySteps: [],
    chainMisses: 0,
  };
  /** Merge products touching a same-tier piece when made: id -> step made. */
  private readonly _chainWatch = new Map<number, number>();
  private readonly _r: (tier: number) => number;
  private readonly _pieces = new Map<number, { tier: number }>();
  /** Pieces still growing in: id -> [startRadius, stepsDone]. */
  private readonly _growing = new Map<number, [number, number]>();
  private _score = 0;
  private _gameOver = false;
  private _overflowTicksCount = 0;
  private _ticksSinceNearLidMerge = OVERFLOW_IGNORE_MERGE_TICKS + 1;
  private _dropId: number | null = null;
  private readonly _falling = new Set<number>();
  private readonly _pendingMerges = new Set<string>();
  private _accumulator = 0;
  private _dropHardStopRun = 0;
  private _comboCount = 0;
  private _comboTicksLeft = 0;
  private _comboEmitted = false;

  constructor(
    private readonly _backend: PhysicsBackend,
    private readonly _tuning: CandidateTuning,
    private readonly _bench: BenchOptions = {}
  ) {
    this._r = _tuning.radius ?? ((tier) => pieceRadius(PIECE_DEFS[tier]!));
  }

  private readonly _onBegin = (a: ContactSide, b: ContactSide): void => {
    if (this._falling.size > 0) {
      const landsOn = (o: ContactSide) => o.kind === "piece" || o.kind === "floor";
      if (a.kind === "piece" && landsOn(b)) this._falling.delete(a.id);
      if (b.kind === "piece" && landsOn(a)) this._falling.delete(b.id);
    }
    if (a.kind !== "piece" || b.kind !== "piece" || this._bench.noMerges) return;
    const pA = this._pieces.get(a.id);
    const pB = this._pieces.get(b.id);
    if (!pA || !pB || pA.tier !== pB.tier || pA.tier >= MAX_TIER) return;
    const lo = a.id < b.id ? a.id : b.id;
    const hi = a.id < b.id ? b.id : a.id;
    this._pendingMerges.add(`${lo}:${hi}`);
  };

  start(): void {}

  step(deltaMs: number): StepResult {
    if (this._gameOver) return { events: [] };
    const events: EngineEvent[] = [];
    this._accumulator += deltaMs;
    let substeps = 0;
    while (this._accumulator >= FIXED_STEP_MS && substeps < MAX_SUBSTEPS && !this._gameOver) {
      this._backend.step(this._onBegin);
      this._accumulator -= FIXED_STEP_MS;
      substeps++;
      this._fixedStep(events);
    }
    this._accumulator = Math.min(this._accumulator, MAX_SUBSTEPS * FIXED_STEP_MS);
    return { events };
  }

  private _growIn(): void {
    const steps = this._tuning.growInSteps;
    for (const [id, g] of this._growing) {
      const piece = this._pieces.get(id);
      if (!piece) {
        this._growing.delete(id);
        continue;
      }
      g[1]++;
      const full = this._r(piece.tier);
      const r = g[1] >= steps ? full : g[0] + ((full - g[0]) * g[1]) / steps;
      this._backend.setRadius(id, r);
      if (this._tuning.growInClamp) {
        // Grow away from a wall or the floor: the piece fell a little while it was small, so
        // keep the grown circle inside (a shift of at most one grow step, never a velocity change).
        const b = this._backend.get(id);
        const x = Math.max(WALL_THICKNESS + r, Math.min(WORLD_WIDTH - WALL_THICKNESS - r, b.x));
        const y = Math.min(WORLD_HEIGHT - FLOOR_THICKNESS - r, b.y);
        if (x !== b.x || y !== b.y) this._backend.setPosition(id, x, y);
      }
      if (g[1] >= steps) this._growing.delete(id);
    }
  }

  // The guard rail in both modes, kept in one loop so "teleport" stays the production order.
  // eslint-disable-next-line complexity
  private _fixedStep(events: EngineEvent[]): void {
    this.stats.fixedSteps++;
    this.stats.maxPieces = Math.max(this.stats.maxPieces, this._pieces.size);
    if (this._growing.size > 0) this._growIn();
    const be = this._backend;
    for (const [id, { tier }] of this._pieces) {
      const body = be.get(id);
      const damped =
        body.angularVelocity * (1 - (this._tuning.angularDamping ?? PIECE_ANGULAR_DAMPING));
      const rest = this._tuning.restDamping;
      if (
        rest &&
        !body.isSleeping &&
        body.speed > 0 &&
        body.speed < rest.belowPxPerStep &&
        !this._falling.has(id)
      ) {
        be.setVelocity(id, body.vx * (1 - rest.factor), body.vy * (1 - rest.factor));
      }
      const clamped =
        Math.abs(damped) > MAX_ANGULAR_VELOCITY ? Math.sign(damped) * MAX_ANGULAR_VELOCITY : damped;
      be.setAngularVelocity(id, clamped);

      // The collider's radius right now: a piece still growing in is measured at its current
      // size (#3697; the spike measured it at full size, which counted part of a grow-in near a
      // wall or the floor as penetration). Equal to the full radius without grow-in.
      const r = this._growing.has(id) ? this.currentRadius(id) : this._r(tier);
      const minX = WALL_THICKNESS + r;
      const maxX = WORLD_WIDTH - WALL_THICKNESS - r;
      const maxY = WORLD_HEIGHT - FLOOR_THICKNESS - r;
      const bx = body.x;
      const by = body.y;
      const strict =
        !isFinite(bx) ||
        !isFinite(by) ||
        bx < minX - GUARD_RAIL_HORIZONTAL_TOLERANCE ||
        bx > maxX + GUARD_RAIL_HORIZONTAL_TOLERANCE ||
        by > maxY;
      if (strict) this.stats.railStrict++;
      const depth =
        isFinite(bx) && isFinite(by) ? Math.max(0, minX - bx, bx - maxX, by - maxY) : Infinity;
      const beyond = depth > GUARD_RAIL_HORIZONTAL_TOLERANCE;
      if (depth > 3) this.stats.railBeyond3Px++;
      if (isFinite(depth)) this.stats.railMaxDepthPx = Math.max(this.stats.railMaxDepthPx, depth);
      if (beyond) this.stats.railBeyondTolerance++;

      if (this._tuning.guardRail === "teleport") {
        if (strict) {
          be.setPosition(
            id,
            Math.max(minX, Math.min(maxX, isFinite(bx) ? bx : WORLD_WIDTH / 2)),
            Math.min(maxY, isFinite(by) ? by : WORLD_HEIGHT / 2)
          );
          be.setVelocity(id, 0, 0);
          events.push({ type: "guardRailFired", reason: "outOfBounds", bodyId: id });
        }
        continue;
      }
      if (beyond) events.push({ type: "guardRailFired", reason: "beyondTolerance", bodyId: id });
      const escaped =
        !isFinite(bx) ||
        !isFinite(by) ||
        bx < WALL_THICKNESS - r ||
        bx > WORLD_WIDTH - WALL_THICKNESS + r ||
        by > WORLD_HEIGHT - FLOOR_THICKNESS + r;
      if (escaped) {
        this.stats.escapes++;
        be.setPosition(
          id,
          Math.max(minX, Math.min(maxX, isFinite(bx) ? bx : WORLD_WIDTH / 2)),
          Math.min(maxY, isFinite(by) ? by : WORLD_HEIGHT / 2)
        );
        be.setVelocity(id, 0, 0);
      }
    }

    if (this._tuning.mergeGapPx !== undefined || this._tuning.measureNearMiss) {
      this._scanSameTierPairs();
    }
    if (this._tuning.chainReachPx !== undefined && this._growing.size > 0) this._chainReach();
    if (this._chainWatch.size > 0) {
      for (const [id, made] of this._chainWatch) {
        if (this.stats.fixedSteps - made > CHAIN_WATCH_STEPS) {
          this.stats.chainMisses++;
          this._chainWatch.delete(id);
        }
      }
    }
    this._processMerges(events);
    if (!this._bench.noLid) this._applyLid(events);

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

  /** Same-tier pairs within `mergeGapPx` join the pending merges; near misses are counted. */
  private _scanSameTierPairs(): void {
    const be = this._backend;
    const list = Array.from(this._pieces, ([id, { tier }]) => ({ id, tier, ...be.get(id) }));
    const gapPx = this._tuning.mergeGapPx;
    for (let i = 0; i < list.length; i++) {
      const a = list[i]!;
      if (a.tier >= MAX_TIER) continue;
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j]!;
        if (b.tier !== a.tier) continue;
        const gap =
          Math.hypot(a.x - b.x, a.y - b.y) - this.currentRadius(a.id) - this.currentRadius(b.id);
        if (gap > 0 && gap <= 2 && a.speed < 1 && b.speed < 1) this.stats.nearMissPairSteps++;
        if (gapPx !== undefined && gap <= gapPx && !this._bench.noMerges) {
          const lo = a.id < b.id ? a.id : b.id;
          const hi = a.id < b.id ? b.id : a.id;
          this._pendingMerges.add(`${lo}:${hi}`);
        }
      }
    }
  }

  /** Same-tier pieces a growing piece would touch at full size join the pending merges. */
  private _chainReach(): void {
    const be = this._backend;
    const reach = this._tuning.chainReachPx ?? 0;
    for (const id of this._growing.keys()) {
      const piece = this._pieces.get(id);
      if (!piece || piece.tier >= MAX_TIER) continue;
      const g = be.get(id);
      const full = this._r(piece.tier);
      for (const [oid, other] of this._pieces) {
        if (oid === id || other.tier !== piece.tier) continue;
        const o = be.get(oid);
        const gap = Math.hypot(g.x - o.x, g.y - o.y) - full - this.currentRadius(oid);
        if (gap <= reach) {
          this._pendingMerges.add(id < oid ? `${id}:${oid}` : `${oid}:${id}`);
        }
      }
    }
  }

  /** True if a piece of `tier` with its full radius at (x, y) touches another of that tier. */
  private _touchesSameTier(tier: number, x: number, y: number, self: number): boolean {
    const r = this._r(tier);
    for (const [oid, other] of this._pieces) {
      if (oid === self || other.tier !== tier) continue;
      const o = this._backend.get(oid);
      if (Math.hypot(x - o.x, y - o.y) - r - this.currentRadius(oid) <= CHAIN_TOUCH_PX) return true;
    }
    return false;
  }

  /** Where a merge makes its piece: the parents' midpoint, clamped inside with `growInClamp`. */
  private _mergePoint(newTier: number, mx: number, my: number): [number, number] {
    if (!this._tuning.growInClamp) return [mx, my];
    const full = this._r(newTier);
    return [
      Math.max(WALL_THICKNESS + full, Math.min(WORLD_WIDTH - WALL_THICKNESS - full, mx)),
      Math.min(WORLD_HEIGHT - FLOOR_THICKNESS - full, my),
    ];
  }

  /** A watched merge product merged again: record its chain latency. */
  private _unwatchChain(id: number): void {
    const made = this._chainWatch.get(id);
    if (made === undefined) return;
    this.stats.chainLatencySteps.push(this.stats.fixedSteps - made);
    this._chainWatch.delete(id);
  }

  /** Watch a new merge product for a prompt chain merge; emit the win for a capstone. */
  private _afterMerge(id: number, tier: number, x: number, y: number, events: EngineEvent[]): void {
    if (tier < MAX_TIER && this._touchesSameTier(tier, x, y, id)) {
      this._chainWatch.set(id, this.stats.fixedSteps);
    }
    if (tier === MAX_TIER && this._tuning.emitWin) {
      // Not an `EngineEvent` yet (#3699); the harness picks `{ type: "win" }` up.
      events.push({ type: "win" } as unknown as EngineEvent);
    }
  }

  private _processMerges(events: EngineEvent[]): void {
    const merged = new Set<number>();
    const be = this._backend;
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
      const a = be.get(idA);
      const b = be.get(idB);
      const [mx, my] = this._mergePoint(newTier, (a.x + b.x) / 2, (a.y + b.y) / 2);
      this._unwatchChain(idA);
      this._unwatchChain(idB);
      const highestTop = Math.min(a.y, b.y) - this._r(tier);
      const nearLid = highestTop <= OVERFLOW_LINE_Y + DANGER_STACK_MARGIN;

      be.removePiece(idA);
      be.removePiece(idB);
      this._pieces.delete(idA);
      this._pieces.delete(idB);
      this._growing.delete(idA);
      this._growing.delete(idB);
      merged.add(idA);
      merged.add(idB);
      this._falling.delete(idA);
      this._falling.delete(idB);

      const mergedVx = (a.vx + b.vx) / 2;
      const mergedVy = (a.vy + b.vy) / 2 - (this._tuning.mergePopImpulse ?? MERGE_POP_IMPULSE);
      const startR = this._tuning.growInSteps > 0 ? this._r(tier) : this._r(newTier);
      const newId = be.addPiece(newTier, mx, my, startR);
      be.setVelocity(
        newId,
        Math.max(-MAX_SPAWN_VELOCITY, Math.min(MAX_SPAWN_VELOCITY, mergedVx)),
        Math.max(-MAX_SPAWN_VELOCITY, Math.min(MAX_SPAWN_VELOCITY, mergedVy))
      );
      this._pieces.set(newId, { tier: newTier });
      if (this._tuning.growInSteps > 0) this._growing.set(newId, [startR, 0]);
      this._afterMerge(newId, newTier, mx, my, events);
      if (this._dropId === idA || this._dropId === idB) {
        this._dropId = newId;
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

  private _applyLid(events: EngineEvent[]): void {
    const be = this._backend;
    if (this._dropId !== null) {
      const drop = this._pieces.get(this._dropId);
      if (!drop || be.get(this._dropId).y - this._r(drop.tier) >= OVERFLOW_LINE_Y) {
        this._dropId = null;
      }
    }

    this._ticksSinceNearLidMerge++;
    let overLid = false;
    let hardStop = false;
    let dropAtTop = false;
    for (const [id, { tier }] of this._pieces) {
      if (this._falling.has(id)) continue;
      const body = be.get(id);
      if (body.speed > OVERFLOW_SETTLED_SPEED) continue;
      const top = body.y - this._r(tier);
      if (top <= HARD_STOP_Y) {
        if (id === this._dropId) {
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

  canDrop(): boolean {
    return !this._gameOver && this._dropId === null;
  }

  destroy(): void {
    this._backend.destroy();
    this._pieces.clear();
    this._growing.clear();
    this._falling.clear();
    this._chainWatch.clear();
  }

  restore(pieces: ReadonlyArray<{ tier: number; x: number; y: number }>, score: number): void {
    for (const id of this._pieces.keys()) this._backend.removePiece(id);
    this._pieces.clear();
    this._growing.clear();
    this._chainWatch.clear();
    this._pendingMerges.clear();
    this._score = score;
    this._gameOver = false;
    this._overflowTicksCount = 0;
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
      const id = this._backend.addPiece(tier, x, y, this._r(tier));
      this._pieces.set(id, { tier });
    }
    const placed = Array.from(this._pieces, ([id, { tier }]) => ({
      id,
      tier,
      ...this._backend.get(id),
    }));
    const airborne = placed.filter((p) => {
      const r = this._r(p.tier);
      if (p.y - r >= OVERFLOW_LINE_Y) return false;
      return !placed.some(
        (o) => o.id !== p.id && Math.hypot(o.x - p.x, o.y - p.y) <= r + this._r(o.tier) + 2
      );
    });
    for (const p of airborne) this._falling.add(p.id);
    if (airborne.length === 1) this._dropId = airborne[0]!.id;
  }

  drop(tier: number, x: number): void {
    if (this._gameOver) return;
    const def = PIECE_DEFS[tier];
    if (!def) return;
    const y = OVERFLOW_LINE_Y - this._r(tier) - DROP_SPAWN_INSET;
    const id = this._backend.addPiece(tier, x, y, this._r(tier));
    this._pieces.set(id, { tier });
    this._dropId = id;
    this._dropHardStopRun = 0;
    this._falling.add(id);
    this._comboCount = 0;
    this._comboTicksLeft = COMBO_WINDOW_TICKS;
    this._comboEmitted = false;
  }

  /** The radius each piece has right now (smaller while it grows in), for the clip renderer. */
  currentRadius(id: number): number {
    const piece = this._pieces.get(id);
    if (!piece) return 0;
    const g = this._growing.get(id);
    const full = this._r(piece.tier);
    if (!g) return full;
    return g[0] + ((full - g[0]) * g[1]) / this._tuning.growInSteps;
  }

  getState(): GameState {
    const pieces: PieceSnapshot[] = Array.from(this._pieces, ([id, { tier }]) => {
      const b = this._backend.get(id);
      return {
        id,
        tier,
        x: b.x,
        y: b.y,
        vx: b.vx,
        vy: b.vy,
        angle: b.angle,
        shapeKind: PIECE_DEFS[tier]!.shape.kind,
        isSleeping: b.isSleeping,
      };
    });
    return {
      pieces,
      score: this._score,
      gameOver: this._gameOver,
      dangerRatio: Math.min(1, this._overflowTicksCount / OVERFLOW_TICKS_THRESHOLD),
      canDrop: this.canDrop(),
    };
  }
}
