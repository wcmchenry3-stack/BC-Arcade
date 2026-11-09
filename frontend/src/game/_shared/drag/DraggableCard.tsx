import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { Platform } from "react-native";
import type { AccessibilityActionEvent, Insets } from "react-native";
import Animated, { useAnimatedRef, measure as rnMeasure } from "react-native-reanimated";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { useSharedValue, runOnJS } from "react-native-reanimated";
import { useDragApi, useDragSelector, isCardInDragStack } from "./DragContext";
import type { DragCard, DragSource, DragState } from "./DragContext";
import {
  computeDragOrigin,
  computeGhostOffset,
  dragTolerance,
  GHOST_LIFT,
  SURFACE_OFFSET_TOL,
  surfaceOffsetFails,
  judgeGhostFollowUp,
} from "./dragGeometry";
import { recordGhostCheck, recordGhostOffset } from "./dragDiagnostics";
import { noteDragDebugDrop } from "./dragDebug";
import type { DragStartDiagnostics, GhostCheckSummary, GhostOffsetReport } from "./dragDiagnostics";
import {
  GHOST_FAIL,
  GHOST_IDLE,
  GHOST_LAG,
  GHOST_OK,
  GHOST_PENDING,
  GHOST_UNMEASURED,
  idleGhostCheck,
} from "./ghostCheckState";
import type { GhostCheckState } from "./ghostCheckState";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyProps = Record<string, any>;

// Stable reference — re-creating this array every render would otherwise
// force a fresh accessibilityActions prop identity on every re-render.
const ACTIVATE_ACCESSIBILITY_ACTION = [{ name: "activate" }] as const;

// Rendered-ghost check (#3528). Once per drag the ghost's Animated.View is
// measured and compared with where the finger says it should be. Budget: at
// most GHOST_CHECK_MAX_MEASURES ghost measure() calls mid-drag (1 normally, a
// 2nd only if the first returned null), plus 1 at the drag's end when no
// verdict was reached mid-drag (#3532), plus 1 container measure only when
// the check fails. `unmeasured` is decided only at the end: the ghost never
// mounted, or never measured, while the finger was down. The ghost is never measured before DragGhostHost reports it
// mounted (`ghostMounted`). Never per frame: once the check has run, onUpdate
// is back to arithmetic only. The per-drag state lives in DragProvider
// (`ghostCheck`), not in each card.
/** The check waits this long after onStart so the ghost has rendered
 *  (the root host mounts it a React commit later). It also
 *  spaces a retry after a null measure or a not-yet-mounted ghost. */
export const GHOST_CHECK_DELAY_MS = 100;
/** Ghost measure() calls for the first sample, mid-drag, at most. */
export const GHOST_CHECK_MAX_MEASURES = 2;
/** Ghost measure() calls per drag in all, at most: the first sample's, a lag
 *  follow-up (#3532) and the end's last attempt share this budget. */
export const GHOST_CHECK_TOTAL_MEASURES = 3;
/** Check attempts per drag, at most, counting the ones that found the ghost
 *  not mounted yet (those make no measure). */
export const GHOST_CHECK_MAX_ATTEMPTS = 5;

/** True when an animated ref points at a view. On the UI thread the ref is a
 *  function returning the view's shadow-node wrapper, null until the view
 *  first mounts; measure() only guards -1, so measuring a null ref throws.
 *  (Jest's Reanimated mock hands out plain objects, which count as attached.) */
function refAttached(ref: unknown): boolean {
  "worklet";
  return typeof ref !== "function" || (ref as () => unknown)() != null;
}

const HIDDEN_STYLE = { opacity: 0 } as const;
const VISIBLE_STYLE = { opacity: 1 } as const;

export interface DraggableCardProps {
  children: React.ReactNode;
  style?: object;
  testID?: string;
  /** Tap fallback — same behavior as the old onPress. */
  onTap?: () => void;
  /** Screen-reader label for this card. Required (together with `onTap`) to
   *  expose this as an accessible, activatable element — see the
   *  accessibility note below. */
  accessibilityLabel?: string;
  /** Screen-reader hint ("Can move here"); applied only when the card is accessible. */
  accessibilityHint?: string;
  /** The card(s) that will be dragged. For a tableau run, pass all cards
   *  from fromIndex to end of pile. */
  dragCards: DragCard[];
  /** Identifies this card in the drag system. */
  dragSource: DragSource;
  /** Set false for face-down cards that cannot be picked up. */
  draggable?: boolean;
  /** Expand the touch hit area beyond the card bounds. On web this is
   *  converted to padding + negative margin to avoid layout shift. */
  hitSlop?: Insets;
}

