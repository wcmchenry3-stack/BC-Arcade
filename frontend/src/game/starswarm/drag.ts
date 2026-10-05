/**
 * Star Swarm drag-to-move maths (pure). `components/starswarm/Controls.tsx` calls `applyDrag`
 * on every pan `onChange`; `__tests__/drag.test.ts` tests this function directly, so the drag
 * tests exercise the shipped code rather than a copy of it (#2955).
 */
import { CANVAS_W, PLAYER_W } from "./engine";

/** Leftmost / rightmost ship centre X: the ship's half-width stays on the canvas. */
export const DRAG_MIN_X = PLAYER_W / 2;
export const DRAG_MAX_X = CANVAS_W - PLAYER_W / 2;

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export interface DragResult {
  /** Unclamped ship X the finger asked for. */
  rawX: number;
  /** Ship X after clamping to the canvas. */
  newX: number;
  /**
   * Drag anchor for the next event. Re-anchored on an edge overshoot so any reversal moves the
   * ship immediately instead of replaying the overshoot; unchanged otherwise.
   */
  nextDragStart: number;
}

/**
 * Ship X for a pan gesture: `shipXAtDragStart` plus the finger's translation in canvas units
 * (`translationX / scale`), clamped to [DRAG_MIN_X, DRAG_MAX_X].
 */
export function applyDrag(
  shipXAtDragStart: number,
  translationX: number,
  scale: number
): DragResult {
  const rawX = shipXAtDragStart + translationX / scale;
  const newX = clamp(rawX, DRAG_MIN_X, DRAG_MAX_X);
  const nextDragStart = rawX !== newX ? newX - translationX / scale : shipXAtDragStart;
  return { rawX, newX, nextDragStart };
}
