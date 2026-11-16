/**
 * #3928: the board's press, drag and release gesture (react-native-gesture-handler `Pan` with
 * `minDistance(0)`). Its callbacks are worklets on the UI thread: they write the aim into the
 * board motion's shared values (`useBoardMotion`) and nothing else, so dragging costs the JS
 * thread nothing per frame. The JS thread hears about a gesture only at its edges:
 *   - `wake` once per press (the motion clock starts),
 *   - `onDragStart` once per gesture, when the finger first moves past the tap slop (the haptic),
 *   - `onDrop(x)` on a release that drops (the screen's existing drop path: its gates, queue,
 *     session, sound and cooldown all apply, as for a tap).
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
  readonly onDrop: (worldX: number) => void;
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
  const { aimState, aimX, aimAt, aimFromX, clock } = values;

  return useMemo(
    () =>
      Gesture.Pan()
        .minDistance(0)
        .enabled(enabled)
        .onBegin((e) => {
          "worklet";
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
          }
          if (inside) {
            const x = boardPxToWorldX(e.x, scale);
            if (x !== null) aimX.set(x);
          }
        })
        .onEnd(() => {
          "worklet";
          const x = aimX.get();
          if (aimReleaseDrops(aimState.get(), x)) runOnJS(onDrop)(x);
        })
        .onFinalize(() => {
          "worklet";
          // A cancel keeps gliding back; an aim fades its guide; a tap simply ends.
          const state = aimState.get();
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
    ]
  );
}
