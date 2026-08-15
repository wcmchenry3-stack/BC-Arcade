import React, { useCallback, useEffect, useRef } from "react";
import { View } from "react-native";
import type { ViewStyle } from "react-native";
import { useTheme } from "../../../theme/ThemeContext";
import { useDragContext } from "./DragContext";
import type { DropHandler } from "./DragContext";

export interface DropTargetProps {
  /** Unique ID used to match against legalTargetIds. */
  id: string;
  onDrop: DropHandler;
  children: React.ReactNode;
  style?: ViewStyle | ViewStyle[];
  /** Style applied on top of `style` when drag is active AND this is legal. */
  highlightStyle?: ViewStyle;
  /** Style applied on top of `style` when drag is active AND this is not legal. */
  dimStyle?: ViewStyle;
  testID?: string;
}

export function DropTarget({
  id,
  onDrop,
  children,
  style,
  highlightStyle,
  dimStyle,
  testID,
}: DropTargetProps) {
  const viewRef = useRef<View>(null);
  const rafRef = useRef<ReturnType<typeof requestAnimationFrame>>();
  const { colors } = useTheme();

  // Keep the latest onDrop in a ref so re-renders don't force re-registration.
  const onDropRef = useRef(onDrop);
  useEffect(() => {
    onDropRef.current = onDrop;
  });

  const { dragState, legalTargetIds, registerDropZone, unregisterDropZone, updateDropZoneLayout } =
    useDragContext();

  useEffect(() => {
    registerDropZone(id, {
      onDrop: (source, cards) => onDropRef.current(source, cards),
      refreshBounds: () => {
        viewRef.current?.measureInWindow((x, y, w, h) => {
          if (w > 0 && h > 0) updateDropZoneLayout(id, { x, y, width: w, height: h });
        });
      },
    });
    return () => unregisterDropZone(id);
  }, [id, registerDropZone, unregisterDropZone, updateDropZoneLayout]);

  useEffect(() => {
    return () => {
      if (rafRef.current !== undefined) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  // Proactively cache absolute window bounds whenever React Native recalculates
  // layout. requestAnimationFrame defers the measureInWindow call until after
  // the native view is actually painted — calling it synchronously inside onLayout
  // returns 0,0 on Android before the first paint. Cancelling the previous rAF
  // prevents stale callbacks from piling up on rapid re-renders.
  const handleLayout = useCallback(() => {
    if (rafRef.current !== undefined) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = undefined;
      viewRef.current?.measureInWindow((x, y, w, h) => {
        if (w > 0 && h > 0) {
          updateDropZoneLayout(id, { x, y, width: w, height: h });
        }
      });
    });
  }, [id, updateDropZoneLayout]);

  const isDragActive = dragState !== null;
  const isLegal = legalTargetIds.has(id);

  // "33" hex suffix = 0x33/0xFF ≈ 20% opacity tint over the accent color.
  return (
    // collapsable={false} is required: without a caller-supplied baseline `style` (e.g.
    // empty FreeCell/Solitaire piles, which only apply highlightStyle/dimStyle during an
    // active drag — see #2154), this View has no distinguishing layout props and is eligible
    // for native view-flattening/collapsing. A flattened view is not present in the native
    // tree, so viewRef.current?.measureInWindow() in refreshBounds/handleLayout never fires
    // with real dimensions, updateDropZoneLayout is never called for this zone's id, and
    // DragContext's endDrag always treats the drop target as missing bounds and rejects the
    // drop.
    <View
      ref={viewRef}
      testID={testID}
      onLayout={handleLayout}
      collapsable={false}
      style={[
        style,
        isDragActive && isLegal && { backgroundColor: colors.accent + "33" },
        isDragActive && isLegal && highlightStyle,
        isDragActive && !isLegal && dimStyle,
      ]}
    >
      {children}
    </View>
  );
}
