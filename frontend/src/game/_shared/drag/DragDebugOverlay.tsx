import React, { useEffect, useSyncExternalStore } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import Animated, {
  useAnimatedProps,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "../../../theme/ThemeContext";
import {
  DRAG_DEBUG_RESULT_TEST_ID,
  clearDragDebugResult,
  formatDragDebugResult,
  getDragDebugResult,
  isDragDebugEnabled,
  subscribeDragDebugResult,
} from "./dragDebug";
import { GHOST_LIFT } from "./dragGeometry";
import {
  GHOST_FAIL,
  GHOST_IDLE,
  GHOST_OK,
  GHOST_PENDING,
  GHOST_UNMEASURED,
  type GhostCheckState,
} from "./ghostCheckState";
import type { GhostHostDrag } from "./ghostHost";

/** The panel text is rewritten at most this often (~10 Hz). */
export const PANEL_INTERVAL_MS = 100;
const CROSSHAIR_ARM = 16;

const AnimatedTextInput = Animated.createAnimatedComponent(TextInput);

const rnd = (n: number): number => {
  "worklet";
  return Number.isFinite(n) ? Math.round(n) : 0;
};

const checkLabel = (state: number): string => {
  "worklet";
  if (state === GHOST_OK) return "ok";
  if (state === GHOST_FAIL) return "FAIL";
  if (state === GHOST_UNMEASURED) return "unmeasured";
  if (state === GHOST_PENDING) return "pending";
  if (state === GHOST_IDLE) return "idle";
  return "?";
};

/**
 * The panel's text for one frame. A worklet: it runs on the UI thread, from
 * the drag's shared values, so no React render is involved.
 */
export function formatPanelText(
  cardX: number,
  cardY: number,
  grabX: number,
  grabY: number,
  gc: GhostCheckState
): string {
  "worklet";
  const surface = gc.cardMeasured
    ? `${rnd(gc.fingerStartX - gc.grabX - gc.cardMeasuredX)},${rnd(
        gc.fingerStartY - gc.grabY - gc.cardMeasuredY
      )}`
    : "n/a";
  return [
    `finger ${rnd(cardX + grabX)},${rnd(cardY + grabY)}`,
    `expected ${rnd(cardX)},${rnd(cardY - GHOST_LIFT)}`,
    `grab ${rnd(grabX)},${rnd(grabY)}`,
    `check ${checkLabel(gc.state)} d(${rnd(gc.deltaX)},${rnd(gc.deltaY)}) dm(${rnd(
      gc.deltaMeasureX
    )},${rnd(gc.deltaMeasureY)})`,
    `surface ${surface}`,
    `card:${gc.cardSource} container:${gc.containerSource}`,
  ].join("\n");
}

/**
 * Drag debug overlay (#3529), drawn inside the root `DragGhostHost` so it
 * shares the ghost's coordinate space (RNGH's absolute origin). Internal
 * builds with the setting on only: `DragGhostHost` mounts it only then, and it
 * re-checks here, so a store build can never show it.
 *
 * While a drag is active: a crosshair at the finger, an outline at the
 * expected ghost frame, and a text panel. After a drag: the persistent
 * `drag-check:` result line (testID `drag-debug-result`).
 */
export function DragDebugOverlay({ drag }: { drag: GhostHostDrag | null }) {
  const result = useSyncExternalStore(subscribeDragDebugResult, getDragDebugResult);
  // A new drag forgets the previous drag's result.
  useEffect(() => {
    if (drag) clearDragDebugResult();
  }, [drag]);
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  if (!isDragDebugEnabled()) return null;
  const text = result ? formatDragDebugResult(result) : null;
  return (
    <>
      {drag?.debug && <LiveLayer drag={drag} />}
      {text && (
        <View
          style={[styles.result, { top: insets.top + 4, backgroundColor: colors.surface }]}
          pointerEvents="none"
        >
          <Text
            testID={DRAG_DEBUG_RESULT_TEST_ID}
            accessibilityLabel={text}
            style={[styles.mono, { color: colors.text }]}
          >
            {text}
          </Text>
        </View>
      )}
    </>
  );
}

function LiveLayer({ drag }: { drag: GhostHostDrag }) {
  const { cards, cardX, cardY, debug } = drag;
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const width = cards[0]?.width ?? 0;
  const height = cards.reduce((m, c) => Math.max(m, (c.stackTop ?? 0) + c.height), 0);
  const grabX = debug!.grabX;
  const grabY = debug!.grabY;
  const ghostCheck = debug!.ghostCheck;

  // finger = cardX + grab: derived from the values the ghost already uses, so
  // the gesture worklets publish nothing extra for the overlay.
  const crosshairStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: cardX.value + grabX.value },
      { translateY: cardY.value + grabY.value },
    ],
  }));
  const expectedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: cardX.value }, { translateY: cardY.value - GHOST_LIFT }],
  }));

  // The panel text: written from a reaction on the UI thread, at most every
  // PANEL_INTERVAL_MS. `lastAt` is read only inside the reaction callback, so
  // it is not a mapper input and writing it cannot re-trigger the reaction.
  const panel = useSharedValue("");
  const lastAt = useSharedValue(0);
  useAnimatedReaction(
    () => [cardX.value, cardY.value],
    (cur) => {
      const now = Date.now();
      if (now - lastAt.value < PANEL_INTERVAL_MS) return;
      lastAt.value = now;
      panel.value = formatPanelText(
        cur[0] ?? 0,
        cur[1] ?? 0,
        grabX.value,
        grabY.value,
        ghostCheck.value
      );
    }
  );
  const panelProps = useAnimatedProps(() => ({
    text: panel.value,
    defaultValue: panel.value,
  }));

  return (
    <>
      <Animated.View
        testID="drag-debug-expected"
        pointerEvents="none"
        style={[styles.expected, { width, height, borderColor: colors.accent }, expectedStyle]}
      />
      <Animated.View
        testID="drag-debug-crosshair"
        pointerEvents="none"
        style={[styles.crosshair, crosshairStyle]}
      >
        <View style={[styles.armH, { backgroundColor: colors.error }]} />
        <View style={[styles.armV, { backgroundColor: colors.error }]} />
      </Animated.View>
      <View
        style={[styles.panel, { bottom: insets.bottom + 4, backgroundColor: colors.surface }]}
        pointerEvents="none"
      >
        <AnimatedTextInput
          testID="drag-debug-panel"
          editable={false}
          multiline
          pointerEvents="none"
          underlineColorAndroid="transparent"
          style={[styles.mono, { color: colors.text }]}
          animatedProps={panelProps}
        />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  result: {
    position: "absolute",
    left: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    opacity: 0.9,
  },
  panel: {
    position: "absolute",
    left: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    opacity: 0.9,
  },
  mono: { fontFamily: "monospace", fontSize: 11, padding: 0 },
  expected: { position: "absolute", top: 0, left: 0, borderWidth: 1 },
  crosshair: { position: "absolute", top: 0, left: 0, width: 0, height: 0 },
  armH: {
    position: "absolute",
    left: -CROSSHAIR_ARM,
    top: 0,
    width: CROSSHAIR_ARM * 2,
    height: 1,
  },
  armV: {
    position: "absolute",
    left: 0,
    top: -CROSSHAIR_ARM,
    width: 1,
    height: CROSSHAIR_ARM * 2,
  },
});
