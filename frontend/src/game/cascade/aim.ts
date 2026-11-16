/**
 * Cascade aiming (#3928, owner pick A "Dashed line + ghost"): the gesture's state machine and the
 * landing cast, as pure worklets. The board gesture (`components/cascade/useAimGesture.ts`) runs
 * the transitions on the UI thread and writes shared values; the board's Picture
 * (`render/drawAim.ts`) draws from them. Nothing here runs on the JS thread per frame.
 *
 * States (`AIM_STATE`):
 *   - idle: no finger. The next piece waits in the ring.
 *   - pressed: a finger is down on the board, not yet a drag. Releasing now is a tap: it drops at
 *     the press x at once, and no guide was ever drawn (as tap-to-drop always did).
 *   - aiming: the press lasted `guideDelayMs` or moved more than `tapSlopPt`. The piece glides to
 *     the finger and the guide shows; releasing drops at the aim x.
 *   - cancelled: the finger left the board. The piece glides back to the ring; releasing drops
 *     nothing. Coming back onto the board aims again (re-arm).
 *   - released: the finger lifted after aiming; the guide fades out.
 *
 * Every time is a stamp of the board's motion clock (`useBoardMotion`), so the drawing and the
 * transitions share one UI-thread clock.
 */
import { FLOOR_THICKNESS, WALL_THICKNESS, WORLD_HEIGHT, WORLD_WIDTH } from "./constants";
import { HEADER_FIELD, FRAME_HEADER, FRAME_STRIDE, PIECE_FIELD } from "./render/frame";
import { MOTION, easeOutCubic, lerp, progress } from "./motion";
import { SPAWNER } from "./lidVisuals";

export const AIM_STATE = { idle: 0, pressed: 1, aiming: 2, cancelled: 3, released: 4 } as const;

const FLOOR_TOP = WORLD_HEIGHT - FLOOR_THICKNESS;

/** True when a point (px, in the board view) is on the board. */
export function aimInside(x: number, y: number, width: number, height: number): boolean {
  "worklet";
  return Number.isFinite(x) && Number.isFinite(y) && x >= 0 && y >= 0 && x <= width && y <= height;
}

/**
 * Where a piece of collider radius `r` falls at `x`: the engine's own clamp (its full circle
 * inside the walls, `engine.drop`), so the guide never promises a spot the drop cannot reach.
 */
export function aimDropX(x: number, r: number): number {
  "worklet";
  return Math.max(WALL_THICKNESS + r, Math.min(WORLD_WIDTH - WALL_THICKNESS - r, x));
}

/** The state after a move: re-arm, cancel, or the drag starting. */
export function aimAfterMove(state: number, inside: boolean, movedPt: number): number {
  "worklet";
  if (state === AIM_STATE.idle || state === AIM_STATE.released) return state;
  if (!inside) return AIM_STATE.cancelled;
  if (state === AIM_STATE.cancelled) return AIM_STATE.aiming;
  if (state === AIM_STATE.pressed && movedPt > MOTION.aim.tapSlopPt) return AIM_STATE.aiming;
  return state;
}

/** The state after time passes: a held press becomes aiming after `guideDelayMs`. */
export function aimAfterTime(state: number, msInState: number): number {
  "worklet";
  return state === AIM_STATE.pressed && msInState >= MOTION.aim.guideDelayMs
    ? AIM_STATE.aiming
    : state;
}

/** A release drops the piece from a press (a tap) or while aiming; never once cancelled. */
export function aimReleaseDrops(state: number, x: number): boolean {
  "worklet";
  return (state === AIM_STATE.pressed || state === AIM_STATE.aiming) && Number.isFinite(x);
}

/** True while the aim needs the motion clock (its transitions, glides and fades). */
export function aimLive(state: number, msInState: number, reduceMotion: boolean): boolean {
  "worklet";
  const A = MOTION.aim;
  if (state === AIM_STATE.pressed || state === AIM_STATE.aiming) return true;
  if (state === AIM_STATE.cancelled)
    return !reduceMotion && msInState < Math.max(A.returnMs, A.outMs);
  if (state === AIM_STATE.released) return !reduceMotion && msInState < A.outMs;
  return false;
}

/** Where the spawner piece is drawn (world x): at the ring, gliding to the finger, or back. */
export function aimPieceX(
  state: number,
  aimX: number,
  fromX: number,
  msInState: number,
  reduceMotion: boolean
): number {
  "worklet";
  const A = MOTION.aim;
  if (state === AIM_STATE.aiming) {
    return reduceMotion
      ? aimX
      : lerp(SPAWNER.cx, aimX, easeOutCubic(progress(msInState, 0, A.pickUpMs)));
  }
  if (state === AIM_STATE.cancelled && !reduceMotion) {
    return lerp(fromX, SPAWNER.cx, easeOutCubic(progress(msInState, 0, A.returnMs)));
  }
  return SPAWNER.cx;
}

/** The guide's opacity (0..1): in while aiming, out after a release or a cancel. */
export function aimGuideAlpha(state: number, msInState: number, reduceMotion: boolean): number {
  "worklet";
  const A = MOTION.aim;
  if (state === AIM_STATE.aiming) return reduceMotion ? 1 : progress(msInState, 0, A.inMs);
  if (state === AIM_STATE.released || state === AIM_STATE.cancelled) {
    return reduceMotion ? 0 : 1 - progress(msInState, 0, A.outMs);
  }
  return 0;
}

/**
 * The first contact of a piece of collider radius `r` falling straight down at `x`: its centre
 * y, against every piece in the packed `frame` (its radius × its grow-in scale) and the floor.
 * One pass over the pieces, a square root only for those under the column.
 */
export function landingY(
  frame: Float64Array,
  radius: readonly number[],
  x: number,
  r: number
): number {
  "worklet";
  let best = FLOOR_TOP - r;
  const n = frame[HEADER_FIELD.count] ?? 0;
  for (let i = 0; i < n; i++) {
    const o = FRAME_HEADER + i * FRAME_STRIDE;
    const pr =
      (radius[frame[o + PIECE_FIELD.tier] ?? -1] ?? 0) * (frame[o + PIECE_FIELD.scale] ?? 1);
    if (!(pr > 0)) continue;
    const dx = x - (frame[o + PIECE_FIELD.x] ?? 0);
    const sum = r + pr;
    if (dx >= sum || dx <= -sum) continue;
    const y = (frame[o + PIECE_FIELD.y] ?? 0) - Math.sqrt(sum * sum - dx * dx);
    if (y < best) best = y;
  }
  return best;
}
