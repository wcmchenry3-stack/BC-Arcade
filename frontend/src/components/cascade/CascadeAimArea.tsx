/**
 * #3928: the board's touch area. Press, drag and release aim and drop the next piece
 * (`useAimGesture`); a quick tap drops at once, as tap-to-drop always did. `cascade-game-area`
 * stays its testID, so Maestro's `tapOn` and the e2e helpers reach it as before.
 */
import React, { type ReactNode } from "react";
import { View, type ViewStyle } from "react-native";
import { GestureDetector } from "react-native-gesture-handler";
import type { BoardMotion } from "./useBoardMotion";
import { useAimGesture } from "./useAimGesture";

export interface CascadeAimAreaProps {
  readonly style: ViewStyle & { width: number; height: number };
  readonly motion: BoardMotion;
  readonly scale: number;
  readonly enabled: boolean;
  readonly onDrop: (worldX: number) => void;
  readonly onDragStart: () => void;
  readonly children: ReactNode;
}

export default function CascadeAimArea({
  style,
  motion,
  scale,
  enabled,
  onDrop,
  onDragStart,
  children,
}: CascadeAimAreaProps) {
  const gesture = useAimGesture({
    values: motion.values,
    wake: motion.wake,
    scale,
    width: style.width,
    height: style.height,
    enabled,
    onDrop,
    onDragStart,
  });
  return (
    <GestureDetector gesture={gesture}>
      <View testID="cascade-game-area" style={style} collapsable={false}>
        {children}
      </View>
    </GestureDetector>
  );
}
