/**
 * Cascade engine (#3693, physics #3697): the rules of the merge game, on planck.js.
 *
 * Headless: no React, no AsyncStorage, no rendering. The screen steps it from a RAF loop
 * (`step(deltaMs)`), calls `drop(tier, x)` for a tap, and reads `getState()` back; scoring, merges,
 * game over and the win are decided here, from `pieceDefs.ts`, `tiers.ts` and `constants.ts`. The
 * planck world, the bin and the unit conversions are `physicsWorld.ts`.
 *
 * Determinism and RNG (docs/ARCHITECTURE.md section 3.2, #2985 / #2999; replays #3858):
 *   - This module holds no RNG slot and calls no `Math.random`, and neither does planck's solver.
 *     Time enters only as the `deltaMs` passed to `step`, consumed in fixed `FIXED_STEP_MS`
 *     substeps (at most `MAX_SUBSTEPS`), so the same frame deltas replay the same board, at 60
 *     and at 120 Hz (each rate against itself; the two rates match within a frame, not bit for
 *     bit). A long frame is clamped by the caller (100 ms) and by `MAX_SUBSTEPS`, so replays must
 *     feed the same deltas. Bit-exact replay holds on ONE JS engine only: planck uses
 *     `Math.sin` / `Math.cos` / `Math.atan2`, which can differ in the last bit between Hermes,
 *     JavaScriptCore and V8, so a replay on another device or on a server can diverge on a
 *     chaotic pile.
 *   - Allocation: this module's own step path allocates nothing per piece; planck's internals do
 *     (about 0.4 KB per frame settled, about 2 KB with 90 awake pieces, measured in review). The
 *     device bench (`stepBench.ts`, the dev panel) is the check.
 *   - The only randomness in a game is which tier comes next. It lives in `spawnSelector.ts` and
 *     `pieceQueue.ts`, which take the source as a parameter; the screen passes a seeded one when a
 *     test seeds the queue (`__cascade_setSeed`). Live play uses `Math.random`.
 *   - Piece ids count up from 1 per engine (a new game starts again at 1). They are not saved
 *     (`storage.ts` keeps tier and position only).
 *   - A restored game (`restore(pieces, score)`) re-creates bodies from saved tier and position,
 *     at rest: velocities are not saved.
 *
 * Merges (#3697, the owner's "3 lively" tuning; docs/games/cascade.md#physics):
 *   - Two same-tier pieces merge when they touch (a planck contact begins) or when their circles
 *     are within `MERGE_GAP_PX` of touching at the end of a fixed step (Box2D can rest two pieces a
 *     fraction of a pixel apart). Two capstones join the same paths, and are the win (below).
 *   - Grow-in: the merged piece is made at its parents' midpoint, clamped so its FULL circle is
 *     inside the walls and above the floor, at its parents' radius, and grows to its own over
 *     `GROW_IN_STEPS` fixed steps; each step keeps the grown circle inside (a shift of at most one
 *     grow step, never a velocity change). Its neighbours are eased aside instead of being shot
 *     out by a full-size piece appearing on top of them.
 *   - Chain reach: a piece still growing in also merges with a same-tier piece its full radius
 *     would touch (`CHAIN_REACH_PX`), without waiting to grow into it, so a chain runs a step at a
 *     time.
 *   - The win (#3904): two capstones that touch (contact, gap scan or chain reach, as any merge)
 *     both burst (are removed, no `merge` event), the pair scores 2 x the capstone, and
 *     `{ type: "win", x, y, id }` follows the `score` event, at their midpoint with the lower id.
 *     Making a single capstone is an ordinary merge. The win ends the play: from that step on
 *     `canDrop()` is false, `drop()` does nothing, no merge or lid rule runs (no `gameOver`
 *     follows a win) and the score is final; the physics still steps, so the pile settles into
 *     the hole while #3699's celebration and result card show. `restore()` starts a new game.
 *   - The lid rule, the merge grace and the drop gate always use a tier's FULL radius.
 *
 * Combo window: `COMBO_WINDOW_TICKS` (120) is counted in fixed steps like the lid, so it is 2 s
 * of simulated time at any frame rate.
 *
 * Game over, "the lid" (#3694; docs/games/cascade.md#game-over-the-lid). Everything below is
 * counted in fixed physics steps, inside the substep loop, so 60 and 120 Hz play equivalently:
 *   - Overflow: a SETTLED piece (speed <= `OVERFLOW_SETTLED_SPEED` px per step, and not a piece
 *     still falling from the spawner) whose TOP edge is above `OVERFLOW_LINE_Y` counts. When one
 *     does on `OVERFLOW_TICKS_THRESHOLD` steps in a row, the game ends.
 *   - Merge grace: only a merge involving a piece in the danger band resets and pauses the count
 *     (`OVERFLOW_IGNORE_MERGE_TICKS`). Merges lower in the bin do nothing.
 *   - Hard stop: a settled piece whose top edge reaches `HARD_STOP_Y` (the canvas top) ends the
 *     game at once. The one exception is the last dropped piece: it must stay settled up there
 *     for `HARD_STOP_SETTLE_TICKS` steps (0.5 s) first.
 *   - Drop gating: `canDrop()` is false until the last dropped piece is below the lid (its top
 *     edge at or under the line). It cannot deadlock: once that piece lands on something it is an
 *     ordinary piece, so if it rests over the lid the overflow rule ends the game.
 *   - `dangerRatio` (state) = overflow count / threshold, 0..1, for the screen's countdown.
 *
 * Guard rail: none in normal play. The thick walls keep every piece in the bin, so nothing is
 * ever teleported. The one safety left is for a piece that has escaped the bin outright (its
 * centre past a wall's or the floor's inner face by more than its radius, or a non-finite
 * position): it is put back inside, stopped, and `guardRailFired` ("escaped") is emitted, which
 * the screen logs in dev builds and the sim gate requires to be 0.
 */
