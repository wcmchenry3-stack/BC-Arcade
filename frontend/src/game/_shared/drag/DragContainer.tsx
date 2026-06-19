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
    <Animated.View ref={containerRef} style={style} onLayout={onLayout}>
      {children}
      <DragOverlay />
    </Animated.View>
  );
}
