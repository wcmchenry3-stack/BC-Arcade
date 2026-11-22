/**
 * 2048 swipe input (#3689): when a drag becomes a move, and the short queue of moves made while
 * the board is still sliding.
 */
import type { Direction } from "./engine";
import { MOVE_QUEUE_DEPTH } from "./motion";

/** How far (px) a finger travels along one axis before the swipe fires, without waiting for the lift. */
export const SWIPE_THRESHOLD_PX = 24;

/**
 * The swipe a drag of (`dx`, `dy`) has become, or null while neither axis has reached
 * `threshold`. The longer axis wins.
 */
export function swipeDirection(
  dx: number,
  dy: number,
  threshold: number = SWIPE_THRESHOLD_PX
): Direction | null {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (ax < threshold && ay < threshold) return null;
  if (ax > ay) return dx > 0 ? "right" : "left";
  return dy > 0 ? "down" : "up";
}

/**
 * One swipe per gesture: `update` reports the direction the first time the drag crosses the
 * threshold and null after that, until `reset` (a new gesture begins or the last one ends).
 */
export function createSwipeTracker(threshold: number = SWIPE_THRESHOLD_PX) {
  let fired = false;
  return {
    update(dx: number, dy: number): Direction | null {
      if (fired) return null;
      const direction = swipeDirection(dx, dy, threshold);
      if (direction) fired = true;
      return direction;
    },
    reset(): void {
      fired = false;
    },
  };
}

/** Moves waiting for the board to finish sliding: the first `depth` swipes are kept, in order. */
export function createMoveQueue(depth: number = MOVE_QUEUE_DEPTH) {
  const queue: Direction[] = [];
  return {
    /** False when the queue is full: the swipe is dropped. */
    push(direction: Direction): boolean {
      if (queue.length >= depth) return false;
      queue.push(direction);
      return true;
    },
    shift(): Direction | null {
      return queue.shift() ?? null;
    },
    clear(): void {
      queue.length = 0;
    },
    get length(): number {
      return queue.length;
    },
  };
}