import type { Body, Fixture } from "planck";
import { createSeededRng, type RandomSource } from "../_shared/seededRng";
import { PIECE_DEFS, MAX_TIER } from "./pieceDefs";
import { TIERS, tierRadius } from "./tiers";
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
  MAX_SPAWN_VELOCITY,
  COMBO_WINDOW_TICKS,
  GROW_IN_STEPS,
  MERGE_GAP_PX,
  CHAIN_REACH_PX,
  PX_PER_M,
} from "./constants";
import {
  M_S_TO_PX_STEP,
  STEP_S,
  createPhysicsWorld,
  setPositionPx,
  setRadiusPx,
  setVelocityPx,
  type FixtureTag,
  type PhysicsWorld,
} from "./physicsWorld";

// Pixels above the overflow line where a newly dropped piece's centroid starts.
const DROP_SPAWN_INSET = 5;
// A drop's x is nudged by up to this many px either way (seeded, before the wall clamp). Without
// it, pieces dropped at one x land dead centre on each other, where there is no lateral force,
// and stack into a column that never topples.
const DROP_NUDGE_PX = 0.4;
const DEFAULT_SEED = 0x2545f491;
const FLOOR_TOP = WORLD_HEIGHT - FLOOR_THICKNESS;

export interface EngineConfig {
  /**
   * Step-cost bench only (`stepBench.ts`, the dev panel): `noMerges` / `noLid` keep a full board
   * of small pieces so a step can be timed with ~90 of them. `noDropNudge` (lid tests) lands a drop
   * dead centre on a restored column, which the nudge would roll off. Never set in a game.
   */
  bench?: { noMerges?: boolean; noLid?: boolean; noDropNudge?: boolean };
  /**
   * Seeds the engine's own RNG, which draws the drop nudge (`DROP_NUDGE_PX`). The same seed and
   * the same drops replay bit-for-bit. Omitted: a fixed default seed, so still deterministic.
   */
  seed?: number;
}

