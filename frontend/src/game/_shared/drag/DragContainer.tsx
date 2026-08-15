import React, { useCallback } from "react";
import type { LayoutChangeEvent, ViewStyle } from "react-native";
import Animated, { measure, runOnUI } from "react-native-reanimated";
import { useDragContext } from "./DragContext";
import { DragOverlay } from "./DragOverlay";

export interface DragContainerProps {
  children: React.ReactNode;
  style?: ViewStyle | ViewStyle[];
  onLayout?: (e: LayoutChangeEvent) => void;
}

export function DragContainer({ children, style, onLayout: externalOnLayout }: DragContainerProps) {
  const { containerRef, containerOffsetX, containerOffsetY } = useDragContext();

  const onLayout = useCallback(
    (e: LayoutChangeEvent) => {
      // runOnUI schedules a UI-thread worklet that uses Reanimated's measure(),
      // the only path that correctly reads an AnimatedRef on both Paper and Fabric
      // (new arch). The previous approach called measureInWindow on containerRef.current
      // directly, which silently no-ops on Fabric where .current is a shadow node.
      runOnUI(() => {
        "worklet";
        const m = measure(containerRef);
        if (m) {
          containerOffsetX.value = m.pageX;
          containerOffsetY.value = m.pageY;
        }
      })();
      externalOnLayout?.(e);
    },
    [containerRef, containerOffsetX, containerOffsetY, externalOnLayout]
  );

  return (
    // collapsable={false} is required: without an explicit style prop (e.g. FreeCell's
    // <DragContainer> — see #2154), a plain View with no distinguishing layout props is
    // eligible for native view-flattening/collapsing. A flattened view is not present in
    // the native tree, so Reanimated's measure(containerRef) returns null both here and in
    // DraggableCard's pan.onStart re-sync — containerOffsetX/Y silently stay at their initial
    // 0,0 and every ghost-card position (and therefore every drop) is computed against the
    // wrong origin. Solitaire's DragContainer happened to dodge this because it's always
    // passed a non-empty style (flex: 1), which incidentally also opts it out of flattening.
    <Animated.View ref={containerRef} style={style} onLayout={onLayout} collapsable={false}>
      {children}
      <DragOverlay />
    </Animated.View>
  );
}
