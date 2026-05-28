import React, { useCallback, useMemo } from "react";
import { Platform } from "react-native";
import type { Insets } from "react-native";
import Animated, {
  useAnimatedRef,
  measure as rnMeasure,
  useAnimatedStyle,
} from "react-native-reanimated";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { useSharedValue, runOnJS } from "react-native-reanimated";
import { useDragContext, isCardInDragStack } from "./DragContext";
import type { DragCard, DragSource } from "./DragContext";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyProps = Record<string, any>;

export interface DraggableCardProps {
  children: React.ReactNode;
  style?: object;
  testID?: string;
  /** Tap fallback — same behavior as the old onPress. */
  onTap?: () => void;
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
    containerRef,
    startDrag,
    endDrag,
    snapBackAndClear,
  } = useDragContext();

  const triggerStartDrag = useCallback(() => {
    startDrag(dragSource, dragCards);
  }, [dragSource, dragCards, startDrag]);

  const panActivated = useSharedValue(false);

  const pan = Gesture.Pan()
    .minPointers(1)
    .activeOffsetX([-12, 12])
    .activeOffsetY([-12, 12])
    .enabled(draggable)
    .onStart((e) => {
      "worklet";
      panActivated.value = true;
      const cardMeasured = rnMeasure(viewRef);
      const containerMeasured = rnMeasure(containerRef);
      // Re-sync the container offset in case DragContainer.onLayout hasn't fired yet.
      if (containerMeasured) {
        containerOffsetX.value = containerMeasured.pageX;
        containerOffsetY.value = containerMeasured.pageY;
      }
      // rnMeasure can return null on iOS/Android before the first native layout pass.
      // RNGH guarantee: e.absoluteX - e.x = absolute window X of the gesture view's origin.
      const pageX = cardMeasured?.pageX ?? (e.absoluteX - e.x);
      const pageY = cardMeasured?.pageY ?? (e.absoluteY - e.y);
      const localX = pageX - containerOffsetX.value;
      const localY = pageY - containerOffsetY.value;
      originX.value = localX;
      originY.value = localY;
      cardX.value = localX;
      cardY.value = localY;
      runOnJS(triggerStartDrag)();
    })
    .onUpdate((e) => {
      "worklet";
      cardX.value = originX.value + e.translationX;
      cardY.value = originY.value + e.translationY;
    })
    .onEnd((e) => {
      "worklet";
      runOnJS(endDrag)(e.absoluteX, e.absoluteY);
    })
    .onFinalize((_e, success) => {
      "worklet";
      if (!success && panActivated.value) runOnJS(snapBackAndClear)();
      panActivated.value = false;
    });

  // For non-draggable (face-down) cards, RNGH tap works correctly and is unchanged.
  // For draggable cards, pan-only in GestureDetector: when pan fails (< 12 px movement),
  // the touch is released and the native onPress cloned onto the child below handles tap.
  // This avoids the Simultaneous/requireExternalGestureToFail iOS UIGestureRecognizer
  // deadlock that kept both tap and drag broken (#1101, #1102).
  const tap = Gesture.Tap()
    .maxDistance(8)
    .onEnd((_e, success) => {
      "worklet";
      if (success && onTap) runOnJS(onTap)();
    });

  const gesture = draggable ? pan : tap;

  const beingDragged = dragState !== null && isCardInDragStack(dragState.source, dragSource);

  const dimmedStyle = useAnimatedStyle(() => ({
    opacity: beingDragged ? 0.6 : 1,
  }));

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
  const innerEl = onTap ? React.cloneElement(child, { onPress: onTap }) : child;

  return (
    <Animated.View
      ref={viewRef}
      testID={testID}
      style={[style, webHitSlopStyle, dimmedStyle]}
      hitSlop={Platform.OS !== "web" ? hitSlop : undefined}
    >
      <GestureDetector gesture={gesture}>{innerEl}</GestureDetector>
    </Animated.View>
  );
}