export interface PieceSnapshot {
  id: number;
  tier: number;
  x: number;
  y: number;
  /** Velocity, px per fixed step. */
  vx: number;
  vy: number;
  angle: number;
  shapeKind: "circle" | "convex";
  isSleeping: boolean;
  /** Collider radius / the tier's radius: below 1 while a merged piece grows in, else 1. */
  scale: number;
}

export type EngineEvent =
  | {
      type: "merge";
      tierA: number;
      tierB: number;
      result: number;
      x: number;
      y: number;
      /** The merged piece's id, and its two parents' (for the sim's chain timing and replays). */
      id: number;
      parentIds: readonly [number, number];
    }
  | { type: "score"; delta: number; total: number }
  | { type: "gameOver"; reason: GameOverReason }
  | { type: "guardRailFired"; reason: string; bodyId: number }
  | { type: "cascadeCombo"; count: number }
  /**
   * Two capstones touched (#3904): both burst. Where (their midpoint) and the lower of their ids.
   * Emitted once per game; play ends with it (#3699 builds the celebration and result on it).
   */
  | { type: "win"; x: number; y: number; id: number };

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

/**
 * One live piece; it is also the planck fixture's user data, so a contact names it directly.
 * `x`, `y` and `speed` are read from the body once per fixed step (`_readBodies`).
 */
interface PieceEntry {
  readonly id: number;
  readonly tier: number;
  body: Body;
  fixture: Fixture;
  /** The tier's radius (px): what the lid, the gate and the spawn use. */
  readonly full: number;
  /** The collider's radius right now (px): smaller than `full` while growing in. */
  r: number;
  /** Grow-in: the radius it started at, and the steps done (`GROW_IN_STEPS` = done). */
  growFrom: number;
  growStep: number;
  /** Still falling from the spawner: not yet touched another piece or the floor. */
  falling: boolean;
  /**
   * #2960: true once the post-physics pass has run on the body while it was asleep: a sleeping
   * body does not move, so later steps skip it until it wakes.
   */
  railsAtRest: boolean;
  x: number;
  y: number;
  /** |velocity|, px per fixed step. */
  speed: number;
}

