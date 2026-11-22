import React, { useCallback } from "react";
import type { LayoutChangeEvent, ViewStyle } from "react-native";
import Animated, { measure, runOnUI } from "react-native-reanimated";
import { useDragApi } from "./DragContext";
import { isValidContainerMeasure } from "./dragGeometry";

export interface DragContainerProps {
  children: React.ReactNode;
  style?: ViewStyle | ViewStyle[];
  onLayout?: (e: LayoutChangeEvent) => void;
}

export function DragContainer({ children, style, onLayout: externalOnLayout }: DragContainerProps) {
  const {
    containerRef,
    containerOffsetX,
    containerOffsetY,
    containerWidth,
    containerHeight,
    containerMeasuredAt,
  } = useDragApi();

  const onLayout = useCallback(
    (e: LayoutChangeEvent) => {
      // runOnUI schedules a UI-thread worklet that uses Reanimated's measure(),
      // the only path that correctly reads an AnimatedRef on both Paper and Fabric
      // (new arch). The previous approach called measureInWindow on containerRef.current
      // directly, which silently no-ops on Fabric where .current is a shadow node.
      //
      // This cached offset feeds the drag-start diagnostics only (#3397): the
      // ghost is positioned from the finger in the root DragGhostHost and
      // never reads it (#3531), so a measure that lands mid-drag (e.g. after
      // a navigation transition) cannot move an active ghost.
      runOnUI(() => {
        "worklet";
        const m = measure(containerRef);
        // A 0×0 layout (screen hidden mid-transition) must not overwrite a good cache.
        if (isValidContainerMeasure(m)) {
          containerOffsetX.value = m.pageX;
          containerOffsetY.value = m.pageY;
          containerWidth.value = m.width;
          containerHeight.value = m.height;
          containerMeasuredAt.value = Date.now();
        }
      })();
      externalOnLayout?.(e);
    },
    [
      containerRef,
      containerOffsetX,
      containerOffsetY,
      containerWidth,
      containerHeight,
      containerMeasuredAt,
      externalOnLayout,
    ]
  );

  return (
    // collapsable={false} is required: without an explicit style prop (e.g. FreeCell's
    // <DragContainer> — see #2154), a plain View with no distinguishing layout props is
    // eligible for native view-flattening/collapsing. A flattened view is not present in
    // the native tree, so Reanimated's measure(containerRef) returns null both here and in
    // DraggableCard's pan.onStart re-sync — containerOffsetX/Y silently stay at their initial
    // 0,0 and the drag-start diagnostics compare against the wrong origin. Solitaire's
    // DragContainer happened to dodge this because it's always passed a non-empty style
    // (flex: 1), which incidentally also opts it out of flattening.
    //
    // The drag ghost is not drawn here: it lives in the root DragGhostHost (#3531), so a
    // board's layout, scroll offset or clipping can't move or hide it.
    <Animated.View ref={containerRef} style={style} onLayout={onLayout} collapsable={false}>
      {children}
    </Animated.View>
  );
}
