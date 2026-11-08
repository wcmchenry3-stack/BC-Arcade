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
import { useEffect, useMemo, useRef, useState } from "react";
import {
  cancelAnimation,
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
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
/** How far apart (px) the two taps of a double-tap may land. */
const DOUBLE_TAP_SLOP = 24;

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
 * follow on completion; a gesture that starts mid-animation stops it and starts from the view
 * on screen (`beginGesture`).
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
  readonly activeGestures: SharedValue<number>;
  readonly autoFit: SharedValue<boolean>;
  readonly fitScale: SharedValue<number>;
  readonly fitX: SharedValue<number>;
  readonly fitY: SharedValue<number>;
  readonly reduceMotion: SharedValue<boolean>;
}

/** Zoomed in past the fitted view, so some remaining tiles may be off screen (the mini-map). */
const ZOOMED_IN = 1.02;

/**
 * The camera's JS-side actions over its shared values (built once per mount). `setZoomedIn`
 * hears whether each move ends zoomed in past the fitted view.
 */
function makeCameraActions(v: ZoomPanValues, setZoomedIn: (zoomedIn: boolean) => void) {
  /** Remember (scale, x, y) as the auto-fit view and move there. */
  const fitTo = (scale: number, x: number, y: number, reduceMotion: boolean) => {
    v.fitScale.value = scale;
    v.fitX.value = x;
    v.fitY.value = y;
    setZoomedIn(false);
    moveCamera(v, scale, x, y, reduceMotion);
  };
  /**
   * Zoom to readable tiles centred on board point (x, y), kept inside the pan bounds (the
   * double-tap, and the opening zoom on a board's top-left corner); pauses auto-fit.
   */
  const zoomInAt = (x: number, y: number): void => {
    v.autoFit.value = false;
    setZoomedIn(v.maxZoom.value > v.fitScale.value * ZOOMED_IN);
    const t = zoomToPoint(
      x,
      y,
      v.maxZoom.value,
      v.boardWidth.value,
      v.boardHeight.value,
      v.viewportWidth.value,
      v.viewportHeight.value
    );
    moveCamera(v, t.scale, t.translateX, t.translateY, v.reduceMotion.value);
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
      if (v.zoomScale.value > v.fitScale.value * ZOOMED_IN) {
        v.autoFit.value = true;
        setZoomedIn(false);
        moveCamera(v, v.fitScale.value, v.fitX.value, v.fitY.value, reduceMotion);
        return;
      }
      zoomInAt(x, y);
    },
    zoomInAt,
    /** The mini-map (#3612): centre board point (x, y) at the current zoom. */
    panTo(x: number, y: number): void {
      v.autoFit.value = false;
      const t = zoomToPoint(
        x,
        y,
        v.zoomScale.value,
        v.boardWidth.value,
        v.boardHeight.value,
        v.viewportWidth.value,
        v.viewportHeight.value
      );
      moveCamera(v, t.scale, t.translateX, t.translateY, v.reduceMotion.value);
    },
  };
}

/**
 * The camera's shared values, created in the caller's render, and the effects that keep them
 * in step with the camera: a new fit (orientation, resize, another layout) resets zoom to
 * fitted and the offset to centred (and calls `onReset`); the board and viewport sizes are
 * mirrored into shared values, so the pan-bound worklets read them on the UI thread instead of
 * closing over JS-side camera values that would go stale.
 */
