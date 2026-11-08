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
 *
 * Re-fit (#3612): `refit(rect)` eases the camera to fit a board-space rect (the remaining
 * tiles, after each match), up to the readable-tile zoom. It never moves during a pinch or
 * pan, and not while the player has zoomed or panned away by hand: that pauses auto-fit until
 * a gesture ends back at fit (the whole board, or the last auto-fit view) or `fitToScreen`.
 */
import { useEffect, useMemo } from "react";
import { Easing, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import type { SharedValue } from "react-native-reanimated";
import { Gesture } from "react-native-gesture-handler";

import type { BoardCamera } from "./layout";
import { clamp, computePanBounds, computeZoomBounds, fitRect, zoomToPoint } from "./zoom";
import type { BoardRect } from "./zoom";

type ZoomPanCamera = Pick<
  BoardCamera,
  "scale" | "tileWidth" | "boardWidth" | "boardHeight" | "viewportWidth" | "viewportHeight"
>;

const FIT_ANIMATION_MS = 350;
/** Two taps this close together are a double-tap (#3612); a tile ignores the second. */
export const DOUBLE_TAP_MS = 300;

/** The camera's live and gesture-start zoom and offset. */
interface CameraValues {
  readonly zoomScale: SharedValue<number>;
  readonly baseScale: SharedValue<number>;
  readonly translateX: SharedValue<number>;
  readonly baseTranslateX: SharedValue<number>;
  readonly translateY: SharedValue<number>;
  readonly baseTranslateY: SharedValue<number>;
}

/**
 * Move the camera to (scale, x, y): at once under Reduce Motion, else over FIT_ANIMATION_MS.
 * Called from JS; the completion callbacks are the only worklets. The gesture-start values
 * follow on completion, so a pinch started mid-animation doesn't jump from an intermediate
 * position.
 */
function moveCamera(
  v: CameraValues,
  scale: number,
  x: number,
  y: number,
  reduceMotion: boolean
): void {
  if (reduceMotion) {
    v.zoomScale.value = scale;
    v.baseScale.value = scale;
    v.translateX.value = x;
    v.baseTranslateX.value = x;
    v.translateY.value = y;
    v.baseTranslateY.value = y;
    return;
  }
  const cfg = { duration: FIT_ANIMATION_MS, easing: Easing.out(Easing.cubic) };
  v.zoomScale.value = withTiming(scale, cfg, (finished) => {
    "worklet";
    if (finished) v.baseScale.value = scale;
  });
  v.translateX.value = withTiming(x, cfg, (finished) => {
    "worklet";
    if (finished) v.baseTranslateX.value = x;
  });
  v.translateY.value = withTiming(y, cfg, (finished) => {
    "worklet";
    if (finished) v.baseTranslateY.value = y;
  });
}

/** Every shared value the camera actions read or write. */
interface ZoomPanValues extends CameraValues {
  readonly minZoom: SharedValue<number>;
  readonly maxZoom: SharedValue<number>;
  readonly boardWidth: SharedValue<number>;
  readonly boardHeight: SharedValue<number>;
  readonly viewportWidth: SharedValue<number>;
  readonly viewportHeight: SharedValue<number>;
  readonly gestureActive: SharedValue<boolean>;
  readonly autoFit: SharedValue<boolean>;
  readonly fitScale: SharedValue<number>;
  readonly fitX: SharedValue<number>;
  readonly fitY: SharedValue<number>;
  readonly reduceMotion: SharedValue<boolean>;
}

/** The camera's JS-side actions over its shared values (built once per mount). */
function makeCameraActions(v: ZoomPanValues) {
  /** Remember (scale, x, y) as the auto-fit view and move there. */
  const fitTo = (scale: number, x: number, y: number, reduceMotion: boolean) => {
    v.fitScale.value = scale;
    v.fitX.value = x;
    v.fitY.value = y;
    moveCamera(v, scale, x, y, reduceMotion);
  };
  return {
    /** Zoom to fit the whole board, centred, and follow the remaining tiles again. */
    fitToScreen(reduceMotion: boolean): void {
      v.autoFit.value = true;
      fitTo(v.minZoom.value, 0, 0, reduceMotion);
    },
    /**
     * Fit `rect` (the remaining tiles) unless a gesture is in progress or the player has zoomed
     * or panned away; returns whether the camera moved.
     */
    refit(rect: BoardRect, reduceMotion: boolean): boolean {
      if (v.gestureActive.value || !v.autoFit.value) return false;
      const t = fitRect(
        rect,
        v.boardWidth.value,
        v.boardHeight.value,
        v.viewportWidth.value,
        v.viewportHeight.value,
        v.minZoom.value,
        v.maxZoom.value
      );
      fitTo(t.scale, t.translateX, t.translateY, reduceMotion);
      return true;
    },
    /**
     * The double-tap (#3612), at board point (x, y): zoomed in past the fitted view, back to
     * it (and follow the tiles again); else zoom to readable tiles centred on the tap.
     */
    zoomAt(x: number, y: number): void {
      const reduceMotion = v.reduceMotion.value;
      if (v.zoomScale.value > v.fitScale.value * 1.02) {
        v.autoFit.value = true;
        moveCamera(v, v.fitScale.value, v.fitX.value, v.fitY.value, reduceMotion);
        return;
      }
      v.autoFit.value = false;
      const t = zoomToPoint(
        x,
        y,
        v.maxZoom.value,
        v.boardWidth.value,
        v.boardHeight.value,
        v.viewportWidth.value,
        v.viewportHeight.value
      );
      moveCamera(v, t.scale, t.translateX, t.translateY, reduceMotion);
    },
  };
}

export function useBoardZoomPan(camera: ZoomPanCamera, reduceMotion: boolean = false) {
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
  // Re-fit (#3612): a pinch or pan in progress; whether the camera follows the remaining
  // tiles (false once the player zooms or pans away); the last auto-fit view.
  const gestureActive = useSharedValue(false);
  const autoFit = useSharedValue(true);
  const fitScale = useSharedValue(initMin);
  const fitX = useSharedValue(0);
  const fitY = useSharedValue(0);

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
    autoFit.value = true;
    fitScale.value = bounds.minZoom;
    fitX.value = 0;
    fitY.value = 0;
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

  const panBoundsNow = () => {
    "worklet";
    return computePanBounds(
      boardWidthSV.value,
      boardHeightSV.value,
      viewportWidthSV.value,
      viewportHeightSV.value,
      zoomScale.value
    );
  };

  // At the end of a gesture: does the view rest at fit, so auto-fit can resume?
  const endGesture = () => {
    "worklet";
    gestureActive.value = false;
    const atWholeBoard = zoomScale.value <= minZoom.value * 1.02;
    const atLastFit =
      Math.abs(zoomScale.value - fitScale.value) <= fitScale.value * 0.02 &&
      Math.abs(translateX.value - fitX.value) <= 8 &&
      Math.abs(translateY.value - fitY.value) <= 8;
    autoFit.value = atWholeBoard || atLastFit;
  };

  const pinchGesture = Gesture.Pinch()
    .onStart(() => {
      gestureActive.value = true;
    })
    .onUpdate((e) => {
      zoomScale.value = clamp(baseScale.value * e.scale, minZoom.value, maxZoom.value);
    })
    .onEnd(() => {
      baseScale.value = zoomScale.value;
      // Clamp pan position to the new (smaller) bounds when zooming out.
      const { maxTranslateX, maxTranslateY } = panBoundsNow();
      translateX.value = clamp(translateX.value, -maxTranslateX, maxTranslateX);
      translateY.value = clamp(translateY.value, -maxTranslateY, maxTranslateY);
      baseTranslateX.value = translateX.value;
      baseTranslateY.value = translateY.value;
      endGesture();
    });

  const panGesture = Gesture.Pan()
    .minPointers(1)
    .maxPointers(1)
    // Only activate after an intentional drag so simple taps on overlay buttons
    // (CTA shuffle, deadlock new-game, win new-game) are not intercepted by the
    // gesture recognizer before Pressable.onPress can fire.
    .activeOffsetX([-8, 8])
    .activeOffsetY([-8, 8])
    .onStart(() => {
      gestureActive.value = true;
    })
    .onUpdate((e) => {
      const { maxTranslateX, maxTranslateY } = panBoundsNow();
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
      endGesture();
    });

  const reduceMotionSV = useSharedValue(reduceMotion);
  useEffect(() => {
    reduceMotionSV.value = reduceMotion;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduceMotion]);
  const actions = useMemo(
    () =>
      makeCameraActions({
        zoomScale,
        baseScale,
        translateX,
        baseTranslateX,
        translateY,
        baseTranslateY,
        minZoom,
        maxZoom,
        boardWidth: boardWidthSV,
        boardHeight: boardHeightSV,
        viewportWidth: viewportWidthSV,
        viewportHeight: viewportHeightSV,
        gestureActive,
        autoFit,
        fitScale,
        fitX,
        fitY,
        reduceMotion: reduceMotionSV,
      }),
    // Shared values are stable Reanimated refs whose identity never changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  // Double-tap (#3612). On the JS thread: it moves the camera once, off the frame path.
  const doubleTapGesture = Gesture.Tap()
    .numberOfTaps(2)
    .maxDelay(DOUBLE_TAP_MS)
    .runOnJS(true)
    .onEnd((e: { x: number; y: number }) => actions.zoomAt(e.x, e.y));

  const boardGesture = Gesture.Simultaneous(pinchGesture, panGesture, doubleTapGesture);

  const gestureAnimStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: zoomScale.value },
    ],
  }));

  return {
    boardGesture,
    gestureAnimStyle,
    fitToScreen: actions.fitToScreen,
    refit: actions.refit,
    zoomAt: actions.zoomAt,
  };
}
