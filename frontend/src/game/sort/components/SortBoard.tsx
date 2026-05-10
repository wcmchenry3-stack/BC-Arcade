import React, { useEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, StyleSheet, useWindowDimensions, View } from "react-native";
import Animated, {
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import Svg, { Path } from "react-native-svg";
import { useTranslation } from "react-i18next";
import type { Bottle, SortState } from "../types";
import { BOTTLE_DEPTH } from "../types";
import BottleView, {
  DEFAULT_BOTTLE_HEIGHT,
  DEFAULT_BOTTLE_WIDTH,
  LIQUID_COLORS,
} from "./BottleView";

const BOTTLE_GAP = 12;
const ASPECT_RATIO = DEFAULT_BOTTLE_WIDTH / DEFAULT_BOTTLE_HEIGHT; // ≈ 0.333

export interface SortBoardProps {
  readonly state: SortState;
  readonly colorblindMode?: boolean;
  readonly onBottleTap: (index: number) => void;
  readonly pouringFrom?: number | null;
  readonly pouringTo?: number | null;
  /** Height of the board container in pixels — used to scale bottles to fit. */
  readonly availableHeight?: number;
  /** Total flow duration in ms (POUR_PER_UNIT_MS × unitCount); computed by SortScreen. */
  readonly pourHoldMs?: number;
}

interface GhostInfo {
  bottle: Bottle;
  bottleIndex: number;
  startX: number;
  startY: number;
  dstX: number;
  dstY: number;
  liftDx: number;
  liftDy: number;
  tiltSign: 1 | -1;
  dstBottleLength: number;
}

// Pour animation timing (ms) — exported so SortScreen can compute total timeout
export const POUR_LIFT_MS = 240;       // diagonal lift+travel phase
export const POUR_TILT_MS = 220;       // tilt from 0° to TILT_START_DEG
export const POUR_PER_UNIT_MS = 380;   // per-unit progressive tilt + stream
export const POUR_RETURN_MS = 320;     // simultaneous untilt + return

// Tilt progresses from start angle to peak as the bottle empties
const TILT_START_DEG = 50;
const TILT_PEAK_DEG = 95;

// BottleView SVG proportions — used to compute pivot/spout position
const VB_W = 56;
const VB_H = 168;
const NECK_TOP_VB = 14;    // PAD_TOP in BottleView
const NECK_LEFT_VB = 12;   // left outer neck edge in viewBox
const NECK_RIGHT_VB = 44;  // right outer neck edge in viewBox
const BODY_BOTTOM_VB = 166;
const INNER_H_VB = BODY_BOTTOM_VB - NECK_TOP_VB; // 152

const STREAM_WIDTH = 7;

export default function SortBoard({
  state,
  colorblindMode = false,
  onBottleTap,
  pouringFrom = null,
  pouringTo = null,
  availableHeight,
  pourHoldMs = POUR_PER_UNIT_MS,
}: SortBoardProps) {
  const { t } = useTranslation("sort");
  const { width: screenW } = useWindowDimensions();

  const numBottles = state.bottles.length;
  // Single row for ≤4 bottles; 3 cols for 5–6; 4 cols for 7+
  const numCols = numBottles <= 4 ? numBottles : numBottles <= 6 ? 3 : 4;
  const numRows = Math.ceil(numBottles / numCols);

  // Scale bottles to fill available height without overflow
  const avH = availableHeight && availableHeight > 0 ? availableHeight : 480;
  const maxBottleH = Math.max(60, (avH - BOTTLE_GAP * (numRows - 1)) / numRows);
  const bottleHFromHeight = Math.min(DEFAULT_BOTTLE_HEIGHT, maxBottleH);

  // Also clamp to horizontal space so bottles never overflow screen width
  const horizPad = 32;
  const maxBottleW = (screenW - horizPad - BOTTLE_GAP * (numCols - 1)) / numCols;
  const bottleW = Math.min(bottleHFromHeight * ASPECT_RATIO, maxBottleW);
  const bottleH = bottleW / ASPECT_RATIO;

  // Reduce-motion: fall back to tilt-only (no ghost overlay)
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
  }, []);

  // Position tracking — updated by onLayout, never triggers re-render.
  // React Native fires onLayout top-down (parent before children), so
  // gridOffsetRef is populated before any bottle cell onLayout runs.
  const gridOffsetRef = useRef({ x: 0, y: 0 });
  const bottlePositionsRef = useRef<{ x: number; y: number }[]>([]);

  // Ghost shared values — always allocated (hooks can't be conditional)
  const ghostDy = useSharedValue(0);
  const ghostDx = useSharedValue(0);
  const ghostTiltDeg = useSharedValue(0);
  const ghostStreamOpacity = useSharedValue(0);

  const ghostAnimStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: ghostDx.value },
      { translateY: ghostDy.value },
      { rotate: `${ghostTiltDeg.value}deg` },
    ],
  }));

  const ghostStreamStyle = useAnimatedStyle(() => ({
    opacity: ghostStreamOpacity.value,
  }));

  // Ghost React state (drives overlay visibility and bottle capture)
  const [ghost, setGhost] = useState<GhostInfo | null>(null);
  const [unitsEmitted, setUnitsEmitted] = useState(0);
  const emitTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  // Stable ref for values read inside the effect (avoids stale closure without
  // adding them to the dep array, which would re-trigger on every state change)
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    if (pouringFrom === null || pouringTo === null || reduceMotion) {
      cancelAnimation(ghostDy);
      cancelAnimation(ghostDx);
      cancelAnimation(ghostTiltDeg);
      cancelAnimation(ghostStreamOpacity);
      ghostDy.value = 0;
      ghostDx.value = 0;
      ghostTiltDeg.value = 0;
      ghostStreamOpacity.value = 0;
      setGhost(null);
      emitTimersRef.current.forEach(clearTimeout);
      emitTimersRef.current = [];
      setUnitsEmitted(0);
      return;
    }

    const srcPos = bottlePositionsRef.current[pouringFrom];
    const dstPos = bottlePositionsRef.current[pouringTo];
    if (!srcPos || !dstPos) return;

    const sourceBottle = stateRef.current.bottles[pouringFrom];
    const dstBottle = stateRef.current.bottles[pouringTo];
    if (!sourceBottle) return;

    const isRight = pouringFrom < pouringTo;
    const tiltSign: 1 | -1 = isRight ? 1 : -1;

    // Spout pivot: outer neck edge scaled from viewBox coords to bottleW/bottleH
    const pivotLocalX = ((isRight ? NECK_RIGHT_VB : NECK_LEFT_VB) / VB_W) * bottleW;
    const pivotLocalY = (NECK_TOP_VB / VB_H) * bottleH;

    // Diagonal lift target: move spout to center-top of destination opening
    const liftDx = (dstPos.x + bottleW / 2) - (srcPos.x + pivotLocalX);
    const liftDy = dstPos.y - srcPos.y;

    const unitCount = Math.max(1, Math.round(pourHoldMs / POUR_PER_UNIT_MS));

    emitTimersRef.current.forEach(clearTimeout);
    emitTimersRef.current = [];
    setUnitsEmitted(0);

    ghostDx.value = 0;
    ghostDy.value = 0;
    ghostTiltDeg.value = 0;
    ghostStreamOpacity.value = 0;

    setGhost({
      bottle: sourceBottle,
      bottleIndex: pouringFrom,
      startX: srcPos.x,
      startY: srcPos.y,
      dstX: dstPos.x,
      dstY: dstPos.y,
      liftDx,
      liftDy,
      tiltSign,
      dstBottleLength: dstBottle?.length ?? 0,
    });

    // Phase 1: Diagonal lift+travel simultaneously (POUR_LIFT_MS)
    ghostDx.value = withTiming(liftDx, { duration: POUR_LIFT_MS });
    ghostDy.value = withTiming(liftDy, { duration: POUR_LIFT_MS }, (finished) => {
      if (!finished) return;
      // Phase 2: Tilt to TILT_START_DEG
      ghostTiltDeg.value = withTiming(tiltSign * TILT_START_DEG, { duration: POUR_TILT_MS }, (finished) => {
        if (!finished) return;
        // Phase 3: Progressive tilt to TILT_PEAK_DEG over full pour
        ghostTiltDeg.value = withTiming(tiltSign * TILT_PEAK_DEG, { duration: pourHoldMs }, (finished) => {
          if (!finished) return;
          // Phase 4: Simultaneous untilt + diagonal return
          ghostTiltDeg.value = withTiming(0, { duration: POUR_RETURN_MS });
          ghostDx.value = withTiming(0, { duration: POUR_RETURN_MS });
          ghostDy.value = withTiming(0, { duration: POUR_RETURN_MS }, (finished) => {
            if (!finished) return;
            runOnJS(setGhost)(null);
            runOnJS(setUnitsEmitted)(0);
          });
        });
      });
    });

    // Stream fades in as tilt starts, fades out when return begins
    ghostStreamOpacity.value = withDelay(
      POUR_LIFT_MS,
      withSequence(
        withTiming(1, { duration: POUR_TILT_MS }),
        withDelay(pourHoldMs, withTiming(0, { duration: POUR_RETURN_MS / 2 }))
      )
    );

    // Schedule per-unit ghost content draining
    const flowStart = POUR_LIFT_MS + POUR_TILT_MS;
    for (let i = 1; i <= unitCount; i++) {
      const emitAt = flowStart + (i - 1) * POUR_PER_UNIT_MS + POUR_PER_UNIT_MS * 0.6;
      const captured = i;
      emitTimersRef.current.push(setTimeout(() => setUnitsEmitted(captured), emitAt));
    }

    return () => {
      emitTimersRef.current.forEach(clearTimeout);
      emitTimersRef.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pouringFrom, pouringTo, reduceMotion, pourHoldMs]);

  // Pour tilt direction — used for reduce-motion fallback only
  const pouringDirection: "left" | "right" | undefined =
    pouringFrom !== null && pouringTo !== null
      ? pouringFrom < pouringTo
        ? "right"
        : "left"
      : undefined;

  const handlers = useMemo(
    () => state.bottles.map((_, idx) => () => onBottleTap(idx)),
    // state.bottles identity changes on every pour; keying on .length avoids
    // rebuilding all handlers when only liquid positions change. onBottleTap is
    // included so callers that wrap it in useCallback get stable handles too.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.bottles.length, onBottleTap]
  );

  // Stream arc geometry — computed from ghost snapshot each render.
  const pivotLocalY = (NECK_TOP_VB / VB_H) * bottleH;
  const unitH_px = (INNER_H_VB / VB_H / BOTTLE_DEPTH) * bottleH;

  let streamPath = '';
  let streamColor = 'transparent';
  if (ghost !== null) {
    // After diagonal lift the spout sits just above the destination neck opening
    const spoutX = ghost.dstX + bottleW / 2;
    const spoutY = ghost.dstY + pivotLocalY;
    // Destination fill level at the start of the pour (stream falls into liquid)
    const dstFillTopY = ghost.dstY + (BODY_BOTTOM_VB / VB_H) * bottleH -
      ghost.dstBottleLength * unitH_px;
    const streamEndY = Math.max(spoutY + 10, dstFillTopY);
    // Slight curve in the pour direction for a natural arc
    const ctrlX = spoutX - ghost.tiltSign * 6;
    const ctrlY = spoutY + (streamEndY - spoutY) * 0.3;
    streamPath = `M ${spoutX} ${spoutY} Q ${ctrlX} ${ctrlY} ${spoutX} ${streamEndY}`;
    const topColor = ghost.bottle[ghost.bottle.length - 1];
    streamColor = topColor ? LIQUID_COLORS[topColor] : 'transparent';
  }

  // Draining ghost contents: slice from top as units emit
  const ghostBottle = ghost !== null
    ? ghost.bottle.slice(0, Math.max(0, ghost.bottle.length - unitsEmitted))
    : [];

  return (
    <View accessibilityLabel={t("a11y.boardRegion")} accessibilityRole="none" style={styles.board}>
      <View
        style={[styles.grid, { gap: BOTTLE_GAP }]}
        onLayout={(e) => {
          gridOffsetRef.current = {
            x: e.nativeEvent.layout.x,
            y: e.nativeEvent.layout.y,
          };
        }}
      >
        {state.bottles.map((bottle, idx) => (
          <View
            key={idx}
            style={[
              styles.bottleCell,
              { width: bottleW },
              idx === pouringFrom && ghost !== null ? styles.bottleHidden : null,
            ]}
            onLayout={(e) => {
              bottlePositionsRef.current[idx] = {
                x: gridOffsetRef.current.x + e.nativeEvent.layout.x,
                y: gridOffsetRef.current.y + e.nativeEvent.layout.y,
              };
            }}
          >
            <BottleView
              bottle={bottle}
              index={idx}
              selected={state.selectedBottleIndex === idx}
              pouring={reduceMotion ? idx === pouringFrom : false}
              pouringDirection={reduceMotion && idx === pouringFrom ? pouringDirection : undefined}
              colorblindMode={colorblindMode}
              bottleWidth={bottleW}
              bottleHeight={bottleH}
              onTap={handlers[idx]}
            />
          </View>
        ))}
      </View>

      {/* Ghost bottle overlay — floats above grid during pour animation.
          ghost is only set when !reduceMotion, so the extra guard is omitted. */}
      {ghost !== null && (
        <View
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          {streamPath !== '' && (
            <Animated.View style={[StyleSheet.absoluteFill, ghostStreamStyle]} pointerEvents="none">
              <Svg width="100%" height="100%">
                <Path
                  d={streamPath}
                  stroke={streamColor}
                  strokeWidth={STREAM_WIDTH}
                  fill="none"
                  strokeLinecap="round"
                />
              </Svg>
            </Animated.View>
          )}
          <Animated.View
            style={[
              styles.ghostBottle,
              {
                left: ghost.startX,
                top: ghost.startY,
                width: bottleW,
                height: bottleH,
              },
              ghostAnimStyle,
            ]}
          >
            <BottleView
              bottle={ghostBottle}
              index={ghost.bottleIndex}
              isGhost
              colorblindMode={colorblindMode}
              bottleWidth={bottleW}
              bottleHeight={bottleH}
            />
          </Animated.View>
        </View>
      )}

      <SortWinOverlay visible={state.isComplete} />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Win overlay — liquid-coloured confetti cascades down when the puzzle is solved
// ---------------------------------------------------------------------------

const PARTICLE_COLORS = Object.values(LIQUID_COLORS).slice(0, 6);

interface OverlayProps {
  readonly visible: boolean;
}

function SortWinOverlay({ visible }: OverlayProps) {
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
  }, []);

  const y0 = useSharedValue(-60);
  const y1 = useSharedValue(-60);
  const y2 = useSharedValue(-60);
  const y3 = useSharedValue(-60);
  const y4 = useSharedValue(-60);
  const y5 = useSharedValue(-60);
  const op0 = useSharedValue(0);
  const op1 = useSharedValue(0);
  const op2 = useSharedValue(0);
  const op3 = useSharedValue(0);
  const op4 = useSharedValue(0);
  const op5 = useSharedValue(0);

  useEffect(() => {
    if (!visible || reduceMotion) return;

    const ys = [y0, y1, y2, y3, y4, y5];
    const ops = [op0, op1, op2, op3, op4, op5];

    ys.forEach((y, i) => {
      y.value = -60;
      y.value = withDelay(i * 100, withSpring(500, { damping: 14, stiffness: 55 }));
    });
    ops.forEach((op, i) => {
      op.value = 0;
      op.value = withDelay(
        i * 100,
        withSequence(
          withTiming(1, { duration: 80 }),
          withDelay(600, withTiming(0, { duration: 400 }))
        )
      );
    });

    return () => {
      [y0, y1, y2, y3, y4, y5].forEach((v) => cancelAnimation(v));
      [op0, op1, op2, op3, op4, op5].forEach((v) => cancelAnimation(v));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const a0 = useAnimatedStyle(() => ({
    transform: [{ translateY: y0.value }],
    opacity: op0.value,
  }));
  const a1 = useAnimatedStyle(() => ({
    transform: [{ translateY: y1.value }],
    opacity: op1.value,
  }));
  const a2 = useAnimatedStyle(() => ({
    transform: [{ translateY: y2.value }],
    opacity: op2.value,
  }));
  const a3 = useAnimatedStyle(() => ({
    transform: [{ translateY: y3.value }],
    opacity: op3.value,
  }));
  const a4 = useAnimatedStyle(() => ({
    transform: [{ translateY: y4.value }],
    opacity: op4.value,
  }));
  const a5 = useAnimatedStyle(() => ({
    transform: [{ translateY: y5.value }],
    opacity: op5.value,
  }));

  if (!visible || reduceMotion) return null;

  return (
    <View
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Animated.View
        style={[styles.particle, styles.p0, { backgroundColor: PARTICLE_COLORS[0] }, a0]}
      />
      <Animated.View
        style={[styles.particle, styles.p1, { backgroundColor: PARTICLE_COLORS[1] }, a1]}
      />
      <Animated.View
        style={[styles.particle, styles.p2, { backgroundColor: PARTICLE_COLORS[2] }, a2]}
      />
      <Animated.View
        style={[styles.particle, styles.p3, { backgroundColor: PARTICLE_COLORS[3] }, a3]}
      />
      <Animated.View
        style={[styles.particle, styles.p4, { backgroundColor: PARTICLE_COLORS[4] }, a4]}
      />
      <Animated.View
        style={[styles.particle, styles.p5, { backgroundColor: PARTICLE_COLORS[5] }, a5]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  board: {
    flex: 1,
    width: "100%",
    alignItems: "center",
    justifyContent: "center",
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    alignItems: "center",
  },
  bottleCell: {
    alignItems: "center",
  },
  bottleHidden: {
    opacity: 0,
  },
  ghostBottle: {
    position: "absolute",
  },
  particle: { position: "absolute", width: 20, height: 20, borderRadius: 10, top: 0 },
  p0: { left: "8%" },
  p1: { left: "22%" },
  p2: { left: "36%" },
  p3: { left: "52%" },
  p4: { left: "66%" },
  p5: { left: "80%" },
});
