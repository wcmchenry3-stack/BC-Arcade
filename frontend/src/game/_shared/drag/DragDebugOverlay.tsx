import React, { useSyncExternalStore } from "react";
import { Platform, StyleSheet, Text, TextInput, View } from "react-native";
import Animated, {
  useAnimatedProps,
  useFrameCallback,
  useAnimatedStyle,
  useSharedValue,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "../../../theme/ThemeContext";
import {
  DRAG_DEBUG_RESULT_TEST_ID,
  DRAG_DEBUG_DROP_TEST_ID,
  DRAG_DEBUG_SEQ_TEST_ID,
  formatDragDebugResult,
  formatDragDebugSeq,
  getDragDebugDrop,
  getDragDebugResult,
  getDragDebugResultSeq,
  getDragDebugVersion,
  isDragDebugEnabled,
  subscribeDragDebugResult,
} from "./dragDebug";
import {
  DRAG_DEBUG_TOUCH_TEST_ID,
  formatDragDebugTouch,
  getDragDebugTouch,
} from "./dragDebugTouch";
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

/** Where the check measured the ghost (window space, lift included), from
 *  the stored check state alone; null when it never got a non-null measure. */
function ghostAtCheck(gc: GhostCheckState): { x: number; y: number } | null {
  "worklet";
  if (!gc.ghostMeasured) return null;
  return { x: gc.ghostPageX, y: gc.ghostPageY };
}

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
  const cardMeasured = gc.cardMeasured
    ? `${rnd(gc.cardMeasuredX)},${rnd(gc.cardMeasuredY)}`
    : "n/a";
  // The once-per-drag check's measured ghost frame.
  // Never a new measure; "n/a" until the check has measured the ghost.
  const m = ghostAtCheck(gc);
  return [
    `finger ${rnd(cardX + grabX)},${rnd(cardY + grabY)}`,
    `expected ${rnd(cardX)},${rnd(cardY - GHOST_LIFT)}`,
    `grab ${rnd(grabX)},${rnd(grabY)}`,
    `check ${checkLabel(gc.state)} d(${rnd(gc.deltaX)},${rnd(gc.deltaY)}) dm(${rnd(
      gc.deltaMeasureX
    )},${rnd(gc.deltaMeasureY)})`,
    `ghost measured ${m ? `${rnd(m.x)},${rnd(m.y)}` : "n/a"}`,
    `surface ${surface}`,
    `container used ${rnd(gc.containerUsedX)},${rnd(gc.containerUsedY)}`,
    `card measured ${cardMeasured}`,
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
 * `drag-check:` result line (testID `drag-debug-result`) and under it the
 * drag's sequence number (`drag #N`, testID `drag-debug-seq`) and how it
 * ended (`drop: accepted|snapBack|cancelled ...`, testID `drag-debug-drop`).
 * Under them, from the first touch on a card: the touch line (testID
 * `drag-debug-touch`, #3878), drawn from the UI thread.
 *
 * Maestro reads both lines (#3532): each is a real, opaque `Text` with a
 * testID, which React Native never flattens and exposes on Android as the
 * node's resource-id (ReactTextViewAccessibilityDelegate) and on iOS as its
 * accessibilityIdentifier. Keep them that way: a label on a plain View, or a
 * transparent or 1 px Text, is invisible to Maestro.
 */
export function DragDebugOverlay({ drag }: { drag: GhostHostDrag | null }) {
  // The version changes with the result, its number and the drop outcome.
  useSyncExternalStore(subscribeDragDebugResult, getDragDebugVersion);
  const result = getDragDebugResult();
  const drop = getDragDebugDrop();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  if (!isDragDebugEnabled()) return null;
  const text = result ? formatDragDebugResult(result) : null;
  return (
    <>
      {/* One top-left column: the result block, then the touch line under it,
          so the two never overlap however wide the result lines get. */}
      <View style={[styles.stack, { top: insets.top + 4 }]} pointerEvents="none">
        {(text || drop) && (
          <View style={[styles.result, { backgroundColor: colors.surface }]} pointerEvents="none">
            {text && (
              <>
                <Text
                  testID={DRAG_DEBUG_RESULT_TEST_ID}
                  accessibilityLabel={text}
                  style={[styles.mono, { color: colors.text }]}
                >
                  {text}
                </Text>
                <Text
                  testID={DRAG_DEBUG_SEQ_TEST_ID}
                  style={[styles.mono, { color: colors.textMuted }]}
                >
                  {formatDragDebugSeq(getDragDebugResultSeq())}
                </Text>
              </>
            )}
            {drop && (
              <Text
                testID={DRAG_DEBUG_DROP_TEST_ID}
                style={[styles.mono, { color: colors.textMuted }]}
              >
                {drop}
              </Text>
            )}
          </View>
        )}
        {Platform.OS !== "web" && <TouchLine />}
      </View>
      {drag?.debug && <LiveLayer key={dragKey(drag)} drag={drag} />}
    </>
  );
}

// One key per drag object, so a follow-on drag gets fresh shared values.
const dragKeys = new WeakMap<object, number>();
let nextDragKey = 0;
function dragKey(drag: GhostHostDrag): number {
  let k = dragKeys.get(drag);
  if (k === undefined) {
    k = nextDragKey++;
    dragKeys.set(drag, k);
  }
  return k;
}

/**
 * The touch line (#3878): what the pan and the JS thread saw, written on the
 * UI thread whenever a count changes (see dragDebugTouch.ts), so it updates
 * while the JS thread is blocked. Hidden until the first touch on a card. A
 * TextInput, not a Text, because only its text can be set from the UI thread;
 * Maestro reads its value as the element's text. Native only: web has no
 * Maestro, and axe flags the unlabelled input there.
 */
function TouchLine() {
  const { colors } = useTheme();
  const { ui, js } = getDragDebugTouch();
  const textProps = useAnimatedProps(() => {
    const text = formatDragDebugTouch(ui.value, js.value);
    return { text, defaultValue: text };
  });
  const shown = useAnimatedStyle(() => ({ opacity: ui.value.down > 0 ? 0.9 : 0 }));
  return (
    <Animated.View
      style={[styles.touch, { backgroundColor: colors.surface }, shown]}
      pointerEvents="none"
    >
      <AnimatedTextInput
        testID={DRAG_DEBUG_TOUCH_TEST_ID}
        editable={false}
        pointerEvents="none"
        underlineColorAndroid="transparent"
        style={[styles.mono, { color: colors.textMuted }]}
        animatedProps={textProps}
      />
    </Animated.View>
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

  // The panel text and the check-time ghost outline: written from a UI-thread
  // frame callback, at most every PANEL_INTERVAL_MS, so the last throttled
  // values and a check-state change with a still finger land within one
  // window. It only compares and, on a change, writes; it exists only while
  // a drag is shown. No React render, no measure.
  const panel = useSharedValue("");
  const measuredRect = useSharedValue({ on: 0, x: 0, y: 0 });
  const lastAt = useSharedValue(0);
  useFrameCallback(() => {
    "worklet";
    const now = Date.now();
    if (now - lastAt.value < PANEL_INTERVAL_MS) return;
    lastAt.value = now;
    const gc = ghostCheck.value;
    const text = formatPanelText(cardX.value, cardY.value, grabX.value, grabY.value, gc);
    if (text !== panel.value) panel.value = text;
    const m = ghostAtCheck(gc);
    const cur = measuredRect.value;
    if (m ? cur.on !== 1 || cur.x !== m.x || cur.y !== m.y : cur.on !== 0) {
      measuredRect.value = m ? { on: 1, x: m.x, y: m.y } : { on: 0, x: 0, y: 0 };
    }
  });
  const measuredStyle = useAnimatedStyle(() => ({
    opacity: measuredRect.value.on,
    transform: [{ translateX: measuredRect.value.x }, { translateY: measuredRect.value.y }],
  }));
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
        testID="drag-debug-measured"
        pointerEvents="none"
        style={[styles.expected, { width, height, borderColor: colors.error }, measuredStyle]}
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
  stack: { position: "absolute", left: 4, right: 4, alignItems: "flex-start" },
  result: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    opacity: 0.9,
  },
  touch: {
    marginTop: 2,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  panel: {
    position: "absolute",
    left: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    opacity: 0.9,
  },
  mono: {
    fontFamily: Platform.select({ ios: "Menlo", default: "monospace" }),
    fontSize: 11,
    padding: 0,
  },
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
