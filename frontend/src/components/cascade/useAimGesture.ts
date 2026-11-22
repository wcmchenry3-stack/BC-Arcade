/**
 * #3928: the board's press, drag and release gesture (react-native-gesture-handler `Pan`). Its
 * callbacks are worklets on the UI thread: they write the aim into the board motion's shared
 * values (`useBoardMotion`) and nothing else, so dragging costs the JS thread nothing per frame.
 * The JS thread hears about a gesture only at its edges:
 *   - `wake` on a press and on a re-arm (the motion clock starts),
 *   - `onDragStart` once per gesture, when the finger first moves past the tap slop (the haptic),
 *   - `onDrop(x, aimed)` on a release that drops (the screen's existing drop path: its gates,
 *     queue, session, sound and cooldown all apply, as for a tap).
 *
 * Activation (review B1): a native `Pan` activates only after a move (iOS in `touchesMoved`;
 * Android fails an UP while still BEGAN), so a still tap would end BEGAN → FAILED and never drop.
 * The pan therefore uses manual activation and activates itself on the first touch down (web
 * did that already). A second finger fails it (`maxPointers(1)` too): no drop at a centroid.
 *
 * Callback order RNGH gives an activated gesture: onBegin, (onTouchesDown → activate), onStart,
 * onUpdate…, then onEnd(e, success) and onFinalize(e, success). `success` is false when the
 * system takes the gesture over (iOS swipe-back, Android edge-back, a modal, the app going to
 * the background, `enabled` flipping): that is a cancel, and nothing drops (review B2).
 *
 * The rules are `game/cascade/aim.ts`: a press that lifts before `guideDelayMs` and within
 * `tapSlopPt` is a tap and drops at once at the press x with no guide; leaving the board cancels
 * (nothing drops on release), coming back aims again; x is clamped to the walls and a non-finite x
 * never reaches the drop (#3922).
 */
import { useMemo } from "react";
import { Gesture } from "react-native-gesture-handler";
import { runOnJS, useSharedValue } from "react-native-reanimated";
import { boardPxToWorldX } from "../../game/cascade/layout";
import { AIM_STATE, aimAfterMove, aimInside, aimReleaseDrops } from "../../game/cascade/aim";
import { MOTION } from "../../game/cascade/motion";
import type { BoardMotionValues } from "./useBoardMotion";

export interface AimGestureOptions {
  readonly values: BoardMotionValues;
  readonly wake: () => void;
  /** pt per world px, and the board view's size (pt). */
  readonly scale: number;
  readonly width: number;
  readonly height: number;
  /** False while play cannot take a drop at all (game over, a win). */
  readonly enabled: boolean;
  /** A release that drops: the world x, and whether it was aimed (not a tap). */
  readonly onDrop: (worldX: number, aimed: boolean) => void;
  readonly onDragStart: () => void;
}

export function useAimGesture({
  values,
  wake,
  scale,
  width,
  height,
  enabled,
  onDrop,
  onDragStart,
}: AimGestureOptions) {
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);
  const dragged = useSharedValue(false);
  const { aimState, aimX, aimAt, aimFromX, clock, pointerDown } = values;

  return useMemo(
    () =>
      Gesture.Pan()
        .manualActivation(true)
        .maxPointers(1)
        .enabled(enabled)
        .onTouchesDown((e, manager) => {
          "worklet";
          // One finger: activate at once, so a still tap ends with onEnd(success) on every
          // platform. A second finger: fail (a cancel), never a drop between the two.
          if (e.numberOfTouches > 1) manager.fail();
          else manager.activate();
        })
        .onBegin((e) => {
          "worklet";
          pointerDown.set(true); // until onFinalize: the keyboard stays out (#3934)
          startX.set(e.x);
          startY.set(e.y);
          dragged.set(false);
          const x = boardPxToWorldX(e.x, scale);
          if (x === null || !aimInside(e.x, e.y, width, height)) {
            aimState.set(AIM_STATE.idle);
            return;
          }
          aimX.set(x);
          aimState.set(AIM_STATE.pressed);
          aimAt.set(clock.get());
          runOnJS(wake)();
        })
        .onUpdate((e) => {
          "worklet";
          const state = aimState.get();
          if (state === AIM_STATE.idle || state === AIM_STATE.released) return;
          const moved = Math.max(Math.abs(e.x - startX.get()), Math.abs(e.y - startY.get()));
          if (!dragged.get() && moved > MOTION.aim.tapSlopPt) {
            dragged.set(true);
            runOnJS(onDragStart)();
          }
          const inside = aimInside(e.x, e.y, width, height);
          const next = aimAfterMove(state, inside, moved);
          if (next !== state) {
            if (next === AIM_STATE.cancelled) aimFromX.set(aimX.get());
            aimState.set(next);
            aimAt.set(clock.get());
            // A re-arm after the glide back: the clock may have stopped (review S1).
            if (state === AIM_STATE.cancelled) runOnJS(wake)();
          }
          if (inside) {
            const x = boardPxToWorldX(e.x, scale);
            if (x !== null) aimX.set(x);
          }
        })
        .onEnd((_e, success) => {
          "worklet";
          if (!success) return; // the system took the gesture over: a cancel, never a drop
          const state = aimState.get();
          const x = aimX.get();
          if (aimReleaseDrops(state, x)) runOnJS(onDrop)(x, state === AIM_STATE.aiming);
        })
        .onFinalize((_e, success) => {
          "worklet";
          pointerDown.set(false);
          const state = aimState.get();
          if (!success && (state === AIM_STATE.pressed || state === AIM_STATE.aiming)) {
            // Cancelled by the system: glide back like a drag off the board.
            aimFromX.set(state === AIM_STATE.aiming ? aimX.get() : NaN);
            aimState.set(AIM_STATE.cancelled);
            aimAt.set(clock.get());
            return;
          }
          // An aim fades its guide; a tap simply ends; a cancel keeps gliding back.
          if (state === AIM_STATE.aiming) {
            aimState.set(AIM_STATE.released);
            aimAt.set(clock.get());
          } else if (state === AIM_STATE.pressed) {
            aimState.set(AIM_STATE.idle);
          }
        }),
    [
      enabled,
      scale,
      width,
      height,
      wake,
      onDrop,
      onDragStart,
      startX,
      startY,
      dragged,
      aimState,
      aimX,
      aimAt,
      aimFromX,
      clock,
      pointerDown,
    ]
  );
}