function useZoomPanValues(
  camera: ZoomPanCamera,
  reduceMotion: boolean,
  resetKey: unknown,
  onReset: () => void
): ZoomPanValues {
  // minZoom = fit-to-screen scale; maxZoom = tile just reaches MIN_READABLE_TILE_PX.
  const { minZoom: initMin, maxZoom: initMax } = computeZoomBounds(camera.scale, camera.tileWidth);
  const v: ZoomPanValues = {
    minZoom: useSharedValue(initMin),
    maxZoom: useSharedValue(initMax),
    zoomScale: useSharedValue(initMin),
    baseScale: useSharedValue(initMin),
    translateX: useSharedValue(0),
    baseTranslateX: useSharedValue(0),
    translateY: useSharedValue(0),
    baseTranslateY: useSharedValue(0),
    boardWidth: useSharedValue(camera.boardWidth),
    boardHeight: useSharedValue(camera.boardHeight),
    viewportWidth: useSharedValue(camera.viewportWidth),
    viewportHeight: useSharedValue(camera.viewportHeight),
    // Re-fit (#3612): a pinch or pan in progress; whether the camera follows the remaining
    // tiles (false once the player zooms or pans away); the last auto-fit view.
    gestureActive: useSharedValue(false),
    activeGestures: useSharedValue(0),
    autoFit: useSharedValue(true),
    fitScale: useSharedValue(initMin),
    fitX: useSharedValue(0),
    fitY: useSharedValue(0),
    reduceMotion: useSharedValue(reduceMotion),
  };

  useEffect(() => {
    const bounds = computeZoomBounds(camera.scale, camera.tileWidth);
    v.minZoom.value = bounds.minZoom;
    v.maxZoom.value = bounds.maxZoom;
    v.zoomScale.value = bounds.minZoom;
    v.baseScale.value = bounds.minZoom;
    v.translateX.value = 0;
    v.baseTranslateX.value = 0;
    v.translateY.value = 0;
    v.baseTranslateY.value = 0;
    v.autoFit.value = true;
    v.fitScale.value = bounds.minZoom;
    v.fitX.value = 0;
    v.fitY.value = 0;
    onReset();
    // Shared values are stable refs; a new fit or a new deal (`resetKey`) drives the reset.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera.scale, camera.tileWidth, resetKey]);

  useEffect(() => {
    v.boardWidth.value = camera.boardWidth;
    v.boardHeight.value = camera.boardHeight;
    v.viewportWidth.value = camera.viewportWidth;
    v.viewportHeight.value = camera.viewportHeight;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera.boardWidth, camera.boardHeight, camera.viewportWidth, camera.viewportHeight]);

  useEffect(() => {
    v.reduceMotion.value = reduceMotion;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduceMotion]);

  return v;
}

/**
 * `resetKey` (the deal id) also resets the camera to fit: a new deal of the same layout keeps
 * the camera's fit, but not the zoom the last game ended on.
 */
export function useBoardZoomPan(
  camera: ZoomPanCamera,
  reduceMotion: boolean = false,
  resetKey?: unknown
) {
  const [zoomedIn, setZoomedIn] = useState(false);
  const v = useZoomPanValues(camera, reduceMotion, resetKey, () => setZoomedIn(false));
  const { zoomScale, baseScale, translateX, baseTranslateX, translateY, baseTranslateY } = v;

  const panBoundsNow = () => {
    "worklet";
    return computePanBounds(
      v.boardWidth.value,
      v.boardHeight.value,
      v.viewportWidth.value,
      v.viewportHeight.value,
      zoomScale.value
    );
  };

  // A pinch or pan starts: stop any camera animation (a re-fit, a double-tap) and start from
  // the view on screen, not the one it was heading to or came from.
  const beginGesture = () => {
    "worklet";
    v.activeGestures.value += 1;
    v.gestureActive.value = true;
    cancelAnimation(zoomScale);
    cancelAnimation(translateX);
    cancelAnimation(translateY);
    baseScale.value = zoomScale.value;
    baseTranslateX.value = translateX.value;
    baseTranslateY.value = translateY.value;
  };

  // At the end of the last gesture (a pinch can outlast the pan it began as): does the view
  // rest at fit, so auto-fit can resume?
  const endGesture = () => {
    "worklet";
    v.activeGestures.value = Math.max(0, v.activeGestures.value - 1);
    if (v.activeGestures.value > 0) return;
    v.gestureActive.value = false;
    const atWholeBoard = zoomScale.value <= v.minZoom.value * 1.02;
    const atLastFit =
      Math.abs(zoomScale.value - v.fitScale.value) <= v.fitScale.value * 0.02 &&
      Math.abs(translateX.value - v.fitX.value) <= 8 &&
      Math.abs(translateY.value - v.fitY.value) <= 8;
    v.autoFit.value = atWholeBoard || atLastFit;
    runOnJS(setZoomedIn)(zoomScale.value > v.fitScale.value * ZOOMED_IN);
  };

  const pinchGesture = Gesture.Pinch()
    .onStart(beginGesture)
    .onUpdate((e) => {
      zoomScale.value = clamp(baseScale.value * e.scale, v.minZoom.value, v.maxZoom.value);
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
    .onStart(beginGesture)
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

  // Shared values are stable Reanimated refs whose identity never changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const actions = useMemo(() => makeCameraActions(v, setZoomedIn), []);

  // Double-tap (#3612). On the JS thread: it moves the camera once, off the frame path.
  // Two quick taps on different tiles are a match, not a double-tap. `maxDistance` only bounds
  // movement within each press (the recogniser re-anchors on every press), so the presses'
  // positions are compared here.
  const tapDowns = useRef<{ x: number; y: number }[]>([]);
  const doubleTapGesture = Gesture.Tap()
    .numberOfTaps(2)
    .maxDelay(DOUBLE_TAP_MS)
    .maxDistance(DOUBLE_TAP_SLOP)
    .runOnJS(true)
    .onBegin(() => {
      tapDowns.current = [];
    })
    .onTouchesDown((e: { changedTouches: readonly { x: number; y: number }[] }) => {
      const t = e.changedTouches[0];
      if (t) tapDowns.current.push({ x: t.x, y: t.y });
    })
    .onEnd((e: { x: number; y: number }, success?: boolean) => {
      if (success === false) return;
      const [a, b] = tapDowns.current;
      if (a && b && Math.hypot(b.x - a.x, b.y - a.y) > DOUBLE_TAP_SLOP) return;
      actions.zoomAt(e.x, e.y);
    });

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
    panTo: actions.panTo,
    zoomInAt: actions.zoomInAt,
    /** Zoomed in past the fitted view: the mini-map shows. */
    zoomedIn,
    /** The live camera, for the mini-map's view window (read on the UI thread). */
    view: { zoomScale, translateX, translateY },
  };
}