/** Writes one piece into `out` (a new snapshot when `out` is undefined) and returns it. */
function writeSnapshot(out: PieceSnapshot | undefined, e: PieceEntry): PieceSnapshot {
  const snap: PieceSnapshot = out ?? {
    id: 0,
    tier: 0,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    angle: 0,
    shapeKind: "circle",
    isSleeping: false,
    scale: 1,
  };
  const p = e.body.getPosition();
  const v = e.body.getLinearVelocity();
  snap.id = e.id;
  snap.tier = e.tier;
  snap.x = p.x * PX_PER_M;
  snap.y = p.y * PX_PER_M;
  snap.vx = v.x * M_S_TO_PX_STEP;
  snap.vy = v.y * M_S_TO_PX_STEP;
  snap.angle = e.body.getAngle();
  snap.shapeKind = "circle";
  snap.isSleeping = !e.body.isAwake();
  snap.scale = e.r / e.full;
  return snap;
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

export class CascadeEngine {
  private readonly _physics: PhysicsWorld<PieceEntry>;
  private readonly _bench: NonNullable<EngineConfig["bench"]>;
  /** Live pieces in creation order (the order `getState` lists them). */
  private readonly _pieces = new Map<number, PieceEntry>();
  /** Live pieces by tier, for the same-tier scans (merge gap, chain reach). */
  private readonly _byTier: PieceEntry[][] = TIERS.map(() => []);
  /** Pieces still growing in. */
  private readonly _growing: PieceEntry[] = [];
  /** Merges waiting for the end of the step: pairs (a, b), in the order they were found. */
  private readonly _pendA: PieceEntry[] = [];
  private readonly _pendB: PieceEntry[] = [];
  private _fallingCount = 0;
  private _nextId = 1;
  private _score = 0;
  private _gameOver = false;
  /** Two capstones touched (#3904): no more drops, merges or lid. */
  private _won = false;
  private _overflowTicksCount = 0;
  // Fixed steps since the last merge in the danger band. Starts past the grace so a new game
  // counts overflow from its first step.
  private _ticksSinceNearLidMerge = OVERFLOW_IGNORE_MERGE_TICKS + 1;
  // The last dropped piece, until its top edge is below the lid (drop gating).
  private _drop: PieceEntry | null = null;
  private _accumulator = 0;
  // Consecutive fixed steps the last dropped piece has been settled with its top edge at or
  // above HARD_STOP_Y (the hard stop waits for HARD_STOP_SETTLE_TICKS of them for that piece).
  private _dropHardStopRun = 0;
  private _comboCount = 0;
  private _comboTicksLeft = 0;
  private _comboEmitted = false;

  private _rng: RandomSource = createSeededRng(DEFAULT_SEED);

  constructor(config: EngineConfig = {}) {
    this._bench = config.bench ?? {};
    if (config.seed !== undefined) this.seed(config.seed);
    this._physics = createPhysicsWorld<PieceEntry>(this._onBegin);
  }

  /** A planck contact began (inside a world step): landing, and same-tier touches. */
  private readonly _onBegin = (a: FixtureTag<PieceEntry>, b: FixtureTag<PieceEntry>): void => {
    if (this._fallingCount > 0) {
      // A piece has landed once it touches another piece or the floor (not a wall).
      if (typeof a === "object" && b !== "wall") this._land(a);
      if (typeof b === "object" && a !== "wall") this._land(b);
    }
    if (typeof a !== "object" || typeof b !== "object") return;
    if (a.tier === b.tier) this._queueMerge(a, b);
  };

  private _land(e: PieceEntry): void {
    if (!e.falling) return;
    e.falling = false;
    this._fallingCount--;
  }

  private _queueMerge(a: PieceEntry, b: PieceEntry): void {
    if (this._bench.noMerges || this._won) return;
    const lo = a.id < b.id ? a : b;
    const hi = a.id < b.id ? b : a;
    for (let i = 0; i < this._pendA.length; i++) {
      if (this._pendA[i] === lo && this._pendB[i] === hi) return;
    }
    this._pendA.push(lo);
    this._pendB.push(hi);
  }

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
      this._physics.step();
      this._accumulator -= FIXED_STEP_MS;
      substeps++;
      this._fixedStep(events);
    }
    // Below 1000 / (MAX_SUBSTEPS * FIXED_STEP_MS) = 20 fps the loop cannot keep up: drop the
    // backlog instead of letting it grow (game time then runs slower than the wall clock).
    this._accumulator = Math.min(this._accumulator, MAX_SUBSTEPS * FIXED_STEP_MS);

    return { events };
  }

  /** The post-physics work of one fixed step: grow-in, the safety, merges, the lid, combos. */
  private _fixedStep(events: EngineEvent[]): void {
    if (this._growing.length > 0) this._growIn();
    this._readBodies(events);
    if (!this._bench.noMerges && !this._won) {
      this._scanMergeGaps();
      if (this._growing.length > 0) this._chainReach();
    }
    this._processMerges(events);
    if (!this._bench.noLid && !this._won) this._applyLid(events);

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

  /** One grow-in step for every growing piece, keeping the grown circle inside the bin. */
  private _growIn(): void {
    const growing = this._growing;
    let keep = 0;
    for (let i = 0; i < growing.length; i++) {
      const e = growing[i]!;
      e.growStep++;
      const r =
        e.growStep >= GROW_IN_STEPS
          ? e.full
          : e.growFrom + ((e.full - e.growFrom) * e.growStep) / GROW_IN_STEPS;
      e.r = r;
      setRadiusPx(e.body, e.fixture, r);
      // It fell a little while it was small: keep the grown circle off the walls and the floor
      // (a shift of at most one grow step, never a velocity change).
      const p = e.body.getPosition();
      const x = p.x * PX_PER_M;
      const y = p.y * PX_PER_M;
      const cx = clamp(x, WALL_THICKNESS + r, WORLD_WIDTH - WALL_THICKNESS - r);
      const cy = Math.min(FLOOR_TOP - r, y);
      if (cx !== x || cy !== y) setPositionPx(e.body, cx, cy);
      if (e.growStep < GROW_IN_STEPS) growing[keep++] = e;
    }
    growing.length = keep;
  }

  /**
   * Reads every body once (position, speed), clamps its spin, and catches an escaped piece.
   *
   * #2960: a body that was already checked while asleep is skipped. planck does not integrate a
   * sleeping body, so its position cannot change until it wakes and it cannot newly escape. The
   * first sleeping step still runs the full pass: the step it fell asleep in also moved it.
   */
  private _readBodies(events: EngineEvent[]): void {
    for (const e of this._pieces.values()) {
      const body = e.body;
      const awake = body.isAwake();
      if (!awake) {
        if (e.railsAtRest) continue;
        e.railsAtRest = true;
      } else {
        e.railsAtRest = false;
      }
      const p = body.getPosition();
      const v = body.getLinearVelocity();
      e.x = p.x * PX_PER_M;
      e.y = p.y * PX_PER_M;
      e.speed = Math.hypot(v.x, v.y) * M_S_TO_PX_STEP;

      if (awake) {
        const w = body.getAngularVelocity() * STEP_S; // rad per fixed step
        const damped = w * (1 - PIECE_ANGULAR_DAMPING);
        const clamped =
          Math.abs(damped) > MAX_ANGULAR_VELOCITY
            ? Math.sign(damped) * MAX_ANGULAR_VELOCITY
            : damped;
        if (clamped !== w) body.setAngularVelocity(clamped / STEP_S);
      }

      if (this._escaped(e)) this._putBack(e, events);
    }
  }

  private _escaped(e: PieceEntry): boolean {
    return (
      !Number.isFinite(e.x) ||
      !Number.isFinite(e.y) ||
      e.x < WALL_THICKNESS - e.r ||
      e.x > WORLD_WIDTH - WALL_THICKNESS + e.r ||
      e.y > FLOOR_TOP + e.r
    );
  }

  /** The last-resort safety: a piece that left the bin is put back inside and stopped. */
  private _putBack(e: PieceEntry, events: EngineEvent[]): void {
    const x = clamp(
      Number.isFinite(e.x) ? e.x : WORLD_WIDTH / 2,
      WALL_THICKNESS + e.r,
      WORLD_WIDTH - WALL_THICKNESS - e.r
    );
    const y = Math.min(FLOOR_TOP - e.r, Number.isFinite(e.y) ? e.y : WORLD_HEIGHT / 2);
    setPositionPx(e.body, x, y);
    setVelocityPx(e.body, 0, 0);
    e.x = x;
    e.y = y;
    e.speed = 0;
    events.push({ type: "guardRailFired", reason: "escaped", bodyId: e.id });
  }

  /** Same-tier pairs whose circles are within `MERGE_GAP_PX` join the pending merges. */
  private _scanMergeGaps(): void {
    for (let tier = 0; tier <= MAX_TIER; tier++) {
      const list = this._byTier[tier]!;
      const n = list.length;
      if (n < 2) continue;
      for (let i = 0; i < n; i++) {
        const a = list[i]!;
        for (let j = i + 1; j < n; j++) {
          const b = list[j]!;
          const reach = a.r + b.r + MERGE_GAP_PX;
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          if (dx * dx + dy * dy <= reach * reach) this._queueMerge(a, b);
        }
      }
    }
  }

  /** Same-tier pieces a growing piece would touch at full size join the pending merges. */
  private _chainReach(): void {
    for (const g of this._growing) {
      for (const o of this._byTier[g.tier]!) {
        if (o === g) continue;
        const reach = g.full + o.r + CHAIN_REACH_PX;
        const dx = g.x - o.x;
        const dy = g.y - o.y;
        if (dx * dx + dy * dy <= reach * reach) this._queueMerge(g, o);
      }
    }
  }

  private _addPiece(tier: number, x: number, y: number, radius: number): PieceEntry {
    const e: PieceEntry = {
      id: this._nextId++,
      tier,
      // Set right below: the entry is the fixture's user data, so it exists first.
      body: null as unknown as Body,
      fixture: null as unknown as Fixture,
      full: tierRadius(tier),
      r: radius,
      growFrom: radius,
      growStep: GROW_IN_STEPS,
      falling: false,
      railsAtRest: false,
      x,
      y,
      speed: 0,
    };
    e.body = this._physics.addPiece(e, x, y, radius, PIECE_DEFS[tier]!.density);
    e.fixture = e.body.getFixtureList()!;
    this._pieces.set(e.id, e);
    this._byTier[tier]!.push(e);
    return e;
  }

  private _removePiece(e: PieceEntry): void {
    this._physics.removePiece(e.body);
    this._pieces.delete(e.id);
    const list = this._byTier[e.tier]!;
    const i = list.indexOf(e);
    if (i >= 0) list.splice(i, 1);
    const g = this._growing.indexOf(e);
    if (g >= 0) this._growing.splice(g, 1);
    this._land(e);
  }

  /**
   * Process pending merges in the order they were found. A piece takes part in one merge per
   * step; a capstone pair is the win, after which no other pending merge runs.
   */
  private _processMerges(events: EngineEvent[]): void {
    const pendA = this._pendA;
    const pendB = this._pendB;
    for (let i = 0; i < pendA.length; i++) {
      const a = pendA[i]!;
      const b = pendB[i]!;
      if (this._won) break;
      if (!this._pieces.has(a.id) || !this._pieces.has(b.id)) continue;
      if (a.tier === MAX_TIER) this._winPair(a, b, events);
      else this._merge(a, b, events);
    }
    pendA.length = 0;
    pendB.length = 0;
  }

  /**
   * The win (#3904): two touching capstones both burst (are removed, so the pile drops into the
   * hole they leave), the pair scores twice the capstone, and `win` is emitted at their midpoint
   * with the lower id. Play ends here (`_won`).
   */
  private _winPair(a: PieceEntry, b: PieceEntry, events: EngineEvent[]): void {
    const pa = a.body.getPosition();
    const pb = b.body.getPosition();
    const x = ((pa.x + pb.x) / 2) * PX_PER_M;
    const y = ((pa.y + pb.y) / 2) * PX_PER_M;
    const id = Math.min(a.id, b.id);
    this._removePiece(a);
    this._removePiece(b);
    this._won = true;
    this._drop = null;
    this._overflowTicksCount = 0;
    const delta = 2 * PIECE_DEFS[MAX_TIER]!.scoreValue;
    this._score += delta;
    events.push({ type: "score", delta, total: this._score });
    events.push({ type: "win", x, y, id });
  }

  private _merge(a: PieceEntry, b: PieceEntry, events: EngineEvent[]): void {
    const tier = a.tier;
    const newTier = tier + 1;
    const full = tierRadius(newTier);
    const pa = a.body.getPosition();
    const pb = b.body.getPosition();
    const ax = pa.x * PX_PER_M;
    const ay = pa.y * PX_PER_M;
    const bx = pb.x * PX_PER_M;
    const by = pb.y * PX_PER_M;
    // Made where its full-size circle is inside the walls and above the floor.
    const mx = clamp((ax + bx) / 2, WALL_THICKNESS + full, WORLD_WIDTH - WALL_THICKNESS - full);
    const my = Math.min(FLOOR_TOP - full, (ay + by) / 2);
    // Merge grace (#3694): only a merge with a piece in the danger band counts.
    const highestTop = Math.min(ay, by) - a.full;
    const nearLid = highestTop <= OVERFLOW_LINE_Y + DANGER_STACK_MARGIN;

    const va = a.body.getLinearVelocity();
    const vb = b.body.getLinearVelocity();
    const mergedVx = ((va.x + vb.x) / 2) * M_S_TO_PX_STEP;
    const mergedVy = ((va.y + vb.y) / 2) * M_S_TO_PX_STEP - MERGE_POP_IMPULSE;
    const wasDrop = this._drop === a || this._drop === b;

    this._removePiece(a);
    this._removePiece(b);

    // Grow-in from the parents' radius.
    const e = this._addPiece(newTier, mx, my, a.full);
    e.growStep = 0;
    this._growing.push(e);
    setVelocityPx(
      e.body,
      clamp(mergedVx, -MAX_SPAWN_VELOCITY, MAX_SPAWN_VELOCITY),
      clamp(mergedVy, -MAX_SPAWN_VELOCITY, MAX_SPAWN_VELOCITY)
    );
    // The dropped piece merged: the gate follows the piece it became, which has landed.
    if (wasDrop) {
      this._drop = e;
      this._dropHardStopRun = 0;
    }

    const scoreValue = PIECE_DEFS[newTier]!.scoreValue;
    this._score += scoreValue;
    events.push({
      type: "merge",
      tierA: tier,
      tierB: tier,
      result: newTier,
      x: mx,
      y: my,
      id: e.id,
      parentIds: [a.id, b.id],
    });
    events.push({ type: "score", delta: scoreValue, total: this._score });
    if (nearLid) this._ticksSinceNearLidMerge = 0;
    if (this._comboTicksLeft > 0) this._comboCount++;
  }

  /** The lid (#3694): drop gate, hard stop and overflow count, once per fixed step. */
  private _applyLid(events: EngineEvent[]): void {
    // Drop gate: the last dropped piece has cleared once its top edge is at or below the lid
    // (or it is gone).
    const drop = this._drop;
    if (drop !== null && (!this._pieces.has(drop.id) || drop.y - drop.full >= OVERFLOW_LINE_Y)) {
      this._drop = null;
    }

    this._ticksSinceNearLidMerge++;
    let overLid = false;
    let hardStop = false;
    let dropAtTop = false;
    for (const e of this._pieces.values()) {
      // Still falling from the spawner: not part of the pile yet.
      if (e.falling) continue;
      // In flight (bounced, popped, falling): not settled.
      if (e.speed > OVERFLOW_SETTLED_SPEED) continue;
      const top = e.y - e.full;
      if (top <= HARD_STOP_Y) {
        // A large piece spawns with its top edge near the canvas top, so touching a pile that
        // reaches just under the lid can hand it to the pile while still near spawn height. The
        // last dropped piece must stay settled up there for HARD_STOP_SETTLE_TICKS to count.
        if (e === this._drop) {
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
    this._drop = null;
    events.push({ type: "gameOver", reason });
  }

  /**
   * Whether a new drop is allowed (#3694): not after game over or the win (#3904), and not while
   * the last dropped piece is still over the lid. The screen gates taps on it; `drop()` itself does not, so the
   * dev panel and the test seams can still place pieces.
   */
  canDrop(): boolean {
    return !this._gameOver && !this._won && this._drop === null;
  }

  /** True once two capstones have touched (#3904): play has ended in a win. */
  hasWon(): boolean {
    return this._won;
  }

  destroy(): void {
    this._physics.destroy();
    this._pieces.clear();
    for (const list of this._byTier) list.length = 0;
    this._growing.length = 0;
    this._pendA.length = 0;
    this._pendB.length = 0;
    this._fallingCount = 0;
    this._drop = null;
  }

  restore(pieces: ReadonlyArray<{ tier: number; x: number; y: number }>, score: number): void {
    for (const e of Array.from(this._pieces.values())) this._removePiece(e);
    this._pendA.length = 0;
    this._pendB.length = 0;
    this._score = score;
    this._gameOver = false;
    this._won = false;
    this._overflowTicksCount = 0;
    // Treat restore like a near-lid merge just fired, once, so OVERFLOW_IGNORE_MERGE_TICKS of
    // grace applies while pieces settle into their saved positions. It is one grace per restore,
    // the hard stop still applies, and the count starts when it ends.
    this._ticksSinceNearLidMerge = 0;
    this._drop = null;
    this._dropHardStopRun = 0;
    this._accumulator = 0;
    this._comboCount = 0;
    this._comboTicksLeft = 0;
    this._comboEmitted = false;
    for (const { tier, x, y } of pieces) {
      if (!PIECE_DEFS[tier]) continue;
      this._addPiece(tier, x, y, tierRadius(tier));
    }
    // A saved piece whose top edge is over the lid and that touches no other piece was most
    // likely still in the air (saved right after a drop; velocities are not saved). Treat it as
    // falling again: it joins the pile on first contact, like any dropped piece, and is not
    // hard-stopped before that. One that touches the pile is part of it and counts at once.
    const placed = Array.from(this._pieces.values());
    const airborne = placed.filter((p) => {
      if (p.y - p.full >= OVERFLOW_LINE_Y) return false;
      return !placed.some(
        (o) => o !== p && Math.hypot(o.x - p.x, o.y - p.y) <= p.full + o.full + 2
      );
    });
    for (const p of airborne) {
      p.falling = true;
      this._fallingCount++;
    }
    // Exactly one such piece is the last drop: the gate and the hard-stop settle run apply to it.
    if (airborne.length === 1) this._drop = airborne[0]!;
  }

  /** Reseeds the engine's RNG (the drop nudge). The screen calls it with the queue's seed. */
  seed(seed: number): void {
    // The LCG's first draws of nearby seeds are nearly equal: mix the seed and discard a few.
    let h = (seed ^ 0x9e3779b1) >>> 0;
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
    h = (h ^ (h >>> 16)) >>> 0;
    const rng = createSeededRng(h);
    for (let i = 0; i < 4; i++) rng();
    this._rng = rng;
  }

  drop(tier: number, x: number): void {
    if (this._gameOver || this._won) return;
    if (!PIECE_DEFS[tier]) return;
    const r = tierRadius(tier);
    // A tap at the edge of the bin (the screen clamps it to the walls' inner faces) places the
    // piece against the wall, not inside it: Box2D would push it out by position, a visible jump.
    // The nudge comes first and the clamp after, so the wall rule still holds. One draw per drop.
    const draw = this._rng();
    const nudged = this._bench.noDropNudge ? x : x + (draw * 2 - 1) * DROP_NUDGE_PX;
    const cx = clamp(nudged, WALL_THICKNESS + r, WORLD_WIDTH - WALL_THICKNESS - r);
    const e = this._addPiece(tier, cx, OVERFLOW_LINE_Y - r - DROP_SPAWN_INSET, r);
    // It spawns over the lid: the gate holds until it falls below, and the lid rule ignores it
    // until it lands (#3694).
    e.falling = true;
    this._fallingCount++;
    this._drop = e;
    this._dropHardStopRun = 0;
    this._comboCount = 0;
    this._comboTicksLeft = COMBO_WINDOW_TICKS;
    this._comboEmitted = false;
  }

  /**
   * A snapshot of the board.
   *
   * Without `into`, every call builds a new state (tests, hooks and saves hold on to it). With
   * `into` (#2960), the board is written into that object and returned: its `pieces` array and
   * the snapshot objects in it are reused, so the per-frame read allocates nothing once the
   * array has grown to the board's size. The caller owns `into`, and the next call with it
   * overwrites what this one wrote.
   */
  getState(into?: GameState): GameState {
    const dangerRatio = Math.min(1, this._overflowTicksCount / OVERFLOW_TICKS_THRESHOLD);
    if (!into) {
      const pieces: PieceSnapshot[] = [];
      for (const e of this._pieces.values()) pieces.push(writeSnapshot(undefined, e));
      return {
        pieces,
        score: this._score,
        gameOver: this._gameOver,
        dangerRatio,
        canDrop: this.canDrop(),
      };
    }
    const pieces = into.pieces;
    let n = 0;
    for (const e of this._pieces.values()) {
      const existing = pieces[n];
      const snap = writeSnapshot(existing, e);
      if (!existing) pieces.push(snap);
      n++;
    }
    pieces.length = n;
    into.score = this._score;
    into.gameOver = this._gameOver;
    into.dangerRatio = dangerRatio;
    into.canDrop = this.canDrop();
    return into;
  }
}
