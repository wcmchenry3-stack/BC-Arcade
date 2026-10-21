import React, { useCallback, useEffect, useMemo, useRef } from "react";
import { Platform } from "react-native";
import type { AccessibilityActionEvent, Insets } from "react-native";
import Animated, { useAnimatedRef, measure as rnMeasure } from "react-native-reanimated";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { useSharedValue, runOnJS } from "react-native-reanimated";
import { useDragContext, isCardInDragStack } from "./DragContext";
import type { DragCard, DragSource, DragState } from "./DragContext";
import { computeDragOrigin } from "./dragGeometry";
import type { DragStartDiagnostics } from "./dragDiagnostics";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyProps = Record<string, any>;

// Stable reference — re-creating this array every render would otherwise
// force a fresh accessibilityActions prop identity on every re-render.
const ACTIVATE_ACCESSIBILITY_ACTION = [{ name: "activate" }] as const;

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
  dragCards,
  dragSource,
  draggable = true,
  hitSlop,
}: DraggableCardProps) {
  // useAnimatedRef lets worklets call rnMeasure(viewRef) for reliable iOS position reads.
  const viewRef = useAnimatedRef<Animated.View>();

  const {
    dragState,
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
    startDrag,
    endDrag,
    snapBackAndClear,
    cancelDrag,
  } = useDragContext();

  // The drag this card started, kept on the JS thread. The cancel effects
  // below compare it with the context's current drag instead of reading the
  // `panActivated` shared value from JS (a JS read of a shared value can be a
  // stale cached copy, #2772) — and so only ever cancel this card's own drag.
  const ownDragRef = useRef<DragState | null>(null);
  const triggerStartDrag = useCallback(
    (origin: DragStartDiagnostics) => {
      ownDragRef.current = startDrag(dragSource, dragCards, origin);
    },
    [dragSource, dragCards, startDrag]
  );

  const panActivated = useSharedValue(false);
  // Ghost position minus the pan's translation, fixed at onStart (#3397):
  // onUpdate is then `anchor + translation`, so the ghost starts exactly on the
  // card (no jump by the ~5 px activation distance), keeps the grab offset for
  // the whole gesture, and never re-reads the container offset mid-drag.
  const anchorX = useSharedValue(0);
  const anchorY = useSharedValue(0);
  // Plain numbers for the worklet closure.
  const cardWidth = dragCards[0]?.width ?? 0;
  const cardHeight = dragCards[0]?.height ?? 0;

  // minDistance(5) replaces activeOffsetX/Y([-12,12]) — 12 px was too coarse for
  // FreeCell's narrower cards, causing drags to feel unresponsive.
  // hitSlop is applied to the gesture directly (not the wrapper View) — RNGH does
  // not inherit hitSlop from parent views, so it must be on the gesture itself.
  const pan = Gesture.Pan().minPointers(1).minDistance(5).enabled(draggable);
  if (hitSlop) pan.hitSlop(hitSlop);
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
      // rnMeasure can return null on iOS/Android before the first native layout pass
      // (a draw-3 waste card remounts on every draw), and the cached container offset
      // can be stale or still 0,0. computeDragOrigin cross-checks both against the
      // gesture's own origin so the ghost never starts far from the finger (#3397).
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
      // Writing these cancels any snap-back spring still running from the previous
      // drag; that drag's clear is generation-guarded in DragContext.
      originX.value = origin.x;
      originY.value = origin.y;
      cardX.value = origin.x;
      cardY.value = origin.y;
      anchorX.value = origin.x - e.translationX;
      anchorY.value = origin.y - e.translationY;
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
      // Arithmetic only — this runs every frame on the UI thread.
      cardX.value = anchorX.value + e.translationX;
      cardY.value = anchorY.value + e.translationY;
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
      if (success) runOnJS(endDrag)(e.absoluteX, e.absoluteY);
      else runOnJS(snapBackAndClear)();
    })
    .onFinalize(() => {
      "worklet";
      if (!panActivated.value) return;
      panActivated.value = false;
      runOnJS(snapBackAndClear)();
    });

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

  const tap = Gesture.Tap().maxDistance(8);
  if (hitSlop) tap.hitSlop(hitSlop);
  tap.onEnd((_e, success) => {
    "worklet";
    if (success && onTap) runOnJS(onTap)();
  });

  // Gesture.Exclusive keeps both gestures inside RNGH: pan wins on movement ≥ 5 px,
  // tap fires natively when pan fails — no cross-system handoff needed on iOS.
  const gesture = draggable ? Gesture.Exclusive(pan, tap) : tap;

  const beingDragged = dragState !== null && isCardInDragStack(dragState.source, dragSource);

  // A plain style, not useAnimatedStyle: `beingDragged` is React state, not a
  // shared value, so an animated style only sees it through a worklet closure
  // that the UI thread can leave stale. A stale 0 leaves the card invisible
  // after it is dropped (#2929). React re-renders drive this reliably.
  const dimmedStyle = beingDragged ? HIDDEN_STYLE : VISIBLE_STYLE;

  // On web, hitSlop is not a native prop — expand the hit area with padding
  // and compensate with negative margin so layout doesn't shift.
  const webHitSlopStyle = useMemo(
    () =>
      Platform.OS === "web" && hitSlop
        ? {
            paddingTop: hitSlop.top ?? 0,
            paddingBottom: hitSlop.bottom ?? 0,
            paddingLeft: hitSlop.left ?? 0,
            paddingRight: hitSlop.right ?? 0,
            marginTop: -(hitSlop.top ?? 0),
            marginBottom: -(hitSlop.bottom ?? 0),
            marginLeft: -(hitSlop.left ?? 0),
            marginRight: -(hitSlop.right ?? 0),
          }
        : undefined,
    [hitSlop]
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
      onAccessibilityTap={isAccessible ? onTap : undefined}
      accessibilityActions={isAccessible ? ACTIVATE_ACCESSIBILITY_ACTION : undefined}
      onAccessibilityAction={isAccessible ? handleAccessibilityAction : undefined}
    >
      <GestureDetector gesture={gesture}>{innerEl}</GestureDetector>
    </Animated.View>
  );
}
