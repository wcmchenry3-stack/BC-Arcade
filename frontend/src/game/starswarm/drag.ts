/**
 * Star Swarm drag-to-move maths (pure). `components/starswarm/Controls.tsx` calls `applyDrag`
 * on every pan `onChange`; `__tests__/drag.test.ts` tests this function directly, so the drag
 * tests exercise the shipped code rather than a copy of it (#2955).
 *
 * #4079: neither function lets a non-finite number through. A scale of 0 used to turn
 * `translationX / scale` into ±Infinity (the ship slammed into the right edge) and then NaN,
 * which `Math.max/min` pass straight on into `setPlayerX`.
 */
import { CANVAS_W, PLAYER_W } from "./engine";

/** Leftmost / rightmost ship centre X: the ship's half-width stays on the canvas. */
export const DRAG_MIN_X = PLAYER_W / 2;
export const DRAG_MAX_X = CANVAS_W - PLAYER_W / 2;

/** `v` clamped to [lo, hi]. ±Infinity clamps to the bound; NaN gives the midpoint (#4079). */
export function clamp(v: number, lo: number, hi: number): number {
  if (Number.isNaN(v)) return (lo + hi) / 2;
  return Math.max(lo, Math.min(hi, v));
}

export interface DragResult {
  /** Unclamped ship X the finger asked for (non-finite when an input was). */
  rawX: number;
  /** Ship X after clamping to the canvas. Always finite. */
  newX: number;
  /**
   * Drag anchor for the next event. Re-anchored on an edge overshoot so any reversal moves the
   * ship immediately instead of replaying the overshoot; unchanged otherwise. NaN when this
   * event's translation or scale was unusable: the next good event re-anchors on `fallbackX`.
   */
  nextDragStart: number;
}

/**
 * Ship X for a pan gesture: `shipXAtDragStart` plus the finger's translation in canvas units
 * (`translationX / scale`), clamped to [DRAG_MIN_X, DRAG_MAX_X].
 *
 * #4079: when the result can't be computed — a `scale` that is not a finite number above 0, or
 * a non-finite `translationX` or `shipXAtDragStart` — the ship holds `fallbackX` (the last good
 * X; the canvas centre when that isn't finite either). A bad anchor is replaced by one that puts
 * this event's translation on `fallbackX`, so the drag carries on from there; a bad translation
 * or scale returns a NaN anchor, which the next good event replaces the same way.
 */
export function applyDrag(
  shipXAtDragStart: number,
  translationX: number,
  scale: number,
  fallbackX: number = CANVAS_W / 2
): DragResult {
  const usable = Number.isFinite(translationX) && Number.isFinite(scale) && scale > 0;
  const rawX = shipXAtDragStart + translationX / scale;
  if (!usable || !Number.isFinite(rawX)) {
    const held = clamp(
      Number.isFinite(fallbackX) ? fallbackX : CANVAS_W / 2,
      DRAG_MIN_X,
      DRAG_MAX_X
    );
    return { rawX, newX: held, nextDragStart: usable ? held - translationX / scale : NaN };
  }
  const newX = clamp(rawX, DRAG_MIN_X, DRAG_MAX_X);
  const nextDragStart = rawX !== newX ? newX - translationX / scale : shipXAtDragStart;
  return { rawX, newX, nextDragStart };
}