export function DraggableCard({
  children,
  style,
  testID,
  onTap,
  accessibilityLabel,
  accessibilityHint,
  dragCards,
  dragSource,
  draggable = true,
  hitSlop,
}: DraggableCardProps) {
  // useAnimatedRef lets worklets call rnMeasure(viewRef) for reliable iOS position reads.
  const viewRef = useAnimatedRef<Animated.View>();

  // The provider's stable API (#2264): reading it never re-renders this card
  // when a drag starts or ends. The drag state is read below through
  // useDragSelector, for this card's own "am I dragged" bit only.
  const {
    cardX,
    cardY,
    originX,
    originY,
    containerOffsetX,
    containerOffsetY,
    containerWidth,
    containerHeight,
    containerMeasuredAt,
    containerRef,
    ghostRef,
    ghostMounted,
    ghostCheck,
    grabX,
    grabY,
    diagnosticTags,
    startDrag,
    endDrag,
    snapBackAndClear,
    cancelDrag,
  } = useDragApi();

  // Props the gesture's JS callbacks read when they run, through refs, so
  // the callbacks (and the memoized gesture below) keep one identity although
  // boards pass fresh `dragSource` / `dragCards` / `onTap` on every render
  // (#2264). JS thread only: the worklets never read these refs.
  const dragSourceRef = useRef(dragSource);
  const dragCardsRef = useRef(dragCards);
  const onTapRef = useRef(onTap);
  const diagnosticTagsRef = useRef(diagnosticTags);
  useLayoutEffect(() => {
    dragSourceRef.current = dragSource;
    dragCardsRef.current = dragCards;
    onTapRef.current = onTap;
    diagnosticTagsRef.current = diagnosticTags;
  });

  // The drag this card started, kept on the JS thread. The cancel effects
  // below compare it with the context's current drag instead of reading the
  // `panActivated` shared value from JS (a JS read of a shared value can be a
  // stale cached copy, #2772) — and so only ever cancel this card's own drag.
  const ownDragRef = useRef<DragState | null>(null);
  const triggerStartDrag = useCallback(
    (origin: DragStartDiagnostics) => {
      ownDragRef.current = startDrag(dragSourceRef.current, dragCardsRef.current, origin);
    },
    [startDrag]
  );

  // JS ends of the pan's end hops. The ghost check's short result rides the
  // hop onEnd/onFinalize already make, so a passing drag adds no hop (#3528).
  const finishDrop = useCallback(
    (
      absoluteX: number,
      absoluteY: number,
      ghost: GhostCheckSummary | null,
      dx: number,
      dy: number
    ) => {
      const source = dragSourceRef.current;
      if (ghost) recordGhostCheck(ghost, source.game, source.type);
      // The ghost's offset from its pickup (#3572): a board may settle the drop from there.
      endDrag(absoluteX, absoluteY, { dx, dy });
    },
    [endDrag]
  );
  const finishSnapBack = useCallback(
    (ghost: GhostCheckSummary | null) => {
      const source = dragSourceRef.current;
      if (ghost) recordGhostCheck(ghost, source.game, source.type);
      // The pan ended without a lift (system cancel, or onFinalize without
      // onEnd): no hit-test ran. Shown on the debug overlay (#3532).
      noteDragDebugDrop({ kind: "cancelled", reason: "gesture" });
      snapBackAndClear();
    },
    [snapBackAndClear]
  );
  const reportGhostOffset = useCallback((d: GhostOffsetReport) => {
    const source = dragSourceRef.current;
    recordGhostOffset(d, source.game, source.type, diagnosticTagsRef.current);
  }, []);
  const handleTap = useCallback(() => {
    onTapRef.current?.();
  }, []);
  const hasTap = onTap !== undefined;

  // hitSlop by value: boards build it inline, and a fresh object must not
  // rebuild the gesture (#2264).
  const slopTop = hitSlop?.top;
  const slopBottom = hitSlop?.bottom;
  const slopLeft = hitSlop?.left;
  const slopRight = hitSlop?.right;
  const hasSlop = hitSlop !== undefined;
  const slop = useMemo<Insets | undefined>(
    () =>
      hasSlop ? { top: slopTop, bottom: slopBottom, left: slopLeft, right: slopRight } : undefined,
    [hasSlop, slopTop, slopBottom, slopLeft, slopRight]
  );

  const panActivated = useSharedValue(false);
  // Finger-anchored ghost (#3531): the finger's offset inside the card at
  // activation, from RNGH alone, fixed at onStart. onUpdate is then
  // `finger − grab`: arithmetic only, with no layout measure anywhere in the
  // ghost's position, so it can't drift from the finger.
  // Plain numbers for the worklet closure.
  const cardWidth = dragCards[0]?.width ?? 0;
  const cardHeight = dragCards[0]?.height ?? 0;
  const ghostCheckEnabled = Platform.OS !== "web";

  // A card that unmounts (its pile changed under the drag) or stops being
  // draggable mid-pan has its native handler dropped: neither onEnd nor
  // onFinalize will ever arrive, so end the drag here instead (#2772).
  const cancelDragRef = useRef(cancelDrag);
  cancelDragRef.current = cancelDrag;
  useEffect(() => {
    if (draggable || ownDragRef.current === null) return;
    cancelDragRef.current("draggableDisabled", ownDragRef.current);
    ownDragRef.current = null;
  }, [draggable]);
  useEffect(
    () => () => {
      if (ownDragRef.current !== null) cancelDragRef.current("sourceUnmounted", ownDragRef.current);
    },
    []
  );

  // Built once per card, not on every render (#2264): a re-render (a drag
  // starting, the board updating) must not hand RNGH fresh worklets. Every
  // value the worklets read is a shared value, an animated ref, a stable
  // callback (above, reading the latest props through refs) or a dep here.
  const gesture = useMemo(() => {
    /** Measures the ghost and checks it against the finger the current frame
     *  was drawn for (#3528). A fail makes the one runOnJS hop; any other
     *  result is kept for the end hop. A ghost that is not mounted yet is not
     *  measured; it, and a null measure, are retried GHOST_CHECK_DELAY_MS later
     *  while mid-drag and within the attempt and measure budgets. */
    const checkGhost = (
      s: GhostCheckState,
      curX: number,
      curY: number,
      velocityX: number,
      velocityY: number,
      at: "update" | "end"
    ) => {
      "worklet";
      const now = Date.now();
      s.attempts += 1;
      const canRetry = at === "update" && s.attempts < GHOST_CHECK_MAX_ATTEMPTS;
      const tol = dragTolerance(cardHeight);
      const stepX = s.lastFingerX - s.prevFingerX;
      const stepY = s.lastFingerY - s.prevFingerY;
      const shownCardX = cardX.value;
      const shownCardY = cardY.value;
      // The lag-free surface signal (#3531 review 2): where the RN surface sits
      // in RNGH space, from onStart values only. Null without a card measure.
      const surface = s.cardMeasured
        ? {
            x: s.fingerStartX - s.grabX - s.cardMeasuredX,
            y: s.fingerStartY - s.grabY - s.cardMeasuredY,
          }
        : null;
      // One runOnJS hop, only on a fail. `g` null: the ghost was never measured.
      const report = (
        failKind: GhostOffsetReport["failKind"],
        g: { pageX: number; pageY: number } | null,
        r: {
          deltaX: number;
          deltaY: number;
          deltaMeasureX: number;
          deltaMeasureY: number;
          failGesture: boolean;
          failMeasure: boolean;
          expectedX: number;
          expectedY: number;
        }
      ) => {
        s.state = GHOST_FAIL;
        const c = rnMeasure(containerRef);
        runOnJS(reportGhostOffset)({
          failKind,
          deltaX: r.deltaX,
          deltaY: r.deltaY,
          deltaMeasureX: r.deltaMeasureX,
          deltaMeasureY: r.deltaMeasureY,
          failGesture: r.failGesture,
          failMeasure: r.failMeasure,
          fingerX: s.lastFingerX,
          fingerY: s.lastFingerY,
          ghostPageX: g ? g.pageX : NaN,
          ghostPageY: g ? g.pageY : NaN,
          expectedX: r.expectedX,
          expectedY: r.expectedY,
          grabX: s.grabX,
          grabY: s.grabY,
          cardX: shownCardX,
          cardY: shownCardY,
          containerPageX: c ? c.pageX : NaN,
          containerPageY: c ? c.pageY : NaN,
          containerUsedX: s.containerUsedX,
          containerUsedY: s.containerUsedY,
          cardSource: s.cardSource,
          containerSource: s.containerSource,
          cardMismatch: s.cardMismatch,
          cardMeasuredX: s.cardMeasured ? s.cardMeasuredX : NaN,
          cardMeasuredY: s.cardMeasured ? s.cardMeasuredY : NaN,
          surfaceOffsetX: surface ? surface.x : NaN,
          surfaceOffsetY: surface ? surface.y : NaN,
          fingerStepX: curX - s.lastFingerX,
          fingerStepY: curY - s.lastFingerY,
          tolX: tol + Math.abs(stepX),
          tolY: tol + Math.abs(stepY),
          velocityX,
          velocityY,
          msSinceStart: now - s.startedAt,
          measures: s.measures,
          at,
        });
      };
      // The ghost can't be measured (not mounted, or null twice). The render
      // side can say nothing, but the surface signal needs no ghost: a surface
      // offset is still reported, as measureSpace with the ghost fields NaN.
      const giveUp = () => {
        if (!surfaceOffsetFails(surface, SURFACE_OFFSET_TOL)) {
          s.state = GHOST_UNMEASURED;
          s.endedAt = now;
          return;
        }
        report("measureSpace", null, {
          deltaX: NaN,
          deltaY: NaN,
          deltaMeasureX: NaN,
          deltaMeasureY: NaN,
          failGesture: false,
          failMeasure: true,
          expectedX: s.lastFingerX - s.grabX,
          expectedY: s.lastFingerY - s.grabY,
        });
      };
      // Out of mid-drag budget: wait for the drag's end, which always makes one
      // last attempt (#3532). Giving up mid-drag left a ghost that mounted late
      // (a busy first drag, sparse iOS move events) `unmeasured` although it was
      // on screen under the finger by the drop.
      const stopUntilEnd = () => {
        s.nextCheckAt = Infinity;
      };
      // A `lag` first sample whose follow-up can't be taken (no budget, the
      // ghost gone, a null measure at the end) keeps the first verdict: a
      // trailing ghost, not an offset (#3532).
      const lagAsOk = () => {
        s.deltaX = s.lagDeltaX;
        s.deltaY = s.lagDeltaY;
        s.state = GHOST_OK;
      };
      if (s.state === GHOST_LAG && s.measures >= GHOST_CHECK_TOTAL_MEASURES) {
        lagAsOk();
        return;
      }
      if (!ghostMounted.value || !refAttached(ghostRef)) {
        // Why it can't be measured, kept for an `unmeasured` verdict (#3532).
        s.why = ghostMounted.value ? "noRef" : "notMounted";
        if (s.state === GHOST_LAG) lagAsOk();
        else if (canRetry) s.nextCheckAt = now + GHOST_CHECK_DELAY_MS;
        else if (at === "update") stopUntilEnd();
        else giveUp();
        return;
      }
      if (s.mountSeenAt === 0) s.mountSeenAt = now;
      s.measures += 1;
      const g = rnMeasure(ghostRef);
      if (g !== null && Number.isFinite(g.pageX) && Number.isFinite(g.pageY)) {
        // For the debug overlay (#3529): the real measured frame, recorded
        // before the verdict so a ghost stuck at the host origin shows there.
        s.ghostMeasured = true;
        s.ghostPageX = g.pageX;
        s.ghostPageY = g.pageY;
      }
      const res = computeGhostOffset({
        ghost: g,
        fingerX: s.lastFingerX,
        fingerY: s.lastFingerY,
        // Lag allowance (#3532): measure() can return a transform a few
        // frames old; the box of the finger's path since onStart.
        lag: {
          minX: s.minFingerX,
          maxX: s.maxFingerX,
          minY: s.minFingerY,
          maxY: s.maxFingerY,
        },
        grabX: s.grabX,
        grabY: s.grabY,
        lift: GHOST_LIFT,
        tol,
        stepX,
        stepY,
        measureExpected: s.cardMeasured
          ? {
              x: s.cardMeasuredX + (s.lastFingerX - s.fingerStartX),
              y: s.cardMeasuredY + (s.lastFingerY - s.fingerStartY),
            }
          : null,
        // The measure-space verdict: the surface offset against a fixed 12 px.
        surfaceOffset: surface,
        surfaceTol: SURFACE_OFFSET_TOL,
        // The ghost is drawn in the root host, whose origin is RNGH's (0, 0).
        rendered: {
          containerX: 0,
          containerY: 0,
          cardX: shownCardX,
          cardY: shownCardY,
        },
      });
      if (res.status === "unmeasured" || g === null) {
        s.why = "nullMeasure";
        if (s.state === GHOST_LAG) {
          if (at === "update" && s.measures < GHOST_CHECK_TOTAL_MEASURES) {
            s.nextCheckAt = now + GHOST_CHECK_DELAY_MS;
          } else {
            lagAsOk();
          }
        } else if (canRetry && s.measures < GHOST_CHECK_MAX_MEASURES) {
          s.nextCheckAt = now + GHOST_CHECK_DELAY_MS;
        } else if (at === "update") {
          stopUntilEnd();
        } else {
          giveUp();
        }
        return;
      }
      s.deltaX = res.deltaX;
      s.deltaY = res.deltaY;
      s.deltaMeasureX = res.deltaMeasureX;
      s.deltaMeasureY = res.deltaMeasureY;
      const gestureOnly = res.status === "ok" || res.status === "lag" || !res.failMeasure;
      if (s.state === GHOST_LAG && res.status !== "transformIgnored" && gestureOnly) {
        // No evidence yet (a lift right after the lag sample: the finger hasn't
        // moved a tolerance and not a check interval has passed): keep the lag.
        const travelX = s.lastFingerX - s.lagFingerX;
        const travelY = s.lastFingerY - s.lagFingerY;
        if (
          now - s.lagAt < GHOST_CHECK_DELAY_MS &&
          Math.sqrt(travelX * travelX + travelY * travelY) < tol
        ) {
          lagAsOk();
          return;
        }
        // The follow-up (#3532): caught up, or still trailing but moving with
        // the finger, is lag; frozen or moving the wrong way is a render fail.
        const ok = judgeGhostFollowUp(
          {
            deltaX: s.lagDeltaX,
            deltaY: s.lagDeltaY,
            fingerX: s.lagFingerX,
            fingerY: s.lagFingerY,
          },
          {
            deltaX: res.deltaX,
            deltaY: res.deltaY,
            fingerX: s.lastFingerX,
            fingerY: s.lastFingerY,
          },
          res.status,
          tol
        );
        if (ok) {
          s.state = GHOST_OK;
          return;
        }
        report("render", g, { ...res, failGesture: true });
        return;
      }
      if (res.status === "lag") {
        if (at === "end") {
          // No follow-up possible: the first sample is the drag's end. Kept as
          // lag (a documented blind spot of a gesture this sparse).
          s.state = GHOST_OK;
          return;
        }
        s.state = GHOST_LAG;
        s.lagDeltaX = res.deltaX;
        s.lagDeltaY = res.deltaY;
        s.lagFingerX = s.lastFingerX;
        s.lagFingerY = s.lastFingerY;
        s.lagAt = now;
        s.nextCheckAt = now + GHOST_CHECK_DELAY_MS;
        return;
      }
      if (res.status === "ok") {
        s.state = GHOST_OK;
        return;
      }
      // render: the ghost is not where the host was asked to draw it (the
      // host shifted inside the RN layout). transformIgnored: stuck at the
      // host's origin. measureSpace: the RN surface is offset from RNGH's
      // origin by more than SURFACE_OFFSET_TOL, which the player sees as the
      // ghost that far from the finger (or a stale card measure, a one-off).
      report(
        res.status === "transformIgnored"
          ? "transformIgnored"
          : res.failGesture
            ? "render"
            : "measureSpace",
        g,
        res
      );
    };

    /** The pending check's finger history: the last two fingers and the
     *  running min/max box (#3532). Scalar compares and writes, no allocation. */
    const trackFinger = (gc: GhostCheckState, x: number, y: number) => {
      "worklet";
      gc.prevFingerX = gc.lastFingerX;
      gc.prevFingerY = gc.lastFingerY;
      gc.lastFingerX = x;
      gc.lastFingerY = y;
      if (x < gc.minFingerX) gc.minFingerX = x;
      if (x > gc.maxFingerX) gc.maxFingerX = x;
      if (y < gc.minFingerY) gc.minFingerY = y;
      if (y > gc.maxFingerY) gc.maxFingerY = y;
    };

    /** The check's result for the end hop; null when there is nothing to add
     *  (a fail already made its own hop, or no check ran). */
    const ghostSummary = (): GhostCheckSummary | null => {
      "worklet";
      const s = ghostCheck.value;
      const st = s.state;
      if (st === GHOST_OK) {
        return {
          status: "ok",
          deltaX: s.deltaX,
          deltaY: s.deltaY,
          deltaMeasureX: s.deltaMeasureX,
          deltaMeasureY: s.deltaMeasureY,
        };
      }
      // A drag that ended with the check still pending made no attempt at
      // all (an end that skipped onEnd): unmeasured, "noSample" (#3532).
      const noSample = st === GHOST_PENDING || st === GHOST_LAG;
      if (st === GHOST_UNMEASURED || noSample) {
        return {
          status: "unmeasured",
          deltaX: 0,
          deltaY: 0,
          deltaMeasureX: 0,
          deltaMeasureY: 0,
          why: noSample ? "noSample" : s.why,
          attempts: s.attempts,
          measures: s.measures,
          mountMs: s.mountSeenAt > 0 ? s.mountSeenAt - s.startedAt : -1,
          endMs: (noSample || s.endedAt === 0 ? Date.now() : s.endedAt) - s.startedAt,
        };
      }
      return null;
    };

    // minDistance(5) replaces activeOffsetX/Y([-12,12]) — 12 px was too coarse for
    // FreeCell's narrower cards, causing drags to feel unresponsive.
    // hitSlop is applied to the gesture directly (not the wrapper View) — RNGH does
    // not inherit hitSlop from parent views, so it must be on the gesture itself.
    const pan = Gesture.Pan().minPointers(1).minDistance(5).enabled(draggable);
    if (slop) pan.hitSlop(slop);
    pan
      .onBegin(() => {
        "worklet";
        // A new touch on this card: forget any activation whose end was lost
        // (the handler was dropped), so a later finalize can't snap back a
        // drag this pan never started.
        panActivated.value = false;
      })
      .onStart((e) => {
        "worklet";
        panActivated.value = true;
        // The ghost's position comes from the finger alone (#3531). The grab
        // is the finger's offset inside the card's gesture view at activation
        // (`e.x/y`; the view hasn't moved). RNGH resets the translation to 0
        // when the pan activates (iOS, Android and web), so the ghost starts
        // exactly on the card; subtracting the translation only keeps the math
        // right if a future RNGH ever reported one here. The card's window
        // position is `startFinger − grab` (= absolute − x): where the ghost
        // starts and where a snap-back returns. absoluteX/Y share the root
        // ghost host's origin, so no measure is needed (or used) to place it.
        const startFingerX = e.absoluteX - e.translationX;
        const startFingerY = e.absoluteY - e.translationY;
        const gX = e.x - e.translationX;
        const gY = e.y - e.translationY;
        grabX.value = gX;
        grabY.value = gY;
        // Writing these cancels any snap-back spring still running from the previous
        // drag; that drag's clear is generation-guarded in DragContext.
        originX.value = startFingerX - gX;
        originY.value = startFingerY - gY;
        cardX.value = e.absoluteX - gX;
        cardY.value = e.absoluteY - gY;

        // Diagnostics only (#3397, #3528): the card and container measures
        // never position the ghost. They feed drag.start / drag.positionMismatch
        // (does measure() page space agree with RNGH?) and the ghost check's
        // measure-space comparison.
        const cardMeasured = rnMeasure(viewRef);
        const containerMeasured = rnMeasure(containerRef);
        const now = Date.now();
        const measuredAt = containerMeasuredAt.value;
        const origin = computeDragOrigin({
          card: cardMeasured,
          container: containerMeasured,
          cachedContainer: {
            x: containerOffsetX.value,
            y: containerOffsetY.value,
            width: containerWidth.value,
            height: containerHeight.value,
          },
          gesture: { absoluteX: e.absoluteX, absoluteY: e.absoluteY, x: e.x, y: e.y },
          cardSize: { width: cardWidth, height: cardHeight },
        });
        if (origin.containerSource === "measured" && containerMeasured) {
          containerOffsetX.value = containerMeasured.pageX;
          containerOffsetY.value = containerMeasured.pageY;
          containerWidth.value = containerMeasured.width;
          containerHeight.value = containerMeasured.height;
          containerMeasuredAt.value = now;
        }
        // Ghost check (#3528): a fresh per-drag state in DragProvider (one
        // allocation per drag). Its grab is the positioning grab, so the check
        // compares the rendered ghost with exactly `finger − grab − lift`.
        const gc = idleGhostCheck();
        // Web: measure() warns and returns null, so the check can say nothing.
        // Leave the state idle: no measures, no tracking, no breadcrumb.
        gc.state = ghostCheckEnabled ? GHOST_PENDING : GHOST_IDLE;
        gc.startedAt = now;
        gc.nextCheckAt = now + GHOST_CHECK_DELAY_MS;
        gc.grabX = gX;
        gc.grabY = gY;
        gc.fingerStartX = startFingerX;
        gc.fingerStartY = startFingerY;
        gc.minFingerX = startFingerX;
        gc.maxFingerX = startFingerX;
        gc.minFingerY = startFingerY;
        gc.maxFingerY = startFingerY;
        gc.lastFingerX = e.absoluteX;
        gc.lastFingerY = e.absoluteY;
        gc.prevFingerX = e.absoluteX;
        gc.prevFingerY = e.absoluteY;
        gc.containerUsedX = origin.containerX;
        gc.containerUsedY = origin.containerY;
        gc.cardSource = origin.cardSource;
        gc.containerSource = origin.containerSource;
        gc.cardMismatch = origin.cardMismatch;
        // The card's own measure, accepted or not: the measure-space side of
        // the check, which a constant RNGH-vs-measure() offset can't cancel.
        if (
          cardMeasured !== null &&
          Number.isFinite(cardMeasured.pageX) &&
          Number.isFinite(cardMeasured.pageY)
        ) {
          gc.cardMeasured = true;
          gc.cardMeasuredX = cardMeasured.pageX;
          gc.cardMeasuredY = cardMeasured.pageY;
        }
        ghostCheck.value = gc;
        runOnJS(triggerStartDrag)({
          cardSource: origin.cardSource,
          containerSource: origin.containerSource,
          anomalous: origin.anomalous,
          cardMismatch: origin.cardMismatch,
          fingerOutsideCard: origin.fingerOutsideCard,
          originOutsideContainer: origin.originOutsideContainer,
          containerUnknown: origin.containerUnknown,
          originX: origin.x,
          originY: origin.y,
          fingerX: e.absoluteX,
          fingerY: e.absoluteY,
          gestureLocalX: e.x,
          gestureLocalY: e.y,
          containerX: origin.containerX,
          containerY: origin.containerY,
          mismatchX: origin.mismatchX,
          mismatchY: origin.mismatchY,
          containerDriftX: origin.containerDriftX,
          containerDriftY: origin.containerDriftY,
          containerAgeMs: measuredAt > 0 ? now - measuredAt : -1,
        });
      })
      .onUpdate((e) => {
        "worklet";
        // Arithmetic only — this runs every frame on the UI thread — except
        // for the one ghost check per drag (#3528), which measures before this
        // frame's write so the ghost on screen matches lastFinger. Once the
        // check has run this is a single compare.
        const gc = ghostCheck.value;
        const st = gc.state;
        // Once the mid-drag budget is spent (nextCheckAt = Infinity) this is
        // back to one compare: no Date.now(), no writes (#3532).
        if ((st === GHOST_PENDING || st === GHOST_LAG) && gc.nextCheckAt !== Infinity) {
          if (Date.now() >= gc.nextCheckAt) {
            checkGhost(gc, e.absoluteX, e.absoluteY, e.velocityX, e.velocityY, "update");
          }
          if (gc.state === GHOST_PENDING || gc.state === GHOST_LAG) {
            trackFinger(gc, e.absoluteX, e.absoluteY);
          }
        }
        // The ghost's window position: finger − grab (#3531).
        cardX.value = e.absoluteX - grabX.value;
        cardY.value = e.absoluteY - grabY.value;
      })
      // Every way an activated pan can end resolves the drag exactly once
      // (#2772): a lift (onEnd success) hit-tests the drop; a cancel by the
      // system (onEnd !success — iOS edge swipe, Control Center, an incoming
      // call) snaps back instead of dropping where the touch happened to be;
      // and onFinalize covers any end that skipped onEnd.
      .onEnd((e, success) => {
        "worklet";
        if (!panActivated.value) return;
        panActivated.value = false;
        // A drag shorter than GHOST_CHECK_DELAY_MS is checked here (#3528).
        const gc = ghostCheck.value;
        if (gc.state === GHOST_PENDING || gc.state === GHOST_LAG) {
          // Tracking stopped with the mid-drag budget: the end's finger stands
          // in for the frames since.
          if (gc.nextCheckAt === Infinity) trackFinger(gc, e.absoluteX, e.absoluteY);
          checkGhost(gc, e.absoluteX, e.absoluteY, e.velocityX, e.velocityY, "end");
        }
        if (success) {
          // Where the ghost is let go, from where it was picked up: finger − grab − origin.
          const dx = e.absoluteX - grabX.value - originX.value;
          const dy = e.absoluteY - grabY.value - originY.value;
          runOnJS(finishDrop)(e.absoluteX, e.absoluteY, ghostSummary(), dx, dy);
        } else runOnJS(finishSnapBack)(ghostSummary());
      })
      .onFinalize(() => {
        "worklet";
        if (!panActivated.value) return;
        panActivated.value = false;
        runOnJS(finishSnapBack)(ghostSummary());
      });

    const tap = Gesture.Tap().maxDistance(8);
    if (slop) tap.hitSlop(slop);
    tap.onEnd((_e, success) => {
      "worklet";
      if (success && hasTap) runOnJS(handleTap)();
    });

    // Gesture.Exclusive keeps both gestures inside RNGH: pan wins on movement ≥ 5 px,
    // tap fires natively when pan fails — no cross-system handoff needed on iOS.
    return draggable ? Gesture.Exclusive(pan, tap) : tap;
  }, [
    draggable,
    slop,
    hasTap,
    handleTap,
    cardWidth,
    cardHeight,
    ghostCheckEnabled,
    viewRef,
    panActivated,
    cardX,
    cardY,
    originX,
    originY,
    containerOffsetX,
    containerOffsetY,
    containerWidth,
    containerHeight,
    containerMeasuredAt,
    containerRef,
    ghostRef,
    ghostMounted,
    ghostCheck,
    grabX,
    grabY,
    triggerStartDrag,
    finishDrop,
    finishSnapBack,
    reportGhostOffset,
  ]);

  // This card's one bit of drag state (#2264): it re-renders on a drag start
  // or end only when it is part of the dragged stack.
  const beingDragged = useDragSelector(
    (s) => s.dragState !== null && isCardInDragStack(s.dragState.source, dragSource)
  );

  // A plain style, not useAnimatedStyle: `beingDragged` is React state, not a
  // shared value, so an animated style only sees it through a worklet closure
  // that the UI thread can leave stale. A stale 0 leaves the card invisible
  // after it is dropped (#2929). React re-renders drive this reliably.
  const dimmedStyle = beingDragged ? HIDDEN_STYLE : VISIBLE_STYLE;

  // On web, hitSlop is not a native prop — expand the hit area with padding
  // and compensate with negative margin so layout doesn't shift.
  const webHitSlopStyle = useMemo(
    () =>
      Platform.OS === "web" && slop
        ? {
            paddingTop: slop.top ?? 0,
            paddingBottom: slop.bottom ?? 0,
            paddingLeft: slop.left ?? 0,
            paddingRight: slop.right ?? 0,
            marginTop: -(slop.top ?? 0),
            marginBottom: -(slop.bottom ?? 0),
            marginLeft: -(slop.left ?? 0),
            marginRight: -(slop.right ?? 0),
          }
        : undefined,
    [slop]
  );

  const child = React.Children.only(children) as React.ReactElement<AnyProps>;
  // Device: injecting onPress onto Pressable-backed children creates a competing UIGestureRecognizer
  // that cancels RNGH's pan on iOS. Test-only: Jest mocks RNGH so onTap is only reachable via
  // onPress; process.env.NODE_ENV === "test" is Metro dead-code-eliminated in device builds.
  const innerEl =
    onTap && process.env.NODE_ENV === "test"
      ? React.cloneElement(child, { onPress: onTap })
      : child;

  // Accessibility: the child is a plain View (no onPress in production — see above),
  // so it's invisible to VoiceOver/TalkBack on its own. `onAccessibilityTap` (iOS) and
  // `accessibilityActions`/`onAccessibilityAction` (both platforms) let a screen-reader
  // "activate" gesture call `onTap` directly, independent of RNGH's gesture recognizers
  // entirely — no possibility of the same competing-recognizer conflict noted above.
  // Requires accessibilityLabel too: marking a View `accessible` collapses its subtree
  // into one announced element, and without an explicit label there's nothing reliable
  // for that element to announce (the label lives on an inner, now-hidden descendant).
  // Excluded in test mode: the child-clone above already gives that same "button" role
  // to the inner element for RTL's getByRole/fireEvent.press — adding it here too would
  // make every accessibility-labeled card resolve to two ambiguous "button" matches.
  const isAccessible =
    onTap !== undefined && accessibilityLabel !== undefined && process.env.NODE_ENV !== "test";
  const handleAccessibilityAction = useCallback(
    (event: AccessibilityActionEvent) => {
      if (event.nativeEvent.actionName === "activate") onTap?.();
    },
    [onTap]
  );

  return (
    <Animated.View
      ref={viewRef}
      testID={testID}
      style={[style, webHitSlopStyle, dimmedStyle]}
      accessible={isAccessible}
      accessibilityRole={isAccessible ? "button" : undefined}
      accessibilityLabel={isAccessible ? accessibilityLabel : undefined}
      accessibilityHint={isAccessible ? accessibilityHint : undefined}
      onAccessibilityTap={isAccessible ? onTap : undefined}
      accessibilityActions={isAccessible ? ACTIVATE_ACCESSIBILITY_ACTION : undefined}
      onAccessibilityAction={isAccessible ? handleAccessibilityAction : undefined}
    >
      <GestureDetector gesture={gesture}>{innerEl}</GestureDetector>
    </Animated.View>
  );
}
