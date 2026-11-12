/**
 * #2960: the Cascade board's per-frame data, as one flat `Float64Array`.
 *
 * The screen's loop reads the engine (`CascadeEngine.getState(into)`, no allocation), packs what
 * the board draws into a reusable scratch buffer here, and publishes a copy to the board's shared
 * value only when it differs from the last one published. The board's Skia Picture is recorded
 * from that shared value on the UI thread (`drawFrame.ts`). Nothing per frame goes through React
 * state, so a settled board costs no React commit at all.
 *
 * Layout:
 *   [0] piece count   [1] dangerRatio (0..1)   [2] canDrop (1/0)   [3] spawner tier (-1 = none)
 *   then per piece, `FRAME_STRIDE` floats: id, tier, x, y, angle, sleeping (1/0)
 *
 * 64-bit, not the `Float32Array` #2960 first sketched: float32 rounding of positions and
 * `dangerRatio` moved a few sprite and wash pixels by one colour step against the old renderer.
 * With float64 the headless comparison is pixel-identical; the cost is 8 bytes a number.
 *
 * Positions are world units. `angle` is carried for the code-drawn art (#3698); today's sprites
 * are drawn unrotated, as before.
 *
 * Sleeping pieces are drawn where they fell asleep (`FrozenPositions`), carried over from the old
 * declarative `PieceRenderer` (#1746): it hides sub-pixel drift of settled pieces, and it is what
 * lets a settled board publish nothing.
 *
 * Pure and React-free, so the packing and the publish gate are unit-tested.
 */
import type { GameState } from "../engine";

/** Header floats before the first piece. */
export const FRAME_HEADER = 4;
/** Floats per piece. */
export const FRAME_STRIDE = 6;

export const HEADER_FIELD = { count: 0, dangerRatio: 1, canDrop: 2, spawnerTier: 3 } as const;
export const PIECE_FIELD = { id: 0, tier: 1, x: 2, y: 3, angle: 4, sleeping: 5 } as const;

/** What the packer reads of a piece (the engine's `PieceSnapshot` fits). */
export interface FramePiece {
  readonly id: number;
  readonly tier: number;
  readonly x: number;
  readonly y: number;
  readonly angle: number;
  readonly isSleeping?: boolean;
}

/** What the packer reads of a board (the engine's `GameState` fits; test doubles may omit the lid). */
export interface FrameState {
  readonly pieces: readonly FramePiece[];
  readonly dangerRatio?: number;
  readonly canDrop?: boolean;
}

/** Where each sleeping piece fell asleep, and the pack that last saw it. */
export type FrozenPositions = Map<number, { x: number; y: number; seen: number }>;

/** The loop's reusable packing state: the scratch buffer grows, never shrinks. */
export interface FramePacker {
  buf: Float64Array;
  /** Floats used by the last pack. */
  length: number;
  readonly frozen: FrozenPositions;
  /** Pack counter, to evict frozen entries of pieces that are gone. */
  pass: number;
}

/** Pieces the scratch buffer holds before it first grows. */
const INITIAL_PIECE_CAPACITY = 64;

export function createFramePacker(): FramePacker {
  return {
    buf: new Float64Array(FRAME_HEADER + INITIAL_PIECE_CAPACITY * FRAME_STRIDE),
    length: FRAME_HEADER,
    frozen: new Map(),
    pass: 0,
  };
}

/** An empty, calm board: no pieces, no danger, drops allowed, no spawner piece. */
export function emptyFrame(spawnerTier = -1): Float64Array {
  const buf = new Float64Array(FRAME_HEADER);
  buf[HEADER_FIELD.canDrop] = 1;
  buf[HEADER_FIELD.spawnerTier] = spawnerTier;
  return buf;
}

/**
 * Packs `state` into the packer's scratch buffer (sleeping pieces at their frozen position) and
 * returns the number of floats written. Allocates only when the board outgrows the buffer or a
 * piece falls asleep.
 */
export function packFrame(packer: FramePacker, state: FrameState, spawnerTier: number): number {
  const pieces = state.pieces;
  const n = pieces.length;
  const need = FRAME_HEADER + n * FRAME_STRIDE;
  if (packer.buf.length < need) {
    packer.buf = new Float64Array(Math.max(need, packer.buf.length * 2));
  }
  const buf = packer.buf;
  const frozen = packer.frozen;
  const pass = ++packer.pass;
  buf[HEADER_FIELD.count] = n;
  buf[HEADER_FIELD.dangerRatio] = state.dangerRatio ?? 0;
  buf[HEADER_FIELD.canDrop] = state.canDrop === false ? 0 : 1;
  buf[HEADER_FIELD.spawnerTier] = spawnerTier;
  for (let i = 0; i < n; i++) {
    const p = pieces[i]!;
    const o = FRAME_HEADER + i * FRAME_STRIDE;
    let x = p.x;
    let y = p.y;
    if (p.isSleeping) {
      const f = frozen.get(p.id);
      if (f) {
        x = f.x;
        y = f.y;
        f.seen = pass;
      } else {
        frozen.set(p.id, { x, y, seen: pass });
      }
    } else if (frozen.size > 0) {
      frozen.delete(p.id);
    }
    buf[o + PIECE_FIELD.id] = p.id;
    buf[o + PIECE_FIELD.tier] = p.tier;
    buf[o + PIECE_FIELD.x] = x;
    buf[o + PIECE_FIELD.y] = y;
    buf[o + PIECE_FIELD.angle] = p.angle;
    buf[o + PIECE_FIELD.sleeping] = p.isSleeping ? 1 : 0;
  }
  // Pieces that merged away or were cleared: forget where they slept.
  if (frozen.size > 0) {
    for (const [id, f] of frozen) if (f.seen !== pass) frozen.delete(id);
  }
  packer.length = need;
  return need;
}

/** True when the first `length` floats of `scratch` equal `published` (same length): skip the publish. */
export function sameFrame(scratch: Float64Array, length: number, published: Float64Array): boolean {
  if (published.length !== length) return false;
  for (let i = 0; i < length; i++) if (scratch[i] !== published[i]) return false;
  return true;
}

/**
 * The frame to publish after a pack, or null when it would draw exactly what `published` does.
 * A publish is a fresh array: the shared value hands it to the UI thread, so the scratch buffer
 * must not be published itself (the next pack would overwrite it).
 */
export function nextFrame(packer: FramePacker, published: Float64Array): Float64Array | null {
  if (sameFrame(packer.buf, packer.length, published)) return null;
  return packer.buf.slice(0, packer.length);
}

/** The empty board a game starts with (no score yet). */
const NO_SCORE = 0;

/**
 * An empty engine state for the loop to hand to `CascadeEngine.getState(into)`, which fills it in
 * place every frame (#2960). Lives here, not in `engine.ts`, so screen tests that replace the
 * engine module keep it.
 */
export function createGameState(): GameState {
  return { pieces: [], score: NO_SCORE, gameOver: false, dangerRatio: 0, canDrop: true };
}
