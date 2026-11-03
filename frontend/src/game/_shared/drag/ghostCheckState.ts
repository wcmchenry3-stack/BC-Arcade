/**
 * Per-drag state of the rendered-ghost check (#3528).
 *
 * Only one drag runs at a time, so DragProvider holds ONE of these in a single
 * shared value (`ghostCheck`) instead of every DraggableCard holding a dozen
 * mutables of its own (~52 cards on a Solitaire board).
 *
 * Threading: it is written and read only by the pan worklets on the UI thread.
 * `onStart` assigns a fresh object (one allocation per drag); later worklets
 * mutate that object's fields in place through `ghostCheck.value`, which on
 * the UI runtime returns the stored object itself (no copy, no mapper run:
 * nothing reads it from an animated style). The JS thread never reads it — a
 * JS read would be a stale copy (#2772). The idle value is never mutated.
 */
import type { CardSource, ContainerSource } from "./dragGeometry";

export const GHOST_PENDING = 0;
export const GHOST_OK = 1;
export const GHOST_FAIL = 2;
export const GHOST_UNMEASURED = 3;
/** A first sample looked like frame lag (#3532): one follow-up sample decides. */
export const GHOST_LAG = 4;
/** No drag has started yet (the initial value). */
export const GHOST_IDLE = 5;

export interface GhostCheckState {
  /** One of the GHOST_* constants. */
  state: number;
  /** Check attempts (a not-yet-mounted ghost counts, without a measure). */
  attempts: number;
  /** Ghost measure() calls made. */
  measures: number;
  startedAt: number;
  nextCheckAt: number;
  /** The finger's offset inside the card at activation: the grab the ghost
   *  is positioned with (#3531). */
  grabX: number;
  grabY: number;
  fingerStartX: number;
  fingerStartY: number;
  /** The finger of the last cardX/Y write (the frame on screen) and of the
   *  write before it. Updated only while the check is pending. */
  lastFingerX: number;
  lastFingerY: number;
  prevFingerX: number;
  prevFingerY: number;
  /** The finger's running extremes since onStart (#3532): the box a lagging
   *  ghost may sit in. Scalar compares in the pending onUpdate only. */
  minFingerX: number;
  maxFingerX: number;
  minFingerY: number;
  maxFingerY: number;
  /** The `lag` first sample's deltas and the finger it was taken against. */
  lagDeltaX: number;
  lagDeltaY: number;
  lagFingerX: number;
  lagFingerY: number;
  /** When the `lag` sample was taken (Date.now()). */
  lagAt: number;
  /** Why the check ended `unmeasured` (#3532 diagnostics): "notMounted" (the
   *  host never reported the ghost mounted), "noRef" (mounted, but the
   *  UI-side ref was still null), "nullMeasure" (measure() returned null),
   *  "noSample" (the drag ended with no attempt at all). "" otherwise. */
  why: string;
  /** When an attempt first found the ghost mounted with its ref attached
   *  (Date.now()); 0 = never. An upper bound on the mount time. */
  mountSeenAt: number;
  /** When the check gave up (Date.now()); 0 = it didn't. */
  endedAt: number;
  containerUsedX: number;
  containerUsedY: number;
  cardSource: CardSource;
  containerSource: ContainerSource;
  /** The card wrapper measured at onStart (whether or not it was accepted). */
  cardMeasured: boolean;
  cardMeasuredX: number;
  cardMeasuredY: number;
  cardMismatch: boolean;
  /** The last check's deltas (gesture space and measure space). */
  deltaX: number;
  deltaY: number;
  deltaMeasureX: number;
  deltaMeasureY: number;
  /** The last NON-NULL ghost measure() of this drag and its page origin
   *  (#3529): what the debug overlay draws. Set right after the measure, also
   *  for a transformIgnored ghost; never on a null / not-mounted / given-up
   *  path. A write on the existing once-per-drag check only. */
  ghostMeasured: boolean;
  ghostPageX: number;
  ghostPageY: number;
}

export function idleGhostCheck(): GhostCheckState {
  "worklet";
  return {
    state: GHOST_IDLE,
    attempts: 0,
    measures: 0,
    startedAt: 0,
    nextCheckAt: 0,
    grabX: 0,
    grabY: 0,
    fingerStartX: 0,
    fingerStartY: 0,
    lastFingerX: 0,
    lastFingerY: 0,
    prevFingerX: 0,
    prevFingerY: 0,
    minFingerX: 0,
    maxFingerX: 0,
    minFingerY: 0,
    maxFingerY: 0,
    lagDeltaX: 0,
    lagDeltaY: 0,
    lagFingerX: 0,
    lagFingerY: 0,
    lagAt: 0,
    why: "",
    mountSeenAt: 0,
    endedAt: 0,
    containerUsedX: 0,
    containerUsedY: 0,
    cardSource: "gesture",
    containerSource: "cached",
    cardMeasured: false,
    cardMeasuredX: 0,
    cardMeasuredY: 0,
    cardMismatch: false,
    deltaX: 0,
    deltaY: 0,
    deltaMeasureX: 0,
    deltaMeasureY: 0,
    ghostMeasured: false,
    ghostPageX: 0,
    ghostPageY: 0,
  };
}
