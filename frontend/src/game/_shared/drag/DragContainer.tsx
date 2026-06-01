import React, { useCallback } from "react";
import type { LayoutChangeEvent, ViewStyle } from "react-native";
import Animated from "react-native-reanimated";
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
      // requestAnimationFrame defers measureInWindow until after the native view
      // is painted — calling it synchronously inside onLayout returns 0,0 on Android.
      requestAnimationFrame(() => {
        (
          containerRef.current as unknown as {
            measureInWindow?: (cb: (x: number, y: number) => void) => void;
          }
        )?.measureInWindow?.((x, y) => {
          containerOffsetX.value = x;
          containerOffsetY.value = y;
        });
      });
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
