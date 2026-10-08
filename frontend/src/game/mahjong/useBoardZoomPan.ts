/**
 * useBoardZoomPan (#2981) — the Mahjong board's pinch-to-zoom and drag-to-pan.
 *
 * Owns the gesture layer's shared values: the zoom bounds, the live and
 * gesture-start zoom and offset, and the board/viewport sizes the pan bounds
 * are measured against. Two effects keep them in step with the camera:
 *
 *   - a new fit (orientation, resize, another layout) resets zoom to fitted
 *     and the offset to centred;
 *   - the board and viewport sizes are mirrored into shared values, so the
 *     pan-bound worklets read them on the UI thread instead of closing over
 *     JS-side camera values that would go stale.
 *
 * Every shared value and gesture is created here, in the calling component's
 * render, so the Reanimated plugin workletizes the gesture callbacks as before.
 * `fitToScreen` zooms back to fitted and centred (the no-moves prompt), at
 * once under Reduce Motion or over 350 ms otherwise.
 */
import { useCallback, useEffect } from "react";
import { Easing, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { Gesture } from "react-native-gesture-handler";

import type { BoardCamera } from "./layout";
import { clamp, computePanBounds, computeZoomBounds } from "./zoom";

type ZoomPanCamera = Pick<
  BoardCamera,
  "scale" | "tileWidth" | "boardWidth" | "boardHeight" | "viewportWidth" | "viewportHeight"
>;

const FIT_ANIMATION_MS = 350;

export function useBoardZoomPan(camera: ZoomPanCamera) {
  // minZoom = fit-to-screen scale; maxZoom = tile just reaches MIN_READABLE_TILE_PX.
  const { minZoom: initMin, maxZoom: initMax } = computeZoomBounds(camera.scale, camera.tileWidth);
  const minZoom = useSharedValue(initMin);
  const maxZoom = useSharedValue(initMax);
  const zoomScale = useSharedValue(initMin);
  const baseScale = useSharedValue(initMin);
  const translateX = useSharedValue(0);
  const baseTranslateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const baseTranslateY = useSharedValue(0);
  // Board/viewport dimensions as shared values so pan-boundary worklets can
  // read them on the UI thread without capturing stale JS-side camera values.
  const boardWidthSV = useSharedValue(camera.boardWidth);
  const boardHeightSV = useSharedValue(camera.boardHeight);
  const viewportWidthSV = useSharedValue(camera.viewportWidth);
  const viewportHeightSV = useSharedValue(camera.viewportHeight);

  // Reset gesture state when layout changes (orientation / resize).
  useEffect(() => {
    const bounds = computeZoomBounds(camera.scale, camera.tileWidth);
    minZoom.value = bounds.minZoom;
    maxZoom.value = bounds.maxZoom;
    zoomScale.value = bounds.minZoom;
    baseScale.value = bounds.minZoom;
    translateX.value = 0;
    baseTranslateX.value = 0;
    translateY.value = 0;
    baseTranslateY.value = 0;
    // Shared values are stable refs; only the camera inputs drive the reset.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera.scale, camera.tileWidth]);

  useEffect(() => {
    boardWidthSV.value = camera.boardWidth;
    boardHeightSV.value = camera.boardHeight;
    viewportWidthSV.value = camera.viewportWidth;
    viewportHeightSV.value = camera.viewportHeight;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera.boardWidth, camera.boardHeight, camera.viewportWidth, camera.viewportHeight]);

  const pinchGesture = Gesture.Pinch()
    .onUpdate((e) => {
      zoomScale.value = clamp(baseScale.value * e.scale, minZoom.value, maxZoom.value);
    })
    .onEnd(() => {
      baseScale.value = zoomScale.value;
      // Clamp pan position to the new (smaller) bounds when zooming out.
      const { maxTranslateX, maxTranslateY } = computePanBounds(
        boardWidthSV.value,
        boardHeightSV.value,
        viewportWidthSV.value,
        viewportHeightSV.value,
        zoomScale.value
      );
      translateX.value = clamp(translateX.value, -maxTranslateX, maxTranslateX);
      translateY.value = clamp(translateY.value, -maxTranslateY, maxTranslateY);
      baseTranslateX.value = translateX.value;
      baseTranslateY.value = translateY.value;
    });

  const panGesture = Gesture.Pan()
    .minPointers(1)
    .maxPointers(1)
    // Only activate after an intentional drag so simple taps on overlay buttons
    // (CTA shuffle, deadlock new-game, win new-game) are not intercepted by the
    // gesture recognizer before Pressable.onPress can fire.
    .activeOffsetX([-8, 8])
    .activeOffsetY([-8, 8])
    .onUpdate((e) => {
      const { maxTranslateX, maxTranslateY } = computePanBounds(
        boardWidthSV.value,
        boardHeightSV.value,
        viewportWidthSV.value,
        viewportHeightSV.value,
        zoomScale.value
      );
      translateX.value = clamp(
        baseTranslateX.value + e.translationX,
        -maxTranslateX,
        maxTranslateX
      );
      translateY.value = clamp(
        baseTranslateY.value + e.translationY,
        -maxTranslateY,
        maxTranslateY
      );
    })
    .onEnd(() => {
      baseTranslateX.value = translateX.value;
      baseTranslateY.value = translateY.value;
    });

  const boardGesture = Gesture.Simultaneous(pinchGesture, panGesture);

  const gestureAnimStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: zoomScale.value },
    ],
  }));

  // Zoom to fit, centred. Called from JS (an effect); the completion callbacks
  // are the only worklets, and they close over `target`, read at call time.
  const fitToScreen = useCallback(
    (reduceMotion: boolean) => {
      const target = minZoom.value;
      if (reduceMotion) {
        zoomScale.value = target;
        baseScale.value = target;
        translateX.value = 0;
        baseTranslateX.value = 0;
        translateY.value = 0;
        baseTranslateY.value = 0;
        return;
      }
      const cfg = { duration: FIT_ANIMATION_MS, easing: Easing.out(Easing.cubic) };
      // baseScale is updated in the completion callback so a pinch gesture started
      // during the animation doesn't jump from an intermediate position.
      zoomScale.value = withTiming(target, cfg, (finished) => {
        "worklet";
        if (finished) baseScale.value = target;
      });
      translateX.value = withTiming(0, cfg, (finished) => {
        "worklet";
        if (finished) baseTranslateX.value = 0;
      });
      translateY.value = withTiming(0, cfg, (finished) => {
        "worklet";
        if (finished) baseTranslateY.value = 0;
      });
    },
    // Shared values are stable Reanimated refs whose identity never changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  return { boardGesture, gestureAnimStyle, fitToScreen };
}
